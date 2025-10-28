/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Middleware, MiddlewareContext, MiddlewareResult } from './types'
import { Readable as ReadableStream } from 'node:stream'
import Serializer from '../Serializer'

export interface ContentTypeOptions {
  serializer: Serializer
  jsonContentType: string
  ndjsonContentType: string
  acceptHeader: string
}

function shouldSerialize (obj: any): obj is Record<string, any> | Array<Record<string, any>> {
  return typeof obj !== 'string' &&
         typeof obj.pipe !== 'function' &&
         !Buffer.isBuffer(obj)
}

export class ContentTypeMiddleware implements Middleware {
  readonly name = 'content-type'
  readonly priority = 15

  constructor (private readonly options: ContentTypeOptions) {}

  // ORIGINAL: Transport.ts lines 483-520 (JSON/NDJSON serialization), 555-562 (default headers)
  onRequest = (ctx: MiddlewareContext): MiddlewareResult | undefined => {
    const headers = { ...ctx.request.headers }
    let body = ctx.request.body

    if (ctx.params.body != null) {
      if (shouldSerialize(ctx.params.body)) {
        body = this.options.serializer.serialize(ctx.params.body)
        headers['content-type'] = headers['content-type'] ?? this.options.jsonContentType
        headers.accept = headers.accept ?? this.options.jsonContentType
      } else {
        if (ctx.params.body !== '') {
          headers['content-type'] = headers['content-type'] ?? 'text/plain'
          headers.accept = headers.accept ?? this.options.acceptHeader
        }
        body = ctx.params.body
      }
    } else if (ctx.params.bulkBody != null) {
      if (shouldSerialize(ctx.params.bulkBody)) {
        body = this.options.serializer.ndserialize(ctx.params.bulkBody as Array<Record<string, any>>)
      } else {
        body = ctx.params.bulkBody
      }

      if (body !== '') {
        headers['content-type'] = headers['content-type'] ?? this.options.ndjsonContentType
        headers.accept = headers.accept ?? this.options.jsonContentType
      }
    }

    headers.accept = headers.accept ?? this.options.acceptHeader

    if (headers['content-type'] == null && (body == null || body === '')) {
      headers['content-type'] = 'application/json'
    }

    if (body !== '' && body != null && !isStream(body)) {
      if (headers['content-length'] == null) {
        headers['content-length'] = Buffer.byteLength(body as string | Buffer).toString()
      }
    }

    return {
      context: {
        request: {
          body,
          headers
        }
      }
    }
  }
}

function isStream (obj: any): obj is ReadableStream {
  return obj != null && typeof obj.pipe === 'function'
}
