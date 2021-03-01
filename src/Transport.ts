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

import Debug from 'debug'
import os from 'os'
import * as http from 'http'
import zlib from 'zlib'
import { promisify } from 'util'
import ms from 'ms'
import {
  ConnectionError,
  RequestAbortedError,
  NoLivingConnectionsError,
  ResponseError,
  ConfigurationError,
  TimeoutError
} from './errors'
import { Connection, ConnectionRequestOptions } from './connection'
import Diagnostic from './Diagnostic'
import Serializer from './Serializer'
import AbortController from 'node-abort-controller'
import { Readable as ReadableStream } from 'stream'
import {
  ClusterConnectionPool,
  CloudConnectionPool,
  WeightedConnectionPool
} from './pool'
import {
  nodeFilterFn,
  nodeSelectorFn,
  generateRequestIdFn,
  RequestBody,
  RequestNDBody,
  Result,
  Context
} from './types'

const { version: clientVersion } = require('../package.json') // eslint-disable-line
const debug = Debug('elasticsearch')
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
const kDiagnostic = Symbol('diagnostics')
const kHeaders = Symbol('headers')
const kNodeFilter = Symbol('node filter')
const kNodeSelector = Symbol('node selector')

const userAgent = `elastic-transport-js/${clientVersion} (${os.platform()} ${os.release()}-${os.arch()}; Node.js ${process.version})` // eslint-disable-line

export interface TransportOptions {
  diagnostic?: Diagnostic
  connectionPool: ClusterConnectionPool | CloudConnectionPool | WeightedConnectionPool
  serializer?: Serializer
  maxRetries?: number
  requestTimeout?: number | string
  suggestCompression?: boolean
  compression?: boolean
  sniffInterval?: number | boolean
  sniffOnConnectionFault?: boolean
  sniffEndpoint?: string
  sniffOnStart?: boolean
  nodeFilter?: nodeFilterFn
  nodeSelector?: nodeSelectorFn
  headers?: Record<string, string>
  generateRequestId?: generateRequestIdFn
  name?: string
  opaqueIdPrefix?: string
  context?: Context
}

export interface TransportRequestParams {
  method: string
  path: string
  body?: RequestBody
  bulkBody?: RequestNDBody
  querystring?: Record<string, any> | string
}

export interface TransportRequestOptions {
  ignore?: number[]
  requestTimeout?: number | string
  maxRetries?: number
  asStream?: boolean
  headers?: http.IncomingHttpHeaders
  querystring?: Record<string, any>
  compression?: boolean
  id?: any
  context?: Context
  warnings?: string[]
  opaqueId?: string
  abortController?: AbortController
}

export interface GetConnectionOptions {
  requestId: string
}

export interface SniffOptions {
  requestId?: string
  reason: string
}

export default class Transport {
  [kNodeFilter]: nodeFilterFn
  [kNodeSelector]: nodeSelectorFn
  [kHeaders]: http.IncomingHttpHeaders
  [kDiagnostic]: Diagnostic
  [kConnectionPool]: ClusterConnectionPool | CloudConnectionPool | WeightedConnectionPool
  [kSerializer]: Serializer
  [kContext]: Context
  [kGenerateRequestId]: generateRequestIdFn
  [kOpaqueIdPrefix]: string | null
  [kName]: string
  [kMaxRetries]: number
  [kCompression]: boolean
  [kRequestTimeout]: number
  [kSniffEnabled]: boolean
  [kNextSniff]: number
  [kIsSniffing]: boolean
  [kSniffInterval]: number | boolean
  [kSniffOnConnectionFault]: boolean
  [kSniffEndpoint]: string | null

  static sniffReasons = {
    SNIFF_ON_START: 'sniff-on-start',
    SNIFF_INTERVAL: 'sniff-interval',
    SNIFF_ON_CONNECTION_FAULT: 'sniff-on-connection-fault',
    DEFAULT: 'default'
  }

  constructor (opts: TransportOptions) {
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

    this[kNodeFilter] = opts.nodeFilter ?? defaultNodeFilter
    this[kNodeSelector] = opts.nodeSelector ?? roundRobinSelector()
    this[kHeaders] = Object.assign({},
      { 'user-agent': userAgent },
      opts.compression === true ? { 'accept-encoding': 'gzip,deflate' } : null,
      lowerCaseHeaders(opts.headers)
    )
    this[kDiagnostic] = opts.diagnostic ?? new Diagnostic()
    this[kConnectionPool] = opts.connectionPool
    this[kSerializer] = opts.serializer ?? new Serializer()
    this[kContext] = opts.context ?? null
    this[kGenerateRequestId] = opts.generateRequestId ?? generateRequestId()
    this[kOpaqueIdPrefix] = opts.opaqueIdPrefix ?? null
    this[kName] = opts.name ?? 'elastic-transport-js'
    this[kMaxRetries] = typeof opts.maxRetries === 'number' ? opts.maxRetries : 3
    this[kCompression] = opts.compression === true
    this[kRequestTimeout] = opts.requestTimeout != null ? toMs(opts.requestTimeout) : 30000
    this[kSniffInterval] = opts.sniffInterval ?? false
    this[kSniffEnabled] = typeof this[kSniffInterval] === 'number'
    this[kNextSniff] = this[kSniffEnabled] ? (Date.now() + (this[kSniffInterval] as number)) : 0
    this[kIsSniffing] = false
    this[kSniffOnConnectionFault] = opts.sniffOnConnectionFault ?? false
    this[kSniffEndpoint] = opts.sniffEndpoint ?? null

    if (opts.sniffOnStart === true) {
      this.sniff({ reason: Transport.sniffReasons.SNIFF_ON_START })
    }
  }

  get sniffEnabled (): boolean {
    return this[kSniffEnabled]
  }

  get nextSniff (): number | null {
    return this[kNextSniff]
  }

  get sniffEndpoint (): string | null {
    return this[kSniffEndpoint]
  }

  get isSniffing (): boolean {
    return this[kIsSniffing]
  }

  set isSniffing (val) {
    if (typeof val !== 'boolean') {
      throw new ConfigurationError(`isSniffing must be a boolean, instead got ${typeof val}`)
    }
    this[kIsSniffing] = val
  }

  get diagnostic (): Diagnostic {
    return this[kDiagnostic]
  }

  async request<TResponse = any, TContext = any> (params: TransportRequestParams, options: TransportRequestOptions = {}): Promise<Result<TResponse, TContext>> {
    const meta: Result['meta'] = {
      context: null,
      request: {
        params: params,
        options: options,
        id: options.id ?? this[kGenerateRequestId](params, options)
      },
      name: this[kName],
      connection: null,
      attempts: 0,
      aborted: false
    }

    if (this[kContext] != null && options.context != null) {
      meta.context = Object.assign({}, this[kContext], options.context)
    } else if (this[kContext] !== null) {
      meta.context = this[kContext]
    } else if (options.context != null) {
      meta.context = options.context
    }

    const result: Result = {
      // the default body value can't be `null`
      // as it's a valid JSON value
      body: undefined,
      statusCode: undefined,
      headers: undefined,
      meta,
      get warnings () {
        return this.headers?.warning != null
          ? this.headers.warning.split(/(?!\B"[^"]*),(?![^"]*"\B)/)
          : null
      }
    }

    const connectionParams: ConnectionRequestOptions = {
      method: params.method,
      path: params.path
    }

    // We should not retry if we are sending a stream body, because we should store in memory
    // a copy of the stream to be able to send it again, but since we don't know in advance
    // the size of the stream, we risk to take too much memory.
    // Furthermore, copying everytime the stream is very a expensive operation.
    const maxRetries = isStream(params.body ?? params.bulkBody) ? 0 : (typeof options.maxRetries === 'number' ? options.maxRetries : this[kMaxRetries])
    const compression = typeof options.compression === 'boolean' ? options.compression : this[kCompression]
    const abortController = options.abortController ?? null

    this[kDiagnostic].emit('serialization', null, result)
    const headers = Object.assign({}, this[kHeaders], lowerCaseHeaders(options.headers))

    if (options.opaqueId !== undefined) {
      headers['x-opaque-id'] = typeof this[kOpaqueIdPrefix] === 'string'
        ? this[kOpaqueIdPrefix] + options.opaqueId // eslint-disable-line
        : options.opaqueId
    }

    // handle json body
    if (params.body != null) {
      if (shouldSerialize(params.body)) {
        try {
          connectionParams.body = this[kSerializer].serialize(params.body)
        } catch (err) {
          this[kDiagnostic].emit('request', err, result)
          throw err
        }
      } else {
        connectionParams.body = params.body
      }

      if (params.body !== '') {
        headers['content-type'] = headers['content-type'] ?? 'application/json'
      }

    // handle ndjson body
    } else if (params.bulkBody != null) {
      if (shouldSerialize(params.bulkBody)) {
        try {
          connectionParams.body = this[kSerializer].ndserialize(params.bulkBody as Array<Record<string, any>>)
        } catch (err) {
          this[kDiagnostic].emit('request', err, result)
          throw err
        }
      } else {
        connectionParams.body = params.bulkBody
      }

      if (connectionParams.body !== '') {
        headers['content-type'] = headers['content-type'] ?? 'application/x-ndjson'
      }
    }

    connectionParams.headers = headers
    // serializes the querystring
    if (options.querystring == null) {
      connectionParams.querystring = this[kSerializer].qserialize(params.querystring)
    } else {
      connectionParams.querystring = this[kSerializer].qserialize(
        Object.assign({}, params.querystring, options.querystring)
      )
    }

    // handles request timeout
    connectionParams.timeout = toMs(options.requestTimeout != null ? options.requestTimeout : this[kRequestTimeout])
    // TODO: fixme
    // if (options.asStream === true) params.asStream = true
    meta.request.params = params
    meta.request.options = options

    // handle compression
    if (connectionParams.body !== '' && connectionParams.body != null) {
      if (isStream(connectionParams.body)) {
        if (compression) {
          connectionParams.headers['content-encoding'] = 'gzip'
          connectionParams.body = connectionParams.body.pipe(createGzip())
        }
      } else if (compression) {
        try {
          connectionParams.body = await gzip(connectionParams.body)
        } catch (err) {
          /* istanbul ignore next */
          this[kDiagnostic].emit('request', err, result)
          /* istanbul ignore next */
          throw err
        }
        connectionParams.headers['content-encoding'] = 'gzip'
        connectionParams.headers['content-length'] = '' + Buffer.byteLength(connectionParams.body) // eslint-disable-line
      } else {
        connectionParams.headers['content-length'] = '' + Buffer.byteLength(connectionParams.body) // eslint-disable-line
      }
    }

    while (meta.attempts <= maxRetries) {
      try {
        if (abortController?.signal.aborted) { // eslint-disable-line
          throw new RequestAbortedError('Request has been aborted by the user', result)
        }

        meta.connection = this.getConnection({ requestId: meta.request.id })
        if (meta.connection === null) {
          throw new NoLivingConnectionsError('There are no living connections', result)
        }

        this[kDiagnostic].emit('request', null, result)

        // perform the actual http request
        let { statusCode, headers, body } = await meta.connection.request(connectionParams)
        result.statusCode = statusCode
        result.headers = headers

        const contentEncoding = (headers['content-encoding'] ?? '').toLowerCase()
        if (contentEncoding.includes('gzip') || contentEncoding.includes('deflate')) {
          body = await unzip(body)
        }

        if (Buffer.isBuffer(body)) {
          body = body.toString()
        }

        // TODO: fixme
        // if (options.asStream === true) {
        //   result.body = response
        //   this[kDiagnostic].emit('response', null, result)
        //   return result
        // }

        const isHead = params.method === 'HEAD'
        // we should attempt the payload deserialization only if:
        //    - a `content-type` is defined and is equal to `application/json`
        //    - the request is not a HEAD request
        //    - the payload is not an empty string
        if (headers['content-type']?.includes('application/json') && !isHead && body !== '') { // eslint-disable-line
          result.body = this[kSerializer].deserialize(body)
        } else {
          // cast to boolean if the request method was HEAD
          result.body = isHead ? true : body
        }

        // we should ignore the statusCode if the user has configured the `ignore` field with
        // the statusCode we just got or if the request method is HEAD and the statusCode is 404
        const ignoreStatusCode = (Array.isArray(options.ignore) && options.ignore.includes(statusCode)) ||
          (isHead && statusCode === 404)

        if (!ignoreStatusCode && (statusCode === 502 || statusCode === 503 || statusCode === 504)) {
          // if the statusCode is 502/3/4 we should run our retry strategy
          // and mark the connection as dead
          this[kConnectionPool].markDead(meta.connection)
          // retry logic
          if (meta.attempts < maxRetries) {
            meta.attempts++
            debug(`Retrying request, there are still ${maxRetries - meta.attempts} attempts`, params)
            continue
          }
        } else {
          // everything has worked as expected, let's mark
          // the connection as alive (or confirm it)
          this[kConnectionPool].markAlive(meta.connection)
        }

        if (!ignoreStatusCode && statusCode >= 400) {
          throw new ResponseError(result)
        } else {
          // cast to boolean if the request method was HEAD
          if (isHead && statusCode === 404) {
            result.body = false
          }
          this[kDiagnostic].emit('response', null, result)
          // @ts-expect-error
          return result
        }
      } catch (error) {
        switch (error.name) {
          // should not retry
          case 'NoLivingConnectionsError':
          case 'DeserializationError':
          case 'ResponseError':
            this[kDiagnostic].emit('response', error, result)
            throw error
          case 'RequestAbortedError': {
            meta.aborted = true
            // Wrap the error to get a clean stack trace
            const wrappedError = new RequestAbortedError(error.message, result)
            this[kDiagnostic].emit('response', wrappedError, result)
            throw wrappedError
          }
          // should retry
          case 'TimeoutError':
          case 'ConnectionError': {
            // if there is an error in the connection
            // let's mark the connection as dead
            this[kConnectionPool].markDead(meta.connection as Connection)

            if (this[kSniffOnConnectionFault]) {
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
            this[kDiagnostic].emit('response', wrappedError, result)
            throw wrappedError
          }

          // edge cases, such as bad compression
          default:
            this[kDiagnostic].emit('response', error, result)
            throw error
        }
      }
    }
    // @ts-expect-error
    return result
  }

  getConnection (opts: GetConnectionOptions): Connection | null {
    const now = Date.now()
    if (this[kSniffEnabled] && now > this[kNextSniff]) {
      this[kNextSniff] = now + (this[kSniffInterval] as number)
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
  sniff (opts: SniffOptions): void {}
}

function toMs (time: number | string): number {
  if (typeof time === 'string') {
    return ms(time)
  }
  return time
}

function shouldSerialize (obj: any): obj is Record<string, any> | Array<Record<string, any>> {
  return typeof obj !== 'string' &&
         typeof obj.pipe !== 'function' &&
         !Buffer.isBuffer(obj)
}

function isStream (obj: any): obj is ReadableStream {
  return obj != null && typeof obj.pipe === 'function'
}

function defaultNodeFilter (node: Connection): boolean {
  return true
}

function roundRobinSelector (): nodeSelectorFn {
  let current = -1
  return function _roundRobinSelector (connections) {
    if (++current >= connections.length) {
      current = 0
    }
    return connections[current]
  }
}

function generateRequestId (): generateRequestIdFn {
  const maxInt = 2147483647
  let nextReqId = 0
  return function genReqId (params, options) {
    return (nextReqId = (nextReqId + 1) & maxInt)
  }
}

function lowerCaseHeaders (oldHeaders?: http.IncomingHttpHeaders): http.IncomingHttpHeaders | null {
  if (oldHeaders == null) return null
  const newHeaders: Record<string, string> = {}
  for (const header in oldHeaders) {
    // @ts-expect-error
    newHeaders[header.toLowerCase()] = oldHeaders[header]
  }
  return newHeaders
}
