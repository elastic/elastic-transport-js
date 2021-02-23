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

import { inspect } from 'util'
import * as http from 'http'
import { URL } from 'url'
import { ConnectionOptions as TlsConnectionOptions } from 'tls'
import AbortController from 'node-abort-controller'
import Diagnostic from '../Diagnostic'
import { ApiKeyAuth, BasicAuth } from '../types'
import { ConfigurationError } from '../errors'

const kStatus = Symbol('status')
const kDiagnostic = Symbol('diagnostics')

export interface BaseConnectionOptions {
  url: URL
  ssl?: TlsConnectionOptions
  id?: string
  headers?: http.IncomingHttpHeaders
  status?: string
  auth?: BasicAuth | ApiKeyAuth
  diagnostic?: Diagnostic
}

export interface ConnectionRequestOptions {
  method: string
  path: string
  headers?: http.IncomingHttpHeaders
  asStream?: boolean
  body?: string | Buffer | ReadableStream | null
  querystring?: string
  abortController?: AbortController
  timeout?: number
}

export interface ConnectionRequestResponse {
  body: string | Buffer
  headers: http.IncomingHttpHeaders
  statusCode: number
}

export default class BaseConnection {
  url: URL
  ssl: TlsConnectionOptions | null
  id: string
  headers: http.IncomingHttpHeaders
  deadCount: number
  resurrectTimeout: number
  _openRequests: number
  weight: number
  [kStatus]: string
  [kDiagnostic]: Diagnostic

  static statuses = {
    ALIVE: 'alive',
    DEAD: 'dead'
  }

  constructor (opts: BaseConnectionOptions) {
    this.url = opts.url
    this.ssl = opts.ssl ?? null
    this.id = opts.id ?? stripAuth(opts.url.href)
    this.headers = prepareHeaders(opts.headers, opts.auth)
    this.deadCount = 0
    this.resurrectTimeout = 0
    this.weight = 0
    this._openRequests = 0
    this[kStatus] = opts.status ?? BaseConnection.statuses.ALIVE
    this[kDiagnostic] = opts.diagnostic ?? new Diagnostic()

    if (!['http:', 'https:'].includes(this.url.protocol)) {
      throw new ConfigurationError(`Invalid protocol: '${this.url.protocol}'`)
    }
  }

  get status (): string {
    return this[kStatus]
  }

  set status (status: string) {
    if (!validStatuses.includes(status)) {
      throw new ConfigurationError(`Unsupported status: '${status}'`)
    }
    this[kStatus] = status
  }

  get diagnostic (): Diagnostic {
    return this[kDiagnostic]
  }

  // Handles console.log and utils.inspect invocations.
  // We want to hide `auth`, `agent` and `ssl` since they made
  // the logs very hard to read. The user can still
  // access them with `instance.agent` and `instance.ssl`.
  [inspect.custom] (depth: number, options: Record<string, any>): Record<string, any> {
    const {
      authorization,
      ...headers
    } = this.headers

    return {
      url: stripAuth(this.url.toString()),
      id: this.id,
      headers,
      status: this.status
    }
  }

  toJSON (): Record<string, any> {
    const {
      authorization,
      ...headers
    } = this.headers

    return {
      url: stripAuth(this.url.toString()),
      id: this.id,
      headers,
      status: this.status
    }
  }
}

const validStatuses = Object.keys(BaseConnection.statuses)
  // @ts-expect-error
  .map(k => BaseConnection.statuses[k])

function stripAuth (url: string): string {
  if (!url.includes('@')) return url
  return url.slice(0, url.indexOf('//') + 2) + url.slice(url.indexOf('@') + 1)
}

function prepareHeaders (headers: http.IncomingHttpHeaders = {}, auth?: BasicAuth | ApiKeyAuth): http.IncomingHttpHeaders {
  if (auth != null && headers.authorization == null) {
    /* istanbul ignore else */
    if (isApiKeyAuth(auth)) {
      if (typeof auth.apiKey === 'object') {
        headers.authorization = 'ApiKey ' + Buffer.from(`${auth.apiKey.id}:${auth.apiKey.api_key}`).toString('base64')
      } else {
        headers.authorization = `ApiKey ${auth.apiKey}`
      }
    } else if (auth.username != null && auth.password != null) {
      headers.authorization = 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64')
    }
  }
  return headers
}

function isApiKeyAuth (auth: Record<string, any>): auth is ApiKeyAuth {
  return auth.apiKey != null
}
