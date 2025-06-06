/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/restrict-template-expressions */

import hpagent from 'hpagent'
import http from 'node:http'
import https from 'node:https'
import Debug from 'debug'
import buffer from 'node:buffer'
import { TLSSocket } from 'node:tls'
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
import { kCaFingerprint } from '../symbols'
import { Readable as ReadableStream, pipeline } from 'node:stream'
import {
  ConfigurationError,
  ConnectionError,
  RequestAbortedError,
  TimeoutError
} from '../errors'
import { setTimeout } from 'node:timers/promises'
import { HttpAgentOptions } from '../types'

const debug = Debug('elasticsearch')
const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/
const MAX_BUFFER_LENGTH = buffer.constants.MAX_LENGTH
const MAX_STRING_LENGTH = buffer.constants.MAX_STRING_LENGTH
const noop = (): void => {}

/**
 * A connection to an Elasticsearch node, managed by the `http` client in the standard library
 */
export default class HttpConnection extends BaseConnection {
  agent?: http.Agent | https.Agent | hpagent.HttpProxyAgent | hpagent.HttpsProxyAgent
  makeRequest: typeof http.request | typeof https.request

  constructor (opts: ConnectionOptions) {
    super(opts)

    if (typeof opts.agent === 'function') {
      this.agent = opts.agent(opts)
    } else if (typeof opts.agent === 'boolean') {
      this.agent = undefined
    } else {
      if (opts.agent != null && !isHttpAgentOptions(opts.agent)) {
        throw new ConfigurationError('Bad agent configuration for Http agent')
      }
      const agentOptions = Object.assign({}, {
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 256,
        maxFreeSockets: 256,
        scheduling: 'lifo'
      }, opts.agent)
      if (opts.proxy != null) {
        const proxyAgentOptions = {
          ...agentOptions,
          proxy: opts.proxy
        }
        this.agent = this.url.protocol === 'http:'
          ? new hpagent.HttpProxyAgent(proxyAgentOptions)
          : new hpagent.HttpsProxyAgent(Object.assign({}, proxyAgentOptions, this.tls))
      } else {
        this.agent = this.url.protocol === 'http:'
          ? new http.Agent(agentOptions)
          : new https.Agent(Object.assign({}, agentOptions, this.tls))
      }
    }

    this.makeRequest = this.url.protocol === 'http:'
      ? http.request
      : https.request
  }

  async request (params: ConnectionRequestParams, options: ConnectionRequestOptions): Promise<ConnectionRequestResponse>
  async request (params: ConnectionRequestParams, options: ConnectionRequestOptionsAsStream): Promise<ConnectionRequestResponseAsStream>
  async request (params: ConnectionRequestParams, options: any): Promise<any> {
    return await new Promise((resolve, reject) => {
      let cleanedListeners = false

      const maxResponseSize = options.maxResponseSize ?? MAX_STRING_LENGTH
      const maxCompressedResponseSize = options.maxCompressedResponseSize ?? MAX_BUFFER_LENGTH
      const requestParams = this.buildRequestObject(params, options)
      // https://github.com/nodejs/node/commit/b961d9fd83
      if (INVALID_PATH_REGEX.test(requestParams.path as string)) {
        return reject(new TypeError(`ERR_UNESCAPED_CHARACTERS: ${requestParams.path as string}`))
      }

      debug('Starting a new request', params)

      // tracking response.end, request.finish and the value of the returnable response object here is necessary:
      // we only know a request is truly finished when one of the following is true:
      // - request.finish and response.end have both fired (success)
      // - request.error has fired (failure)
      // - response.close has fired (failure)
      let responseEnded = false
      let requestFinished = false
      let connectionRequestResponse: ConnectionRequestResponse | ConnectionRequestResponseAsStream

      let request: http.ClientRequest
      try {
        request = this.makeRequest(requestParams)
      } catch (err: any) {
        return reject(err)
      }

      const abortListener = (): void => {
        request.destroy(new RequestAbortedError('Request aborted'))
      }

      this._openRequests++
      if (options.signal != null) {
        options.signal.addEventListener(
          'abort',
          abortListener,
          { once: true }
        )
      }

      let response: http.IncomingMessage

      const onResponseClose = (): void => {
        return reject(new ConnectionError('Connection closed while reading the body'))
      }

      const onResponse = (res: http.IncomingMessage): void => {
        response = res

        cleanListeners()

        if (options.asStream === true) {
          return resolve({
            body: response,
            statusCode: response.statusCode as number,
            headers: response.headers
          })
        }

        const contentEncoding = (response.headers['content-encoding'] ?? '').toLowerCase()
        const isCompressed = contentEncoding.includes('gzip') || contentEncoding.includes('deflate')
        const bodyIsBinary = isBinary(response.headers['content-type'] ?? '')

        /* istanbul ignore else */
        if (response.headers['content-length'] !== undefined) {
          const contentLength = Number(response.headers['content-length'])
          if (isCompressed && contentLength > maxCompressedResponseSize) {
            response.destroy()
            return reject(
              new RequestAbortedError(`The content length (${contentLength}) is bigger than the maximum allowed buffer (${maxCompressedResponseSize})`)
            )
          } else if (contentLength > maxResponseSize) {
            response.destroy()
            return reject(
              new RequestAbortedError(`The content length (${contentLength}) is bigger than the maximum allowed string (${maxResponseSize})`)
            )
          }
        }

        // if the response is compressed, we must handle it
        // as buffer for allowing decompression later
        let payload = isCompressed || bodyIsBinary ? new Array<Buffer>() : ''
        const onData = isCompressed || bodyIsBinary ? onDataAsBuffer : onDataAsString

        let currentLength = 0
        function onDataAsBuffer (chunk: Buffer): void {
          currentLength += Buffer.byteLength(chunk)
          if (currentLength > maxCompressedResponseSize) {
            response.destroy(new RequestAbortedError(`The content length (${currentLength}) is bigger than the maximum allowed buffer (${maxCompressedResponseSize})`))
          } else {
            (payload as Buffer[]).push(chunk)
          }
        }

        function onDataAsString (chunk: string): void {
          currentLength += Buffer.byteLength(chunk)
          if (currentLength > maxResponseSize) {
            response.destroy(new RequestAbortedError(`The content length (${currentLength}) is bigger than the maximum allowed string (${maxResponseSize})`))
          } else {
            payload = `${payload as string}${chunk}`
          }
        }

        const onEnd = (): void => {
          response.removeListener('data', onData)
          response.removeListener('end', onEnd)

          responseEnded = true

          connectionRequestResponse = {
            body: isCompressed || bodyIsBinary ? Buffer.concat(payload as Buffer[]) : payload as string,
            statusCode: response.statusCode as number,
            headers: response.headers
          }

          if (requestFinished) {
            response.removeListener('close', onResponseClose)
            return resolve(connectionRequestResponse)
          }
        }

        if (!isCompressed && !bodyIsBinary) {
          response.setEncoding('utf8')
        }

        this.diagnostic.emit('deserialization', null, options)
        response.on('data', onData)
        response.on('end', onEnd)
        response.on('close', onResponseClose)
      }

      const onTimeout = (): void => {
        cleanListeners()
        request.once('error', noop) // we need to catch the request aborted error
        request.destroy()
        return reject(new TimeoutError('Request timed out'))
      }

      const onError = (err: Error): void => {
        // @ts-expect-error
        let { name, message, code } = err

        // ignore this error, it means we got a response body for a request that didn't expect a body (e.g. HEAD)
        // rather than failing, let it return a response with an empty string as body
        if (code === 'HPE_INVALID_CONSTANT' && message.startsWith('Parse Error: Expected HTTP/')) return

        cleanListeners()
        if (name === 'RequestAbortedError') {
          return reject(err)
        }

        if (code === 'ECONNRESET') {
          message += ` - Local: ${request.socket?.localAddress ?? 'unknown'}:${request.socket?.localPort ?? 'unknown'}, Remote: ${request.socket?.remoteAddress ?? 'unknown'}:${request.socket?.remotePort ?? 'unknown'}`
        } else if (code === 'EPIPE') {
          message = 'Response aborted while reading the body'
        }
        return reject(new ConnectionError(message))
      }

      const onSocket = (socket: TLSSocket): void => {
        /* istanbul ignore else */
        if (!socket.isSessionReused()) {
          socket.once('secureConnect', () => {
            const issuerCertificate = getIssuerCertificate(socket)
            /* istanbul ignore next */
            if (issuerCertificate == null) {
              onError(new Error('Invalid or malformed certificate'))
              request.once('error', noop) // we need to catch the request aborted error
              return request.destroy()
            }

            // Check if fingerprint matches
            /* istanbul ignore else */
            if (!isCaFingerprintMatch(this[kCaFingerprint], issuerCertificate.fingerprint256)) {
              onError(new Error('Server certificate CA fingerprint does not match the value configured in caFingerprint'))
              request.once('error', noop) // we need to catch the request aborted error
              return request.destroy()
            }
          })
        }
      }

      const onFinish = (): void => {
        requestFinished = true

        if (responseEnded) {
          response?.removeListener('close', onResponseClose)
          if (connectionRequestResponse != null) {
            return resolve(connectionRequestResponse)
          } else {
            return reject(new Error('No response body received'))
          }
        }
      }

      const cleanListeners = (): void => {
        if (cleanedListeners) return

        this._openRequests--

        // we do NOT stop listening to request.error here
        // all errors we care about in the request/response lifecycle will bubble up to request.error, and may occur even after the request has been sent
        request.removeListener('response', onResponse)
        request.removeListener('timeout', onTimeout)
        request.removeListener('socket', onSocket)
        if (options.signal != null) {
          if ('removeEventListener' in options.signal) {
            options.signal.removeEventListener('abort', abortListener)
          } else {
            options.signal.removeListener('abort', abortListener)
          }
        }
        cleanedListeners = true
      }

      request.on('response', onResponse)
      request.on('timeout', onTimeout)
      request.on('error', onError)
      request.on('finish', onFinish)
      if (this[kCaFingerprint] != null && requestParams.protocol === 'https:') {
        request.on('socket', onSocket)
      }

      // Disables the Nagle algorithm
      request.setNoDelay(true)

      // starts the request
      if (isStream(params.body)) {
        pipeline(params.body, request, err => {
          /* istanbul ignore if  */
          if (err != null && !cleanedListeners) {
            cleanListeners()
            return reject(err)
          }
        })
      } else {
        request.end(params.body)
      }
    })
  }

  async close (): Promise<void> {
    debug('Closing connection', this.id)
    while (this._openRequests > 0) {
      await setTimeout(1000)
    }
    /* istanbul ignore else */
    if (this.agent !== undefined) {
      this.agent.destroy()
    }
  }

  buildRequestObject (params: ConnectionRequestParams, options: ConnectionRequestOptions): http.ClientRequestArgs {
    const url = this.url
    let search = url.search
    let pathname = url.pathname
    const request: http.ClientRequestArgs = {
      protocol: url.protocol,
      hostname: url.hostname[0] === '['
        ? url.hostname.slice(1, -1)
        : url.hostname,
      path: '',
      // https://github.com/elastic/elasticsearch-js/issues/843
      port: url.port !== '' ? url.port : undefined,
      headers: this.headers,
      agent: this.agent,
      // only set a timeout if it has a value; default to no timeout
      // see https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-network.html#_http_client_configuration
      timeout: options.timeout ?? this.timeout ?? undefined
    }

    const paramsKeys = Object.keys(params)
    for (let i = 0, len = paramsKeys.length; i < len; i++) {
      const key = paramsKeys[i]
      if (key === 'path') {
        pathname = resolve(pathname, params[key])
      } else if (key === 'querystring' && Boolean(params[key])) {
        if (search === '') {
          search = `?${params[key] as string}`
        } else {
          search += `&${params[key] as string}`
        }
      } else if (key === 'headers') {
        request.headers = Object.assign({}, request.headers, params.headers)
      } else {
        // @ts-expect-error
        request[key] = params[key]
      }
    }

    request.path = pathname + search

    return request
  }
}

function isStream (obj: any): obj is ReadableStream {
  return obj != null && typeof obj.pipe === 'function'
}

function resolve (host: string, path: string): string {
  const hostEndWithSlash = host[host.length - 1] === '/'
  const pathStartsWithSlash = path[0] === '/'

  if (hostEndWithSlash && pathStartsWithSlash) {
    return host + path.slice(1)
  } else if (hostEndWithSlash !== pathStartsWithSlash) {
    return host + path
  } else {
    return host + '/' + path
  }
}

/* istanbul ignore next */
function isHttpAgentOptions (opts: Record<string, any>): opts is HttpAgentOptions {
  if (opts.keepAliveTimeout != null) return false
  if (opts.keepAliveMaxTimeout != null) return false
  if (opts.keepAliveTimeoutThreshold != null) return false
  if (opts.pipelining != null) return false
  if (opts.maxHeaderSize != null) return false
  if (opts.connections != null) return false
  return true
}
