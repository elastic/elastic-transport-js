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
import buffer from 'buffer'
import BaseConnection, {
  BaseConnectionOptions,
  ConnectionRequestOptions,
  ConnectionRequestResponse
} from './BaseConnection'
import { Pool } from 'undici'
import {
  RequestAbortedError,
  ConnectionError,
  TimeoutError
} from '../errors'
import { TlsOptions } from 'tls'

const debug = Debug('elasticsearch')
const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/
const MAX_BUFFER_LENGTH = buffer.constants.MAX_LENGTH
const MAX_STRING_LENGTH = buffer.constants.MAX_STRING_LENGTH

export default class Connection extends BaseConnection {
  pool: Pool

  constructor (opts: BaseConnectionOptions) {
    super(opts)
    this.pool = new Pool(this.url.toString(), {
      tls: this.ssl as TlsOptions,
      headersTimeout: this.timeout,
      // @ts-expect-error
      bodyTimeout: this.timeout
    })
  }

  async request (params: ConnectionRequestOptions): Promise<ConnectionRequestResponse> {
    const requestParams = {
      method: params.method,
      path: params.path + (params.querystring == null || params.querystring === '' ? '' : `?${params.querystring}`),
      headers: Object.assign({}, this.headers, params.headers),
      body: params.body,
      signal: params.abortController?.signal
    }
    // https://github.com/nodejs/node/commit/b961d9fd83
    if (INVALID_PATH_REGEX.test(requestParams.path)) {
      throw new TypeError(`ERR_UNESCAPED_CHARACTERS: ${requestParams.path}`)
    }

    debug('Starting a new request', params)
    let response
    try {
      response = await this.pool.request(requestParams)
    } catch (err) {
      switch (err.code) {
        case 'UND_ERR_ABORTED':
          throw new RequestAbortedError('Request aborted')
        case 'UND_ERR_HEADERS_TIMEOUT':
          throw new TimeoutError('Request timed out')
        default:
          throw new ConnectionError(err.message)
      }
    }

    const contentEncoding = (response.headers['content-encoding'] ?? '').toLowerCase()
    const isCompressed = contentEncoding.includes('gzip') || contentEncoding.includes('deflate')

    /* istanbul ignore else */
    if (response.headers['content-length'] !== undefined) {
      const contentLength = Number(response.headers['content-length'])
      if (isCompressed && contentLength > MAX_BUFFER_LENGTH) {
        response.body.destroy()
        throw new RequestAbortedError(`The content length (${contentLength}) is bigger than the maximum allowed buffer (${MAX_BUFFER_LENGTH})`)
      } else if (contentLength > MAX_STRING_LENGTH) {
        response.body.destroy()
        throw new RequestAbortedError(`The content length (${contentLength}) is bigger than the maximum allowed string (${MAX_STRING_LENGTH})`)
      }
    }

    // TODO: fixme
    // this.diagnostic.emit('deserialization', null, result)
    try {
      if (isCompressed) {
        const payload: Buffer[] = []
        for await (const chunk of response.body) {
          payload.push(chunk)
        }
        return {
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(payload)
        }
      } else {
        let payload = ''
        response.body.setEncoding('utf8')
        for await (const chunk of response.body) {
          payload += chunk as string
        }
        return {
          statusCode: response.statusCode,
          headers: response.headers,
          body: payload
        }
      }
    } catch (err) {
      throw new ConnectionError(err.message)
    }
  }

  async close (): Promise<void> {
    debug('Closing connection', this.id)
    await this.pool.close()
  }
}
