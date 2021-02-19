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

const gzip = promisify(zlib.gzip)
const { createGzip } = zlib

/* istanbul ignore next */
const noop = () => {}

const clientVersion = require('../package.json').version
const userAgent = `elasticsearch-js/${clientVersion} (${os.platform()} ${os.release()}-${os.arch()}; Node.js ${process.version})`

class Transport {
  constructor (opts) {
    if (typeof opts.compression === 'string' && opts.compression !== 'gzip') {
      throw new ConfigurationError(`Invalid compression: '${opts.compression}'`)
    }

    this.emit = opts.emit
    this.connectionPool = opts.connectionPool
    this.serializer = opts.serializer
    this.maxRetries = opts.maxRetries
    this.requestTimeout = toMs(opts.requestTimeout)
    this.suggestCompression = opts.suggestCompression === true
    this.compression = opts.compression || false
    this.context = opts.context || null
    this.headers = Object.assign({},
      { 'user-agent': userAgent },
      opts.suggestCompression === true ? { 'accept-encoding': 'gzip,deflate' } : null,
      lowerCaseHeaders(opts.headers)
    )
    this.sniffInterval = opts.sniffInterval
    this.sniffOnConnectionFault = opts.sniffOnConnectionFault
    this.sniffEndpoint = opts.sniffEndpoint
    this.generateRequestId = opts.generateRequestId || generateRequestId()
    this.name = opts.name
    this.opaqueIdPrefix = opts.opaqueIdPrefix

    this.nodeFilter = opts.nodeFilter || defaultNodeFilter
    if (typeof opts.nodeSelector === 'function') {
      this.nodeSelector = opts.nodeSelector
    } else if (opts.nodeSelector === 'round-robin') {
      this.nodeSelector = roundRobinSelector()
    } else if (opts.nodeSelector === 'random') {
      this.nodeSelector = randomSelector
    } else {
      this.nodeSelector = roundRobinSelector()
    }

    this._sniffEnabled = typeof this.sniffInterval === 'number'
    this._nextSniff = this._sniffEnabled ? (Date.now() + this.sniffInterval) : 0
    this._isSniffing = false

    if (opts.sniffOnStart === true) {
      this.sniff({ reason: Transport.sniffReasons.SNIFF_ON_START })
    }
  }

  async request (params, options = {}) {
    const meta = {
      context: null,
      request: {
        params: null,
        options: null,
        id: options.id || this.generateRequestId(params, options)
      },
      name: this.name,
      connection: null,
      attempts: 0,
      aborted: false
    }

    if (this.context != null && options.context != null) {
      meta.context = Object.assign({}, this.context, options.context)
    } else if (this.context != null) {
      meta.context = this.context
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
    const maxRetries = isStream(params.body) || isStream(params.bulkBody)
      ? 0
      : (typeof options.maxRetries === 'number' ? options.maxRetries : this.maxRetries)
    const compression = options.compression !== undefined ? options.compression : this.compression
    const abortController = options.abortController || null

    this.emit('serialization', null, result)
    const headers = Object.assign({}, this.headers, lowerCaseHeaders(options.headers))

    if (options.opaqueId !== undefined) {
      headers['x-opaque-id'] = this.opaqueIdPrefix !== null
        ? this.opaqueIdPrefix + options.opaqueId
        : options.opaqueId
    }

    // handle json body
    if (params.body != null) {
      if (shouldSerialize(params.body) === true) {
        try {
          params.body = this.serializer.serialize(params.body)
        } catch (err) {
          this.emit('request', err, result)
          throw err
        }
      }

      if (params.body !== '') {
        headers['content-type'] = headers['content-type'] || 'application/json'
      }

    // handle ndjson body
    } else if (params.bulkBody != null) {
      if (shouldSerialize(params.bulkBody) === true) {
        try {
          params.body = this.serializer.ndserialize(params.bulkBody)
        } catch (err) {
          this.emit('request', err, result)
          throw err
        }
      } else {
        params.body = params.bulkBody
      }
      /* istanbul ignore else */
      if (params.body !== '') {
        headers['content-type'] = headers['content-type'] || 'application/x-ndjson'
      }
    }

    params.headers = headers
    // serializes the querystring
    if (options.querystring == null) {
      params.querystring = this.serializer.qserialize(params.querystring)
    } else {
      params.querystring = this.serializer.qserialize(
        Object.assign({}, params.querystring, options.querystring)
      )
    }

    // handles request timeout
    params.timeout = toMs(options.requestTimeout || this.requestTimeout)
    if (options.asStream === true) params.asStream = true
    meta.request.params = params
    meta.request.options = options

    // handle compression
    if (params.body !== '' && params.body != null) {
      if (isStream(params.body) === true) {
        if (compression === 'gzip') {
          params.headers['content-encoding'] = compression
          params.body = params.body.pipe(createGzip())
        }
      } else if (compression === 'gzip') {
        try {
          params.body = await gzip(params.body)
        } catch (err) {
          this.emit('request', err, result)
          throw err
        }
        params.headers['content-encoding'] = compression
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

        this.emit('request', null, result)

        // perform the actual http request
        const { statusCode, headers, body } = await meta.connection.request(params)
        result.statusCode = statusCode
        result.headers = headers

        // TODO: fixme
        // if (options.asStream === true) {
        //   result.body = response
        //   this.emit('response', null, result)
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
          result.body = this.serializer.deserialize(body)
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
          this.connectionPool.markDead(meta.connection)
          // retry logic (we shoukd not retry on "429 - Too Many Requests")
          if (meta.attempts < maxRetries && statusCode !== 429) {
            meta.attempts++
            debug(`Retrying request, there are still ${maxRetries - meta.attempts} attempts`, params)
            continue
          }
        } else {
          // everything has worked as expected, let's mark
          // the connection as alive (or confirm it)
          this.connectionPool.markAlive(meta.connection)
        }

        if (ignoreStatusCode === false && statusCode >= 400) {
          throw new ResponseError(result)
        } else {
          // cast to boolean if the request method was HEAD
          if (isHead === true && statusCode === 404) {
            result.body = false
          }
          this.emit('response', null, result)
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
              this.emit('response', wrappedError, result)
              throw wrappedError
            } else {
              this.emit('response', error, result)
              throw error
            }
          // should retry
          case 'TimeoutError':
          case 'ConnectionError': {
            // if there is an error in the connection
            // let's mark the connection as dead
            this.connectionPool.markDead(meta.connection)

            if (this.sniffOnConnectionFault === true) {
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
            this.emit('response', wrappedError, result)
            throw wrappedError
          }
        }
      }
    }
  }

  getConnection (opts) {
    const now = Date.now()
    if (this._sniffEnabled === true && now > this._nextSniff) {
      this.sniff({ reason: Transport.sniffReasons.SNIFF_INTERVAL, requestId: opts.requestId })
    }
    return this.connectionPool.getConnection({
      filter: this.nodeFilter,
      selector: this.nodeSelector,
      requestId: opts.requestId,
      name: this.name,
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
