/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

'use strict'

const debug = require('debug')('elasticsearch')
const os = require('os')
const zlib = require('zlib')
const { promisify } = require('util')
const ms = require('ms')
const {
  ConnectionError,
  RequestAbortedError,
  NoLivingConnectionsError,
  ResponseError,
  ConfigurationError,
  TimeoutError
} = require('./errors')
const Observability = require('./Observability')
const Serializer = require('./Serializer')

const gzip = promisify(zlib.gzip)
const unzip = promisify(zlib.unzip)
const { createGzip } = zlib

const kSniffEnabled = Symbol('sniff enabled')
const kNextSniff = Symbol('next sniff')
const kIsSniffing = Symbol('is sniffing')
const kSniffInterval = Symbol('sniff interval')
const kSniffOnConnectionFault = Symbol('sniff on connection fault')
const kSniffEndpoint = Symbol('sniff endpoint')
const kRequestTimeout = Symbol('request timeout')
const kCompression = Symbol('compression')
const kMaxRetries = Symbol('max retries')
const kName = Symbol('name')
const kOpaqueIdPrefix = Symbol('opaque id prefix')
const kGenerateRequestId = Symbol('generate request id')
const kContext = Symbol('context')
const kConnectionPool = Symbol('connection pool')
const kSerializer = Symbol('serializer')
const kObservability = Symbol('observability')
const kHeaders = Symbol('headers')
const kNodeFilter = Symbol('node filter')
const kNodeSelector = Symbol('node selector')

const clientVersion = require('../package.json').version
const userAgent = `elastic-transport-js/${clientVersion} (${os.platform()} ${os.release()}-${os.arch()}; Node.js ${process.version})`

class Transport {
  constructor (opts) {
    if (typeof opts.compression === 'string' && opts.compression !== 'gzip') {
      throw new ConfigurationError(`Invalid compression: '${opts.compression}'`)
    }

    if (opts.connectionPool == null) {
      throw new ConfigurationError('The Connection Pool option is not defined')
    }

    if (typeof opts.maxRetries === 'number' && opts.maxRetries < 0 && Number.isInteger(opts.maxRetries)) {
      throw new ConfigurationError('The maxRetries option must be a positive integer or zero')
    }

    if (opts.sniffInterval === true ||
       (typeof opts.sniffInterval === 'number' && opts.sniffInterval < 0 && Number.isInteger(opts.sniffInterval))) {
      throw new ConfigurationError('The sniffInterval option must be false or a positive integer')
    }

    this[kNodeFilter] = opts.nodeFilter || defaultNodeFilter
    this[kNodeSelector] = opts.nodeSelector || roundRobinSelector()
    this[kHeaders] = Object.assign({},
      { 'user-agent': userAgent },
      opts.compression === true ? { 'accept-encoding': 'gzip,deflate' } : null,
      lowerCaseHeaders(opts.headers)
    )
    this[kObservability] = opts.observability || new Observability()
    this[kConnectionPool] = opts.connectionPool
    this[kSerializer] = opts.serializer || new Serializer()
    this[kContext] = opts.context || null
    this[kGenerateRequestId] = opts.generateRequestId || generateRequestId()
    this[kOpaqueIdPrefix] = opts.opaqueIdPrefix || null
    this[kName] = opts.name || 'elastic-transport-js'
    this[kMaxRetries] = typeof opts.maxRetries === 'number' ? opts.maxRetries : 3
    this[kCompression] = opts.compression === true
    this[kRequestTimeout] = toMs(opts.requestTimeout) || 30000
    this[kSniffEnabled] = typeof this[kSniffInterval] === 'number'
    this[kNextSniff] = this[kSniffEnabled] ? (Date.now() + this[kSniffInterval]) : 0
    this[kIsSniffing] = false
    this[kSniffInterval] = opts.sniffInterval || false
    this[kSniffOnConnectionFault] = opts.sniffOnConnectionFault || false
    this[kSniffEndpoint] = opts.sniffEndpoint || null

    if (opts.sniffOnStart === true) {
      this.sniff({ reason: Transport.sniffReasons.SNIFF_ON_START })
    }
  }

  get sniffEnabled () {
    return this[kSniffEnabled]
  }

  get nextSniff () {
    return this[kNextSniff]
  }

  get sniffEndpoint () {
    return this[kSniffEndpoint]
  }

  get isSniffing () {
    return this[kIsSniffing]
  }

  set isSniffing (val) {
    if (typeof val !== 'boolean') {
      throw new ConfigurationError(`isSniffing must be a boolean, instead got ${typeof val}`)
    }
    this[kIsSniffing] = val
  }

  get observability () {
    return this[kObservability]
  }

  async request (params, options = {}) {
    const meta = {
      context: null,
      request: {
        params: null,
        options: null,
        id: options.id || this[kGenerateRequestId](params, options)
      },
      name: this[kName],
      connection: null,
      attempts: 0,
      aborted: false
    }

    if (this[kContext] != null && options.context != null) {
      meta.context = Object.assign({}, this[kContext], options.context)
    } else if (this[kContext] != null) {
      meta.context = this[kContext]
    } else if (options.context != null) {
      meta.context = options.context
    }

    const result = {
      // the default body value can't be `null`
      // as it's a valid JSON value
      body: undefined,
      statusCode: undefined,
      headers: undefined,
      meta
    }

    Object.defineProperty(result, 'warnings', {
      get () {
        return this.headers && this.headers.warning
          ? this.headers.warning.split(/(?!\B"[^"]*),(?![^"]*"\B)/)
          : null
      }
    })

    // We should not retry if we are sending a stream body, because we should store in memory
    // a copy of the stream to be able to send it again, but since we don't know in advance
    // the size of the stream, we risk to take too much memory.
    // Furthermore, copying everytime the stream is very a expensive operation.
    const maxRetries = isStream(params.body || params.bulkBody) ? 0 : (typeof options.maxRetries === 'number' ? options.maxRetries : this[kMaxRetries])
    const compression = typeof options.compression === 'boolean' ? options.compression : this[kCompression]
    const abortController = options.abortController || null

    this[kObservability].emit('serialization', null, result)
    const headers = Object.assign({}, this[kHeaders], lowerCaseHeaders(options.headers))

    if (options.opaqueId !== undefined) {
      headers['x-opaque-id'] = this[kOpaqueIdPrefix] !== null
        ? this[kOpaqueIdPrefix] + options.opaqueId
        : options.opaqueId
    }

    // handle json body
    if (params.body != null) {
      if (shouldSerialize(params.body)) {
        try {
          params.body = this[kSerializer].serialize(params.body)
        } catch (err) {
          this[kObservability].emit('request', err, result)
          throw err
        }
      }

      if (params.body !== '') {
        headers['content-type'] = headers['content-type'] || 'application/json'
      }

    // handle ndjson body
    } else if (params.bulkBody != null) {
      if (shouldSerialize(params.bulkBody)) {
        try {
          params.body = this[kSerializer].ndserialize(params.bulkBody)
        } catch (err) {
          this[kObservability].emit('request', err, result)
          throw err
        }
      } else {
        params.body = params.bulkBody
      }

      if (params.body !== '') {
        headers['content-type'] = headers['content-type'] || 'application/x-ndjson'
      }
    }

    params.headers = headers
    // serializes the querystring
    if (options.querystring == null) {
      params.querystring = this[kSerializer].qserialize(params.querystring)
    } else {
      params.querystring = this[kSerializer].qserialize(
        Object.assign({}, params.querystring, options.querystring)
      )
    }

    // handles request timeout
    params.timeout = toMs(options.requestTimeout || this[kRequestTimeout])
    // TODO: fixme
    // if (options.asStream === true) params.asStream = true
    meta.request.params = params
    meta.request.options = options

    // handle compression
    if (params.body !== '' && params.body != null) {
      if (isStream(params.body) === true) {
        if (compression) {
          params.headers['content-encoding'] = 'gzip'
          params.body = params.body.pipe(createGzip())
        }
      } else if (compression) {
        try {
          params.body = await gzip(params.body)
        } catch (err) {
          this[kObservability].emit('request', err, result)
          throw err
        }
        params.headers['content-encoding'] = 'gzip'
        params.headers['content-length'] = '' + Buffer.byteLength(params.body)
      } else {
        params.headers['content-length'] = '' + Buffer.byteLength(params.body)
      }
    }

    while (meta.attempts <= maxRetries) {
      try {
        if (abortController != null && abortController.signal.aborted) {
          meta.aborted = true
          throw new RequestAbortedError()
        }

        meta.connection = this.getConnection({ requestId: meta.request.id })
        if (meta.connection == null) {
          throw new NoLivingConnectionsError()
        }

        this[kObservability].emit('request', null, result)

        // perform the actual http request
        let { statusCode, headers, body } = await meta.connection.request(params)
        result.statusCode = statusCode
        result.headers = headers

        const contentEncoding = (headers['content-encoding'] || '').toLowerCase()
        if (contentEncoding.indexOf('gzip') > -1 || contentEncoding.indexOf('deflate') > -1) {
          body = await unzip(body)
        }

        // TODO: fixme
        // if (options.asStream === true) {
        //   result.body = response
        //   this[kObservability].emit('response', null, result)
        //   return result
        // }

        const isHead = params.method === 'HEAD'
        // we should attempt the payload deserialization only if:
        //    - a `content-type` is defined and is equal to `application/json`
        //    - the request is not a HEAD request
        //    - the payload is not an empty string
        if (headers['content-type'] !== undefined &&
            headers['content-type'].indexOf('application/json') > -1 &&
            isHead === false &&
            body !== ''
        ) {
          result.body = this[kSerializer].deserialize(body)
        } else {
          // cast to boolean if the request method was HEAD
          result.body = isHead === true ? true : body
        }

        // we should ignore the statusCode if the user has configured the `ignore` field with
        // the statusCode we just got or if the request method is HEAD and the statusCode is 404
        const ignoreStatusCode = (Array.isArray(options.ignore) && options.ignore.indexOf(statusCode) > -1) ||
          (isHead === true && statusCode === 404)

        if (ignoreStatusCode === false && (statusCode === 502 || statusCode === 503 || statusCode === 504)) {
          // if the statusCode is 502/3/4 we should run our retry strategy
          // and mark the connection as dead
          this[kConnectionPool].markDead(meta.connection)
          // retry logic (we shoukd not retry on "429 - Too Many Requests")
          if (meta.attempts < maxRetries && statusCode !== 429) {
            meta.attempts++
            debug(`Retrying request, there are still ${maxRetries - meta.attempts} attempts`, params)
            continue
          }
        } else {
          // everything has worked as expected, let's mark
          // the connection as alive (or confirm it)
          this[kConnectionPool].markAlive(meta.connection)
        }

        if (ignoreStatusCode === false && statusCode >= 400) {
          throw new ResponseError(result)
        } else {
          // cast to boolean if the request method was HEAD
          if (isHead === true && statusCode === 404) {
            result.body = false
          }
          this[kObservability].emit('response', null, result)
          return result
        }
      } catch (error) {
        switch (error.name) {
          // should not retry
          case 'NoLivingConnectionsError':
          case 'DeserializationError':
          case 'RequestAbortedError':
          case 'ResponseError':
            if (error.name === 'RequestAbortedError') {
              meta.aborted = true
              // Wrap the error to get a clean stack trace
              const wrappedError = new RequestAbortedError(error.message, result)
              this[kObservability].emit('response', wrappedError, result)
              throw wrappedError
            } else {
              this[kObservability].emit('response', error, result)
              throw error
            }
          // should retry
          case 'TimeoutError':
          case 'ConnectionError': {
            // if there is an error in the connection
            // let's mark the connection as dead
            this[kConnectionPool].markDead(meta.connection)

            if (this[kSniffOnConnectionFault] === true) {
              this.sniff({
                reason: Transport.sniffReasons.SNIFF_ON_CONNECTION_FAULT,
                requestId: meta.request.id
              })
            }

            // retry logic
            if (meta.attempts < maxRetries) {
              meta.attempts++
              debug(`Retrying request, there are still ${maxRetries - meta.attempts} attempts`, params)
              continue
            }

            // Wrap the error to get a clean stack trace
            const wrappedError = error.name === 'TimeoutError'
              ? new TimeoutError(error.message, result)
              : new ConnectionError(error.message, result)
            this[kObservability].emit('response', wrappedError, result)
            throw wrappedError
          }

          // edge cases, such as bad compression
          default:
            this[kObservability].emit('response', error, result)
            throw error
        }
      }
    }
  }

  getConnection (opts) {
    const now = Date.now()
    if (this[kSniffEnabled] && now > this[kNextSniff]) {
      this[kNextSniff] = now + this[kSniffInterval]
      this.sniff({ reason: Transport.sniffReasons.SNIFF_INTERVAL, requestId: opts.requestId })
    }
    return this[kConnectionPool].getConnection({
      filter: this[kNodeFilter],
      selector: this[kNodeSelector],
      requestId: opts.requestId,
      name: this[kName],
      now
    })
  }

  /* istanbul ignore next */
  sniff (opts) {}
}

Transport.sniffReasons = {
  SNIFF_ON_START: 'sniff-on-start',
  SNIFF_INTERVAL: 'sniff-interval',
  SNIFF_ON_CONNECTION_FAULT: 'sniff-on-connection-fault',
  // TODO: find a better name
  DEFAULT: 'default'
}

function toMs (time) {
  if (typeof time === 'string') {
    return ms(time)
  }
  return time
}

function shouldSerialize (obj) {
  return typeof obj !== 'string' &&
         typeof obj.pipe !== 'function' &&
         Buffer.isBuffer(obj) === false
}

function isStream (obj) {
  return obj != null && typeof obj.pipe === 'function'
}

function defaultNodeFilter (node) {
  // avoid master only nodes
  if (node.roles.master === true &&
      node.roles.data === false &&
      node.roles.ingest === false) {
    return false
  }
  return true
}

function roundRobinSelector () {
  let current = -1
  return function _roundRobinSelector (connections) {
    if (++current >= connections.length) {
      current = 0
    }
    return connections[current]
  }
}

function randomSelector (connections) {
  const index = Math.floor(Math.random() * connections.length)
  return connections[index]
}

function generateRequestId () {
  const maxInt = 2147483647
  let nextReqId = 0
  return function genReqId (params, options) {
    return (nextReqId = (nextReqId + 1) & maxInt)
  }
}

function lowerCaseHeaders (oldHeaders) {
  if (oldHeaders == null) return oldHeaders
  const newHeaders = {}
  for (const header in oldHeaders) {
    newHeaders[header.toLowerCase()] = oldHeaders[header]
  }
  return newHeaders
}

module.exports = Transport
module.exports.internals = {
  defaultNodeFilter,
  roundRobinSelector,
  randomSelector,
  generateRequestId,
  lowerCaseHeaders
}
