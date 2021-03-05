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

import hpagent from 'hpagent'
import http from 'http'
import https from 'https'
import Debug from 'debug'
import buffer from 'buffer'
import { promisify } from 'util'
import BaseConnection, {
  ConnectionOptions,
  ConnectionRequestParams,
  ConnectionRequestOptions,
  ConnectionRequestResponse
} from './BaseConnection'
import { Readable as ReadableStream, pipeline } from 'stream'
import {
  ConfigurationError,
  ConnectionError,
  RequestAbortedError,
  TimeoutError
} from '../errors'
import { HttpAgentOptions } from '../types'

const sleep = promisify(setTimeout)
const debug = Debug('elasticsearch')
const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/
const MAX_BUFFER_LENGTH = buffer.constants.MAX_LENGTH
const MAX_STRING_LENGTH = buffer.constants.MAX_STRING_LENGTH

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
          : new hpagent.HttpsProxyAgent(Object.assign({}, proxyAgentOptions, this.ssl))
      } else {
        this.agent = this.url.protocol === 'http:'
          ? new http.Agent(agentOptions)
          : new https.Agent(Object.assign({}, agentOptions, this.ssl))
      }
    }

    this.makeRequest = this.url.protocol === 'http:'
      ? http.request
      : https.request
  }

  async request (params: ConnectionRequestParams, options: ConnectionRequestOptions): Promise<ConnectionRequestResponse> {
    return await new Promise((resolve, reject) => {
      this._openRequests++
      let cleanedListeners = false

      const requestParams = this.buildRequestObject(params)
      // https://github.com/nodejs/node/commit/b961d9fd83
      if (INVALID_PATH_REGEX.test(requestParams.path as string)) {
        return reject(new TypeError(`ERR_UNESCAPED_CHARACTERS: ${requestParams.path as string}`))
      }

      debug('Starting a new request', params)
      const request = this.makeRequest(requestParams)

      if (params.abortController != null) {
        params.abortController.signal.addEventListener(
          'abort',
          () => request.abort(),
          { once: true }
        )
      }

      const onResponse = (response: http.IncomingMessage): void => {
        cleanListeners()
        this._openRequests--

        const contentEncoding = (response.headers['content-encoding'] ?? '').toLowerCase()
        const isCompressed = contentEncoding.includes('gzip') || contentEncoding.includes('deflate')

        /* istanbul ignore else */
        if (response.headers['content-length'] !== undefined) {
          const contentLength = Number(response.headers['content-length'])
          if (isCompressed && contentLength > MAX_BUFFER_LENGTH) {
            response.destroy()
            return reject(
              new RequestAbortedError(`The content length (${contentLength}) is bigger than the maximum allowed buffer (${MAX_BUFFER_LENGTH})`)
            )
          } else if (contentLength > MAX_STRING_LENGTH) {
            response.destroy()
            return reject(
              new RequestAbortedError(`The content length (${contentLength}) is bigger than the maximum allowed string (${MAX_STRING_LENGTH})`)
            )
          }
        }

        // if the response is compressed, we must handle it
        // as buffer for allowing decompression later
        let payload = isCompressed ? new Array<Buffer>() : ''
        const onData = isCompressed
          ? (chunk: Buffer) => { (payload as Buffer[]).push(chunk) }
          : (chunk: string) => { payload = `${payload as string}${chunk}` }
        const onEnd = (err: Error): void => {
          response.removeListener('data', onData)
          response.removeListener('end', onEnd)
          response.removeListener('error', onEnd)
          response.removeListener('aborted', onAbort)

          if (err != null) {
            return reject(new ConnectionError(err.message))
          }

          resolve({
            body: isCompressed ? Buffer.concat(payload as Buffer[]) : payload as string,
            statusCode: response.statusCode as number,
            headers: response.headers
          })
        }

        const onAbort = (): void => {
          response.destroy()
          onEnd(new Error('Response aborted while reading the body'))
        }

        if (!isCompressed) {
          response.setEncoding('utf8')
        }

        this.diagnostic.emit('deserialization', null, options)
        response.on('data', onData)
        response.on('error', onEnd)
        response.on('end', onEnd)
        response.on('aborted', onAbort)
      }

      const onTimeout = (): void => {
        cleanListeners()
        this._openRequests--
        request.once('error', () => {}) // we need to catch the request aborted error
        request.abort()
        reject(new TimeoutError('Request timed out'))
      }

      const onError = (err: Error): void => {
        cleanListeners()
        this._openRequests--
        reject(new ConnectionError(err.message))
      }

      const onAbort = (): void => {
        cleanListeners()
        request.once('error', () => {}) // we need to catch the request aborted error
        debug('Request aborted', params)
        this._openRequests--
        reject(new RequestAbortedError('Request aborted'))
      }

      request.on('response', onResponse)
      request.on('timeout', onTimeout)
      request.on('error', onError)
      request.on('abort', onAbort)

      // Disables the Nagle algorithm
      request.setNoDelay(true)

      // starts the request
      if (isStream(params.body)) {
        pipeline(params.body, request, err => {
          /* istanbul ignore if  */
          if (err != null && !cleanedListeners) {
            cleanListeners()
            this._openRequests--
            reject(err)
          }
        })
      } else {
        request.end(params.body)
      }

      return request

      function cleanListeners (): void {
        request.removeListener('response', onResponse)
        request.removeListener('timeout', onTimeout)
        request.removeListener('error', onError)
        request.removeListener('abort', onAbort)
        cleanedListeners = true
      }
    })
  }

  async close (): Promise<void> {
    debug('Closing connection', this.id)
    while (this._openRequests > 0) {
      await sleep(1000)
    }
    /* istanbul ignore else */
    if (this.agent !== undefined) {
      this.agent.destroy()
    }
  }

  buildRequestObject (params: ConnectionRequestParams): http.ClientRequestArgs {
    const url = this.url
    const request = {
      protocol: url.protocol,
      hostname: url.hostname[0] === '['
        ? url.hostname.slice(1, -1)
        : url.hostname,
      hash: url.hash,
      search: url.search,
      pathname: url.pathname,
      path: '',
      href: url.href,
      origin: url.origin,
      // https://github.com/elastic/elasticsearch-js/issues/843
      port: url.port !== '' ? url.port : undefined,
      headers: this.headers,
      agent: this.agent,
      timeout: this.timeout
    }

    const paramsKeys = Object.keys(params)
    for (let i = 0, len = paramsKeys.length; i < len; i++) {
      const key = paramsKeys[i]
      if (key === 'path') {
        request.pathname = resolve(request.pathname, params[key])
      } else if (key === 'querystring' && Boolean(params[key])) {
        if (request.search === '') {
          request.search = `?${params[key] as string}`
        } else {
          request.search += `&${params[key] as string}`
        }
      } else if (key === 'headers') {
        request.headers = Object.assign({}, request.headers, params.headers)
      } else {
        // @ts-expect-error
        request[key] = params[key]
      }
    }

    request.path = request.pathname + request.search

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
