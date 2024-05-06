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

import type http from 'http'
import Debug from 'debug'
import BaseConnection, {
  ConnectionRequestParams,
  ConnectionRequestOptions,
  ConnectionRequestOptionsAsStream,
  ConnectionRequestResponse,
  ConnectionRequestResponseAsStream,
  ConnectionOptions
} from './BaseConnection'
import { IncomingHttpHeaders } from 'http'
import { TimeoutError } from '../errors'

const debug = Debug('elasticsearch')
const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/

export interface FetchConnectionOptions extends Omit<ConnectionOptions, 'agent'> {
  keepAlive?: boolean
}

export default class FetchConnection extends BaseConnection {
  public readonly feth = fetch
  public readonly keepAlive: FetchConnectionOptions['keepAlive']

  constructor (opts: FetchConnectionOptions) {
    super(opts)
    this.keepAlive = opts.keepAlive
  }

  async request (params: ConnectionRequestParams, options: ConnectionRequestOptions): Promise<ConnectionRequestResponse>
  async request (params: ConnectionRequestParams, options: ConnectionRequestOptionsAsStream): Promise<ConnectionRequestResponseAsStream>
  async request (params: ConnectionRequestParams, options: any): Promise<any> {
    // eslint-disable-next-line
    return await new Promise(async (resolve, reject) => {
      // const maxResponseSize = options.maxResponseSize ?? MAX_STRING_LENGTH
      // const maxCompressedResponseSize = options.maxCompressedResponseSize ?? MAX_BUFFER_LENGTH
      const requestParams = this.buildRequestObject(params, options)
      // https://github.com/nodejs/node/commit/b961d9fd83
      if (INVALID_PATH_REGEX.test(requestParams.path as string)) {
        reject(new TypeError(`ERR_UNESCAPED_CHARACTERS: ${requestParams.path as string}`))
        return
      }

      debug('Starting a new request', params)
      let response: Response
      const abrotController = new AbortController()
      const timeoutSignal = typeof options.timeout === 'number' ? AbortSignal.timeout(options.timeout) : undefined

      console.log(options.timeout)
      const onTimeout = (): void => {
        console.log('On timeout')
        reject(new TimeoutError('Request timed out'))
      }

      timeoutSignal?.addEventListener('abort', onTimeout, { once: true })

      try {
        // eslint-disable-next-line: @typescript-eslint/restrict-plus-operands
        const url = new URL(params.path + '?' + (params.querystring ?? ''), this.url)
          .toString()

        this._openRequests++
        const headers = new Headers(params.headers as HeadersInit)
        response = await this.feth(
          url,
          {
            // @ts-expect-error
            body: params.body,
            headers,
            keepalive: this.keepAlive,
            // @ts-expect-error
            signal: AbortSignal.any([
              abrotController.signal,
              options.signal,
              timeoutSignal
            ].filter(Boolean))
          })
      } finally {
        this._openRequests--
      }

      const abortListener = (): void => {
        abrotController.abort()
      }

      if ('signal' in options && options.signal != null) {
        options.signal.addEventListener(
          'abort',
          abortListener,
          { once: true }
        )
      }

      if ('asStream' in options) {
        resolve({
          body: response.body,
          statusCode: response.status,
          headers: mapHeaders(response.headers)
        })
      }

      resolve({
        body: await response.text(),
        statusCode: response.status,
        headers: mapHeaders(response.headers)
      })
    })
  }

  async close (): Promise<void> {
    debug('Closing connection', this.id)
    while (this._openRequests > 0) {
      await sleep(1000)
    }
  }

  buildRequestObject (params: ConnectionRequestParams, options: ConnectionRequestOptions): http.ClientRequestArgs {
    const url = this.url
    let search = url.search
    let pathname = url.pathname
    const request = {
      protocol: url.protocol,
      hostname: url.hostname[0] === '['
        ? url.hostname.slice(1, -1)
        : url.hostname,
      path: '',
      // https://github.com/elastic/elasticsearch-js/issues/843
      port: url.port !== '' ? url.port : undefined,
      headers: this.headers,
      timeout: options.timeout ?? this.timeout
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

async function sleep (ms: number): Promise<unknown> {
  return await new Promise((resolve) => setTimeout(resolve, ms))
}

function mapHeaders (headers: Response['headers']): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {}
  headers.forEach((value, key) => { result[key] = value })
  return result
}
