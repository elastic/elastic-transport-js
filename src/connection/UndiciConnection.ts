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

/* eslint-disable @typescript-eslint/restrict-template-expressions */

import Debug from 'debug'
import buffer from 'node:buffer'
import { TLSSocket } from 'node:tls'
import { Socket } from 'node:net'
import BaseConnection, {
  ConnectionOptions,
  ConnectionRequestParams,
  ConnectionRequestOptions,
  ConnectionRequestOptionsAsStream,
  ConnectionRequestResponse,
  ConnectionRequestResponseAsStream,
  getIssuerCertificate,
  isCaFingerprintMatch,
  isBinary
} from './BaseConnection'
import { Pool, buildConnector, Dispatcher } from 'undici'
import {
  ConfigurationError,
  RequestAbortedError,
  ConnectionError,
  TimeoutError
} from '../errors'
import { UndiciAgentOptions } from '../types'
import { kCaFingerprint } from '../symbols'

const debug = Debug('elasticsearch')
const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/
const MAX_BUFFER_LENGTH = buffer.constants.MAX_LENGTH
const MAX_STRING_LENGTH = buffer.constants.MAX_STRING_LENGTH

/**
 * A connection to an Elasticsearch node, managed by the Undici HTTP client library
 */
export default class Connection extends BaseConnection {
  pool: Pool

  constructor (opts: ConnectionOptions) {
    super(opts)

    if (opts.proxy != null) {
      throw new ConfigurationError('Undici connection can\'t work with proxies')
    }

    if (typeof opts.agent === 'function' || typeof opts.agent === 'boolean') {
      throw new ConfigurationError('Undici connection agent options can\'t be a function or a boolean')
    }

    if (opts.agent != null && !isUndiciAgentOptions(opts.agent)) {
      throw new ConfigurationError('Bad agent configuration for Undici agent')
    }

    const undiciOptions: Pool.Options = {
      keepAliveTimeout: 600e3,
      keepAliveMaxTimeout: 600e3,
      keepAliveTimeoutThreshold: 1000,
      pipelining: 1,
      maxHeaderSize: 16384,
      connections: 256,
      // only set a timeout if it has a value; default to no timeout
      // see https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-network.html#_http_client_configuration
      headersTimeout: this.timeout ?? undefined,
      bodyTimeout: this.timeout ?? undefined,
      ...opts.agent
    }

    if (this[kCaFingerprint] !== null) {
      const caFingerprint = this[kCaFingerprint]
      const connector = buildConnector((this.tls ?? {}) as buildConnector.BuildOptions)
      undiciOptions.connect = function (opts: buildConnector.Options, cb: buildConnector.Callback) {
        connector(opts, (err, socket) => {
          if (err != null) {
            return cb(err, null)
          }
          if (caFingerprint !== null && isTlsSocket(opts, socket)) {
            const issuerCertificate = getIssuerCertificate(socket)
            /* istanbul ignore next */
            if (issuerCertificate == null) {
              socket.destroy()
              return cb(new Error('Invalid or malformed certificate'), null)
            }

            // Certificate will be empty if a session is reused. In this case, getPeerCertificate
            // will return an empty object, causing a fingeprint check to fail. But, if the session
            // is being reused, it means this socket's peer certificate fingerprint has already been
            // checked, so we can skip it and assume the connection is secure.
            // See https://github.com/nodejs/node/issues/3940#issuecomment-166696776
            if (Object.keys(issuerCertificate).length === 0 && socket.isSessionReused()) {
              return cb(null, socket)
            }

            // Check if fingerprint matches
            /* istanbul ignore else */
            if (!isCaFingerprintMatch(caFingerprint, issuerCertificate.fingerprint256)) {
              socket.destroy()
              return cb(new Error('Server certificate CA fingerprint does not match the value configured in caFingerprint'), null)
            }
          }
          return cb(null, socket)
        })
      }
    } else if (this.tls !== null) {
      undiciOptions.connect = this.tls as buildConnector.BuildOptions
    }

    this.pool = new Pool(this.url.toString(), undiciOptions)
  }

  async request (params: ConnectionRequestParams, options: ConnectionRequestOptions): Promise<ConnectionRequestResponse>
  async request (params: ConnectionRequestParams, options: ConnectionRequestOptionsAsStream): Promise<ConnectionRequestResponseAsStream>
  async request (params: ConnectionRequestParams, options: any): Promise<any> {
    const maxResponseSize = options.maxResponseSize ?? MAX_STRING_LENGTH
    const maxCompressedResponseSize = options.maxCompressedResponseSize ?? MAX_BUFFER_LENGTH
    const requestParams = {
      method: params.method,
      path: params.path + (params.querystring == null || params.querystring === '' ? '' : `?${params.querystring}`),
      headers: Object.assign({}, this.headers, params.headers),
      body: params.body,
      signal: options.signal ?? new AbortController().signal
    }

    if (requestParams.path[0] !== '/') {
      requestParams.path = `/${requestParams.path}`
    }

    // undici does not support per-request timeouts,
    // to address this issue, we default to the constructor
    // timeout (which is handled by undici) and create a local
    // setTimeout callback if the request-specific timeout
    // is different from the constructor timeout.
    let timedout = false
    let timeoutId
    if (options.timeout != null && options.timeout !== this.timeout) {
      timeoutId = setTimeout(() => {
        timedout = true
        requestParams.signal.dispatchEvent(new Event('abort'))
      }, options.timeout)
    }

    // https://github.com/nodejs/node/commit/b961d9fd83
    if (INVALID_PATH_REGEX.test(requestParams.path)) {
      throw new TypeError(`ERR_UNESCAPED_CHARACTERS: ${requestParams.path}`)
    }

    debug('Starting a new request', params)
    let response
    try {
      // @ts-expect-error method it's fine as string
      response = (await this.pool.request(requestParams)) as Dispatcher.ResponseData
      if (timeoutId != null) clearTimeout(timeoutId)
    } catch (err: any) {
      if (timeoutId != null) clearTimeout(timeoutId)
      switch (err.code) {
        case 'UND_ERR_ABORTED':
        case DOMException.ABORT_ERR:
          throw (timedout ? new TimeoutError('Request timed out') : new RequestAbortedError('Request aborted'))
        case 'UND_ERR_HEADERS_TIMEOUT':
          throw new TimeoutError('Request timed out')
        case 'UND_ERR_SOCKET':
          throw new ConnectionError(`${err.message} - Local: ${err.socket?.localAddress ?? 'unknown'}:${err.socket?.localPort ?? 'unknown'}, Remote: ${err.socket?.remoteAddress ?? 'unknown'}:${err.socket?.remotePort ?? 'unknown'}`) // eslint-disable-line
        default:
          throw new ConnectionError(err.message)
      }
    }

    if (options.asStream === true) {
      return {
        statusCode: response.statusCode,
        headers: response.headers,
        body: response.body
      }
    }

    // @ts-expect-error Assume header is not string[] for now.
    const contentEncoding = (response.headers['content-encoding'] ?? '').toLowerCase()
    const isCompressed = contentEncoding.includes('gzip') || contentEncoding.includes('deflate') // eslint-disable-line
    const bodyIsBinary = isBinary(response.headers['content-type'] ?? '')

    /* istanbul ignore else */
    if (response.headers['content-length'] !== undefined) {
      const contentLength = Number(response.headers['content-length'])
      if (isCompressed && contentLength > maxCompressedResponseSize) { // eslint-disable-line
        response.body.destroy()
        throw new RequestAbortedError(`The content length (${contentLength}) is bigger than the maximum allowed buffer (${maxCompressedResponseSize})`)
      } else if (contentLength > maxResponseSize) {
        response.body.destroy()
        throw new RequestAbortedError(`The content length (${contentLength}) is bigger than the maximum allowed string (${maxResponseSize})`)
      }
    }

    this.diagnostic.emit('deserialization', null, options)
    try {
      if (isCompressed || bodyIsBinary) { // eslint-disable-line
        let currentLength = 0
        const payload: Buffer[] = []
        for await (const chunk of response.body) {
          currentLength += Buffer.byteLength(chunk)
          if (currentLength > maxCompressedResponseSize) {
            response.body.destroy()
            throw new RequestAbortedError(`The content length (${currentLength}) is bigger than the maximum allowed buffer (${maxCompressedResponseSize})`)
          }
          payload.push(chunk)
        }
        return {
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(payload)
        }
      } else {
        let payload = ''
        let currentLength = 0
        response.body.setEncoding('utf8')
        for await (const chunk of response.body) {
          currentLength += Buffer.byteLength(chunk)
          if (currentLength > maxResponseSize) {
            response.body.destroy()
            throw new RequestAbortedError(`The content length (${currentLength}) is bigger than the maximum allowed string (${maxResponseSize})`)
          }
          payload += chunk as string
        }
        return {
          statusCode: response.statusCode,
          headers: response.headers,
          body: payload
        }
      }
    } catch (err: any) {
      if (err.name === 'RequestAbortedError') {
        throw err
      }
      throw new ConnectionError(err.message)
    }
  }

  async close (): Promise<void> {
    debug('Closing connection', this.id)
    await this.pool.close()
  }
}

/* istanbul ignore next */
function isUndiciAgentOptions (opts: Record<string, any>): opts is UndiciAgentOptions {
  if (opts.keepAlive != null) return false
  if (opts.keepAliveMsecs != null) return false
  if (opts.maxSockets != null) return false
  if (opts.maxFreeSockets != null) return false
  if (opts.scheduling != null) return false
  if (opts.proxy != null) return false
  return true
}

function isTlsSocket (opts: buildConnector.Options, socket: Socket | TLSSocket | null): socket is TLSSocket {
  return socket !== null && opts.protocol === 'https:'
}
