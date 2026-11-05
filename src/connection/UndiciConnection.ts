/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/restrict-template-expressions */

import Debug from 'debug'
import buffer from 'node:buffer'
import BaseConnection, {
  ConnectionOptions,
  ConnectionRequestParams,
  ConnectionRequestOptions,
  ConnectionRequestOptionsAsStream,
  ConnectionRequestResponse,
  ConnectionRequestResponseAsStream,
  isBinary
} from './BaseConnection'
import { assertCaFingerprintOptions, fetchPinnedCaPem, pinOnce, PinSlot } from './caFingerprint'
import { Pool, buildConnector } from 'undici'
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
  private readonly undiciAgent?: UndiciAgentOptions
  private readonly pinSlot: PinSlot = { task: null }

  constructor (opts: ConnectionOptions) {
    super(opts)
    assertCaFingerprintOptions(opts)

    if (opts.proxy != null) {
      throw new ConfigurationError('Undici connection can\'t work with proxies')
    }

    if (typeof opts.agent === 'boolean') {
      throw new ConfigurationError('Undici connection agent options can\'t be a boolean')
    }

    // function agent must return an undici-compatible pool and skips built-in tls handling
    // caFingerprint with a function agent throws
    if (typeof opts.agent === 'function') {
      this.pool = opts.agent(opts)
    } else {
      if (opts.agent != null && !isUndiciAgentOptions(opts.agent)) {
        throw new ConfigurationError('Bad agent configuration for Undici agent')
      }
      this.undiciAgent = typeof opts.agent === 'object' ? opts.agent : undefined
      this.pool = this.createPool()
    }
  }

  async request (params: ConnectionRequestParams, options: ConnectionRequestOptions): Promise<ConnectionRequestResponse>
  async request (params: ConnectionRequestParams, options: ConnectionRequestOptionsAsStream): Promise<ConnectionRequestResponseAsStream>
  async request (params: ConnectionRequestParams, options: any): Promise<any> {
    if (this[kCaFingerprint] != null && this.url.protocol === 'https:') {
      await pinOnce(this.pinSlot, async () => await this.pinCa())
      if (options.signal?.aborted === true) throw new RequestAbortedError('Request aborted')
    }
    const maxResponseSize = options.maxResponseSize ?? MAX_STRING_LENGTH
    const maxCompressedResponseSize = options.maxCompressedResponseSize ?? MAX_BUFFER_LENGTH
    const pathPrefix = this.url.pathname === '/' ? '' : this.url.pathname.replace(/\/$/, '')
    const requestParams = {
      origin: this.url,
      method: params.method,
      path: pathPrefix + params.path + (params.querystring == null || params.querystring === '' ? '' : `?${params.querystring}`),
      headers: Object.assign({}, this.headers, params.headers),
      body: params.body,
      signal: options.signal ?? new AbortController().signal,
      reset: false
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
      response = await this.pool.request(requestParams)
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
        const payload: Buffer[] = []
        let currentLength = 0
        for await (const chunk of response.body) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          currentLength += buf.byteLength
          if (currentLength > maxResponseSize) {
            response.body.destroy()
            throw new RequestAbortedError(`The content length (${currentLength}) is bigger than the maximum allowed string (${maxResponseSize})`)
          }
          payload.push(buf)
        }
        return {
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(payload).toString('utf8')
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

  private createPool (): Pool {
    const undiciOptions: Pool.Options = {
      keepAliveTimeout: 600e3,
      keepAliveMaxTimeout: 600e3,
      keepAliveTimeoutThreshold: 1000,
      pipelining: 1,
      maxHeaderSize: 16384,
      connections: 256,
      // only set a timeout if it has a value; default to no timeout
      // see https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-network.html#_http_client_configuration
      headersTimeout: this.timeout ?? 0,
      bodyTimeout: this.timeout ?? 0,
      ...this.undiciAgent
    }
    if (this.tls != null) {
      undiciOptions.connect = this.tls as buildConnector.BuildOptions
    }
    return new Pool(this.url.origin, undiciOptions)
  }

  private async pinCa (): Promise<void> {
    const pem = await fetchPinnedCaPem(this.url, this[kCaFingerprint] as string, this.timeout, {
      tls: this.tls
    })
    this.tls = { ...(this.tls ?? {}), ca: pem, rejectUnauthorized: true }
    await this.pool.close()
    this.pool = this.createPool()
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
