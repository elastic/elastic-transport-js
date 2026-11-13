/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as http from 'node:http'
import { Middleware, MiddlewareContext, MiddlewareName, MiddlewarePriority, MiddlewareRequestUpdate } from './types'
import { shouldSerialize, lowerCaseHeaders } from '../utils'

export interface DefaultHeadersOptions {
  headers: http.IncomingHttpHeaders
  opaqueIdPrefix: string | null
  jsonContentType: string
  ndjsonContentType: string
  acceptHeader: string
}

/** Merges default, per-request and body-dependent `content-type`/`accept` headers into the request */
export class DefaultHeaders implements Middleware {
  readonly name = MiddlewareName.DEFAULT_HEADERS
  readonly priority = MiddlewarePriority[MiddlewareName.DEFAULT_HEADERS]

  constructor (private readonly options: DefaultHeadersOptions) {}

  onBeforeRequest = (ctx: MiddlewareContext): MiddlewareRequestUpdate => {
    const { jsonContentType, ndjsonContentType, acceptHeader, opaqueIdPrefix } = this.options
    const { params, options } = ctx
    const body = ctx.request.body
    const headers: http.IncomingHttpHeaders = { ...this.options.headers, ...lowerCaseHeaders(options.headers), ...ctx.request.headers }

    if (options.opaqueId !== undefined) {
      headers['x-opaque-id'] = typeof opaqueIdPrefix === 'string' ? opaqueIdPrefix + options.opaqueId : options.opaqueId
    }

    if (params.body != null) {
      if (shouldSerialize(params.body)) {
        headers['content-type'] = headers['content-type'] ?? jsonContentType
        headers.accept = headers.accept ?? jsonContentType
      } else if (params.body !== '') {
        headers['content-type'] = headers['content-type'] ?? 'text/plain'
        headers.accept = headers.accept ?? acceptHeader
      }
    } else if (params.bulkBody != null && body !== '') {
      headers['content-type'] = headers['content-type'] ?? ndjsonContentType
      headers.accept = headers.accept ?? jsonContentType
    }

    headers.accept = headers.accept ?? acceptHeader

    if (headers['content-type'] == null && (body == null || body === '')) {
      headers['content-type'] = jsonContentType
    }

    return { headers }
  }
}
