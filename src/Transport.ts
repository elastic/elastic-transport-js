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
import buffer from 'buffer'
import { promisify } from 'util'
import ms from 'ms'
import {
  ConnectionError,
  RequestAbortedError,
  NoLivingConnectionsError,
  ResponseError,
  ConfigurationError,
  ProductNotSupportedError,
  TimeoutError,
  ErrorOptions
} from './errors'
import { Connection, ConnectionRequestParams } from './connection'
import Diagnostic from './Diagnostic'
import Serializer from './Serializer'
import { Readable as ReadableStream } from 'stream'
import { BaseConnectionPool } from './pool'
import {
  nodeFilterFn,
  nodeSelectorFn,
  generateRequestIdFn,
  RequestBody,
  RequestNDBody,
  TransportResult,
  Context
} from './types'
import {
  kSniffEnabled,
  kNextSniff,
  kIsSniffing,
  kSniffInterval,
  kSniffOnConnectionFault,
  kSniffEndpoint,
  kRequestTimeout,
  kRetryOnTimeout,
  kCompression,
  kMaxRetries,
  kName,
  kOpaqueIdPrefix,
  kGenerateRequestId,
  kContext,
  kConnectionPool,
  kSerializer,
  kDiagnostic,
  kHeaders,
  kNodeFilter,
  kNodeSelector,
  kProductCheck,
  kMaxResponseSize,
  kMaxCompressedResponseSize,
  kJsonContentType,
  kNdjsonContentType,
  kAcceptHeader,
  kRedaction,
  kRetryBackoff
} from './symbols'
import { setTimeout as setTimeoutPromise } from 'node:timers/promises'
import opentelemetry, { Exception, SpanStatusCode, Span } from '@opentelemetry/api'

const { version: clientVersion } = require('../package.json') // eslint-disable-line
const debug = Debug('elasticsearch')
const gzip = promisify(zlib.gzip)
const unzip = promisify(zlib.unzip)
const { createGzip } = zlib

const userAgent = `elastic-transport-js/${clientVersion} (${os.platform()} ${os.release()}-${os.arch()}; Node.js ${process.version})` // eslint-disable-line

export interface TransportOptions {
  diagnostic?: Diagnostic
  connectionPool: BaseConnectionPool
  serializer?: Serializer
  maxRetries?: number
  requestTimeout?: number | string
  retryOnTimeout?: boolean
  compression?: boolean
  sniffInterval?: number | boolean
  sniffOnConnectionFault?: boolean
  sniffEndpoint?: string
  sniffOnStart?: boolean
  nodeFilter?: nodeFilterFn
  nodeSelector?: nodeSelectorFn
  headers?: http.IncomingHttpHeaders
  generateRequestId?: generateRequestIdFn
  name?: string | symbol
  opaqueIdPrefix?: string
  context?: Context
  productCheck?: string
  maxResponseSize?: number
  maxCompressedResponseSize?: number
  vendoredHeaders?: {
    jsonContentType?: string
    ndjsonContentType?: string
    accept?: string
  }
  redaction?: RedactionOptions
  retryBackoff?: (min: number, max: number, attempt: number) => number
}

export interface TransportRequestMetadata {
  name: string
  pathParts?: Record<string, any>
}

export interface TransportRequestParams {
  method: string
  path: string
  body?: RequestBody
  bulkBody?: RequestNDBody
  querystring?: Record<string, any> | string
  meta?: TransportRequestMetadata
}

export interface TransportRequestOptions {
  ignore?: number[]
  requestTimeout?: number | string
  retryOnTimeout?: boolean
  maxRetries?: number
  asStream?: boolean
  headers?: http.IncomingHttpHeaders
  querystring?: Record<string, any>
  compression?: boolean
  id?: any
  context?: Context
  warnings?: string[]
  opaqueId?: string
  signal?: AbortSignal
  maxResponseSize?: number
  maxCompressedResponseSize?: number
  /**
    * Warning: If you set meta to true the result will no longer be
    * the response body, but an object containing the body, statusCode,
    * headers and meta keys.
    * You can use the destructuring assignment to update your code without
    * refactoring the entire code base:
    * From:
    * ```
    * const result = await client.method(params)
    * ```
    * To:
    * ```
    * const {
    *   body: result,
    *   statusCode,
    *   headers,
    *   meta
    * } = await client.method(params, { meta: true })
    * ```
    */
  meta?: boolean
  redaction?: RedactionOptions
  retryBackoff?: (min: number, max: number, attempt: number) => number
}

export interface TransportRequestOptionsWithMeta extends TransportRequestOptions {
  meta: true
}

export interface TransportRequestOptionsWithOutMeta extends TransportRequestOptions {
  meta: false
}

export interface GetConnectionOptions {
  requestId: string | number
  context: any
}

export interface SniffOptions {
  requestId?: string | number
  reason: string
  context: any
}

export interface RedactionOptions {
  type: 'off' | 'replace' | 'remove'
  additionalKeys?: string[]
}

export default class Transport {
  [kNodeFilter]: nodeFilterFn
  [kNodeSelector]: nodeSelectorFn
  [kHeaders]: http.IncomingHttpHeaders
  [kDiagnostic]: Diagnostic
  [kConnectionPool]: BaseConnectionPool
  [kSerializer]: Serializer
  [kContext]: Context
  [kGenerateRequestId]: generateRequestIdFn
  [kOpaqueIdPrefix]: string | null
  [kName]: string | symbol
  [kMaxRetries]: number
  [kCompression]: boolean
  [kRequestTimeout]: number
  [kRetryOnTimeout]: boolean
  [kSniffEnabled]: boolean
  [kNextSniff]: number
  [kIsSniffing]: boolean
  [kSniffInterval]: number | boolean
  [kSniffOnConnectionFault]: boolean
  [kSniffEndpoint]: string | null
  [kProductCheck]: string | null
  [kMaxResponseSize]: number
  [kMaxCompressedResponseSize]: number
  [kJsonContentType]: string
  [kNdjsonContentType]: string
  [kAcceptHeader]: string
  [kRedaction]: RedactionOptions
  [kRetryBackoff]: (min: number, max: number, attempt: number) => number

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

    if (opts.maxResponseSize != null && opts.maxResponseSize > buffer.constants.MAX_STRING_LENGTH) {
      throw new ConfigurationError(`The maxResponseSize cannot be bigger than ${buffer.constants.MAX_STRING_LENGTH}`)
    }

    if (opts.maxCompressedResponseSize != null && opts.maxCompressedResponseSize > buffer.constants.MAX_LENGTH) {
      throw new ConfigurationError(`The maxCompressedResponseSize cannot be bigger than ${buffer.constants.MAX_LENGTH}`)
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
    this[kRetryOnTimeout] = opts.retryOnTimeout != null ? opts.retryOnTimeout : false
    this[kSniffInterval] = opts.sniffInterval ?? false
    this[kSniffEnabled] = typeof this[kSniffInterval] === 'number'
    this[kNextSniff] = this[kSniffEnabled] ? (Date.now() + (this[kSniffInterval] as number)) : 0
    this[kIsSniffing] = false
    this[kSniffOnConnectionFault] = opts.sniffOnConnectionFault ?? false
    this[kSniffEndpoint] = opts.sniffEndpoint ?? null
    this[kProductCheck] = opts.productCheck ?? null
    this[kMaxResponseSize] = opts.maxResponseSize ?? buffer.constants.MAX_STRING_LENGTH
    this[kMaxCompressedResponseSize] = opts.maxCompressedResponseSize ?? buffer.constants.MAX_LENGTH
    this[kJsonContentType] = opts.vendoredHeaders?.jsonContentType ?? 'application/json'
    this[kNdjsonContentType] = opts.vendoredHeaders?.ndjsonContentType ?? 'application/x-ndjson'
    this[kAcceptHeader] = opts.vendoredHeaders?.accept ?? 'application/json, text/plain'
    this[kRedaction] = opts.redaction ?? { type: 'replace', additionalKeys: [] }
    this[kRetryBackoff] = opts.retryBackoff ?? retryBackoff

    if (opts.sniffOnStart === true) {
      this.sniff({
        reason: Transport.sniffReasons.SNIFF_ON_START,
        requestId: this[kGenerateRequestId](
          { method: 'GET', path: this[kSniffEndpoint] as string },
          { context: this[kContext] }
        ),
        context: this[kContext]
      })
    }
  }

  get connectionPool (): BaseConnectionPool {
    return this[kConnectionPool]
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

  async request<TResponse = unknown> (params: TransportRequestParams, options?: TransportRequestOptionsWithOutMeta): Promise<TResponse>
  async request<TResponse = unknown, TContext = any> (params: TransportRequestParams, options?: TransportRequestOptionsWithMeta): Promise<TransportResult<TResponse, TContext>>
  async request<TResponse = unknown> (params: TransportRequestParams, options?: TransportRequestOptions): Promise<TResponse>
  async request (params: TransportRequestParams, options: TransportRequestOptions = {}): Promise<any> {
    const otelTracer = opentelemetry.trace.getTracer('elastic-transport')
    let otelSpan: Span

    const _request = async (): Promise<any> => {
      const connectionParams: ConnectionRequestParams = {
        method: params.method,
        path: params.path
      }

      const meta: TransportResult['meta'] = {
        context: null,
        request: {
          params: connectionParams,
          options: options,
          id: options.id ?? this[kGenerateRequestId](params, options)
        },
        name: this[kName],
        connection: null,
        attempts: 0,
        aborted: false
      }

      const returnMeta = options.meta ?? false

      if (this[kContext] != null && options.context != null) {
        meta.context = Object.assign({}, this[kContext], options.context)
      } else if (this[kContext] !== null) {
        meta.context = this[kContext]
      } else if (options.context != null) {
        meta.context = options.context
      }

      const result: TransportResult = {
        // the default body value can't be `null`
        // as it's a valid JSON value
        body: undefined,
        statusCode: 0,
        headers: {},
        meta,
        get warnings () {
          if (this.headers?.warning == null) {
            return null
          }
          const { warning } = this.headers
          // if multiple HTTP headers have the same name, Undici represents them as an array
          const warnings: string[] = Array.isArray(warning) ? warning : [warning]
          return warnings
            .flatMap(w => w.split(/(?!\B"[^"]*),(?![^"]*"\B)/))
            .filter((warning) => warning.match(/^\d\d\d Elasticsearch-/))
        }
      }

      // We should not retry if we are sending a stream body, because we should store in memory
      // a copy of the stream to be able to send it again, but since we don't know in advance
      // the size of the stream, we risk to take too much memory.
      // Furthermore, copying every time the stream is very a expensive operation.
      const maxRetries = isStream(params.body ?? params.bulkBody) ? 0 : (typeof options.maxRetries === 'number' ? options.maxRetries : this[kMaxRetries])
      const compression = typeof options.compression === 'boolean' ? options.compression : this[kCompression]
      const signal = options.signal
      const maxResponseSize = options.maxResponseSize ?? this[kMaxResponseSize]
      const maxCompressedResponseSize = options.maxCompressedResponseSize ?? this[kMaxCompressedResponseSize]

      const errorOptions: ErrorOptions = {
        redaction: typeof options.redaction === 'object' ? options.redaction : this[kRedaction]
      }

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
          } catch (err: any) {
            this[kDiagnostic].emit('request', err, result)
            throw err
          }
          headers['content-type'] = headers['content-type'] ?? this[kJsonContentType]
          headers.accept = headers.accept ?? this[kJsonContentType]
        } else {
          if (params.body !== '') {
            headers['content-type'] = headers['content-type'] ?? 'text/plain'
            headers.accept = headers.accept ?? this[kAcceptHeader]
          }
          connectionParams.body = params.body
        }

      // handle ndjson body
      } else if (params.bulkBody != null) {
        if (shouldSerialize(params.bulkBody)) {
          try {
            connectionParams.body = this[kSerializer].ndserialize(params.bulkBody as Array<Record<string, any>>)
          } catch (err: any) {
            this[kDiagnostic].emit('request', err, result)
            throw err
          }
        } else {
          connectionParams.body = params.bulkBody
        }

        if (connectionParams.body !== '') {
          headers['content-type'] = headers['content-type'] ?? this[kNdjsonContentType]
          headers.accept = headers.accept ?? this[kJsonContentType]
        }
      }

      // serializes the querystring
      if (options.querystring == null) {
        connectionParams.querystring = this[kSerializer].qserialize(params.querystring)
      } else {
        connectionParams.querystring = this[kSerializer].qserialize(
          Object.assign({}, params.querystring, options.querystring)
        )
      }

      // handle compression
      if (connectionParams.body !== '' && connectionParams.body != null) {
        if (isStream(connectionParams.body)) {
          if (compression) {
            headers['content-encoding'] = 'gzip'
            connectionParams.body = connectionParams.body.pipe(createGzip())
          }
        } else if (compression) {
          try {
            connectionParams.body = await gzip(connectionParams.body)
          } catch (err: any) {
            /* istanbul ignore next */
            this[kDiagnostic].emit('request', err, result)
            /* istanbul ignore next */
            throw err
          }
          headers['content-encoding'] = 'gzip'
          headers['content-length'] = '' + Buffer.byteLength(connectionParams.body) // eslint-disable-line
        } else {
          headers['content-length'] = '' + Buffer.byteLength(connectionParams.body) // eslint-disable-line
        }
      }

      headers.accept = headers.accept ?? this[kAcceptHeader]
      connectionParams.headers = headers
      while (meta.attempts <= maxRetries) {
        try {
          if (signal?.aborted) { // eslint-disable-line
            throw new RequestAbortedError('Request has been aborted by the user', result, errorOptions)
          }

          meta.connection = this.getConnection({
            requestId: meta.request.id,
            context: meta.context
          })
          if (meta.connection === null) {
            throw new NoLivingConnectionsError('There are no living connections', result, errorOptions)
          }

          // generate required OpenTelemetry attributes from the request URL
          const requestUrl = meta.connection.url
          otelSpan?.setAttributes({
            'url.full': requestUrl.toString(),
            'server.address': requestUrl.hostname
          })
          if (requestUrl.port === '') {
            if (requestUrl.protocol === 'https:') {
              otelSpan?.setAttribute('server.port', 443)
            } else if (requestUrl.protocol === 'http:') {
              otelSpan?.setAttribute('server.port', 80)
            }
          } else if (requestUrl.port !== '9200') {
            otelSpan?.setAttribute('server.port', parseInt(requestUrl.port, 10))
          }

          this[kDiagnostic].emit('request', null, result)

          // perform the actual http request
          let { statusCode, headers, body } = await meta.connection.request(connectionParams, {
            requestId: meta.request.id,
            name: this[kName],
            context: meta.context,
            maxResponseSize,
            maxCompressedResponseSize,
            signal,
            timeout: toMs(options.requestTimeout != null ? options.requestTimeout : this[kRequestTimeout]),
            ...(options.asStream === true ? { asStream: true } : null)
          })
          result.statusCode = statusCode
          result.headers = headers

          if (headers['x-found-handling-cluster'] != null) {
            otelSpan?.setAttribute('db.elasticsearch.cluster.name', headers['x-found-handling-cluster'])
          }

          if (headers['x-found-handling-instance'] != null) {
            otelSpan?.setAttribute('db.elasticsearch.node.name', headers['x-found-handling-instance'])
          }

          if (this[kProductCheck] != null && headers['x-elastic-product'] !== this[kProductCheck] && statusCode >= 200 && statusCode < 300) {
            /* eslint-disable @typescript-eslint/prefer-ts-expect-error */
            // @ts-ignore
            throw new ProductNotSupportedError(this[kProductCheck], result, errorOptions)
            /* eslint-enable @typescript-eslint/prefer-ts-expect-error */
          }

          if (options.asStream === true) {
            result.body = body
            this[kDiagnostic].emit('response', null, result)
            return returnMeta ? result : body
          }

          const contentEncoding = (headers['content-encoding'] ?? '').toLowerCase()
          if (contentEncoding.includes('gzip') || contentEncoding.includes('deflate')) {
            body = await unzip(body)
          }

          const isVectorTile = (headers['content-type'] ?? '').includes('application/vnd.mapbox-vector-tile')
          if (Buffer.isBuffer(body) && !isVectorTile) {
            body = body.toString()
          }

          const isHead = params.method === 'HEAD'
          // we should attempt the payload deserialization only if:
          //    - a `content-type` is defined and is equal to `application/json`
          //    - the request is not a HEAD request
          //    - the payload is not an empty string
          if (headers['content-type'] !== undefined &&
              (headers['content-type']?.includes('application/json') ||
              headers['content-type']?.includes('application/vnd.elasticsearch+json')) &&
              !isHead && body !== '') { // eslint-disable-line
            result.body = this[kSerializer].deserialize(body as string)
          } else {
            // cast to boolean if the request method was HEAD and there was no error
            result.body = isHead && statusCode < 400 ? true : body
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
            throw new ResponseError(result, errorOptions)
          } else {
            // cast to boolean if the request method was HEAD
            if (isHead && statusCode === 404) {
              result.body = false
            }
            this[kDiagnostic].emit('response', null, result)
            return returnMeta ? result : result.body
          }
        } catch (error: any) {
          switch (error.name) {
            // should not retry
            case 'ProductNotSupportedError':
            case 'NoLivingConnectionsError':
            case 'DeserializationError':
            case 'ResponseError':
              this[kDiagnostic].emit('response', error, result)
              throw error
            case 'RequestAbortedError': {
              meta.aborted = true
              // Wrap the error to get a clean stack trace
              const wrappedError = new RequestAbortedError(error.message, result, errorOptions)
              this[kDiagnostic].emit('response', wrappedError, result)
              throw wrappedError
            }
            // should maybe retry
            // @ts-expect-error `case` fallthrough is intentional: should retry if retryOnTimeout is true
            case 'TimeoutError':
              if (!this[kRetryOnTimeout]) {
                const wrappedError = new TimeoutError(error.message, result, errorOptions)
                this[kDiagnostic].emit('response', wrappedError, result)
                throw wrappedError
              }
            // should retry
            // eslint-disable-next-line no-fallthrough
            case 'ConnectionError': {
              // if there is an error in the connection
              // let's mark the connection as dead
              this[kConnectionPool].markDead(meta.connection as Connection)

              if (this[kSniffOnConnectionFault]) {
                this.sniff({
                  reason: Transport.sniffReasons.SNIFF_ON_CONNECTION_FAULT,
                  requestId: meta.request.id,
                  context: meta.context
                })
              }

              // retry logic
              if (meta.attempts < maxRetries) {
                meta.attempts++
                debug(`Retrying request, there are still ${maxRetries - meta.attempts} attempts`, params)

                // exponential backoff on retries, with jitter
                const backoff = options.retryBackoff ?? this[kRetryBackoff]
                const backoffWait = backoff(0, 4, meta.attempts)
                if (backoffWait > 0) {
                  await setTimeoutPromise(backoffWait * 1000)
                }

                continue
              }

              // Wrap the error to get a clean stack trace
              const wrappedError = error.name === 'TimeoutError'
                ? new TimeoutError(error.message, result, errorOptions)
                : new ConnectionError(error.message, result, errorOptions)
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

      return returnMeta ? result : result.body
    }

    // wrap in OpenTelemetry span
    if (params.meta?.name != null) {
      return await otelTracer.startActiveSpan(params.meta.name, async (span) => {
        otelSpan = span
        otelSpan.setAttributes({
          'db.system': 'elasticsearch',
          'http.request.method': params.method,
          'db.operation.name': params.meta?.name
        })

        if (params.meta?.pathParts != null) {
          for (const key of Object.keys(params.meta.pathParts)) {
            otelSpan.setAttribute(`db.elasticsearch.path_parts.${key}`, params.meta.pathParts[key])
          }
        }

        let response
        try {
          response = await _request()
        } catch (err: any) {
          otelSpan.recordException(err as Exception)
          otelSpan.setStatus({ code: SpanStatusCode.ERROR })
          otelSpan.setAttribute('error.type', err.name ?? 'Error')

          throw err
        } finally {
          otelSpan.end()
        }

        return response
      })
    } else {
      return await _request()
    }
  }

  getConnection (opts: GetConnectionOptions): Connection | null {
    const now = Date.now()
    if (this[kSniffEnabled] && now > this[kNextSniff]) {
      this[kNextSniff] = now + (this[kSniffInterval] as number)
      this.sniff({
        reason: Transport.sniffReasons.SNIFF_INTERVAL,
        requestId: opts.requestId,
        context: opts.context
      })
    }
    return this[kConnectionPool].getConnection({
      filter: this[kNodeFilter],
      selector: this[kNodeSelector],
      requestId: opts.requestId,
      name: this[kName],
      context: opts.context,
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

export function generateRequestId (): generateRequestIdFn {
  const maxInt = 2147483647
  let nextReqId = 0
  return function genReqId (params, options) {
    return (nextReqId = (nextReqId + 1) & maxInt)
  }
}

export function lowerCaseHeaders (oldHeaders?: http.IncomingHttpHeaders): http.IncomingHttpHeaders | null {
  if (oldHeaders == null) return null
  const newHeaders: Record<string, string> = {}
  for (const header in oldHeaders) {
    // @ts-expect-error
    newHeaders[header.toLowerCase()] = oldHeaders[header]
  }
  return newHeaders
}

/**
 * Function for calculating how long to sleep, in seconds, before the next request retry
 * Uses the AWS "equal jitter" algorithm noted in this post:
 * https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 * @param min The minimum number of seconds to wait
 * @param max The maximum number of seconds to wait
 * @param attempt How many retry attempts have been made
 * @returns The number of seconds to wait before the next retry
 */
function retryBackoff (min: number, max: number, attempt: number): number {
  const ceiling = Math.min(max, 2 ** attempt) / 2
  return ceiling + ((Math.random() * (ceiling - min)) + min)
}
