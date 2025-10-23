/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as http from 'node:http'
import { Middleware, MiddlewareContext, MiddlewareResult } from './types'
import { lowerCaseHeaders } from '../Transport'

export interface HeaderManagementOptions {
  userAgent?: string
  clientMeta?: string
  acceptEncoding?: string
  opaqueIdPrefix?: string | null
  defaultHeaders?: http.IncomingHttpHeaders
}

export class HeaderManagementMiddleware implements Middleware {
  readonly name = 'header-management'
  readonly priority = 5

  constructor (private readonly options: HeaderManagementOptions) {}

  // ORIGINAL: Transport.ts lines 281-286 (constructor), 474-481 (_request method)
  onBeforeRequestSync = (ctx: MiddlewareContext): MiddlewareResult | undefined => {
    const headers: http.IncomingHttpHeaders = {}

    if (this.options.userAgent != null) {
      headers['user-agent'] = this.options.userAgent
    }

    if (this.options.clientMeta != null) {
      headers['x-elastic-client-meta'] = this.options.clientMeta
    }

    if (this.options.acceptEncoding != null) {
      headers['accept-encoding'] = this.options.acceptEncoding
    }

    if (this.options.defaultHeaders != null) {
      Object.assign(headers, lowerCaseHeaders(this.options.defaultHeaders))
    }

    if (ctx.options.headers != null) {
      Object.assign(headers, lowerCaseHeaders(ctx.options.headers))
    }

    if (ctx.options.opaqueId !== undefined) {
      headers['x-opaque-id'] = typeof this.options.opaqueIdPrefix === 'string'
        ? this.options.opaqueIdPrefix + ctx.options.opaqueId
        : ctx.options.opaqueId
    }

    return {
      context: {
        request: {
          headers: {
            ...ctx.request.headers,
            ...headers
          }
        }
      }
    }
  }
}
