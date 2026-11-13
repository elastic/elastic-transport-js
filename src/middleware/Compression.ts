/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { promisify } from 'node:util'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'
import { Middleware, MiddlewareContext, MiddlewareName, MiddlewarePriority, MiddlewareRequestUpdate } from './types'

const gzip = promisify(zlib.gzip)

export interface CompressionOptions {
  compression: boolean
}

export class Compression implements Middleware {
  readonly name = MiddlewareName.COMPRESSION
  readonly priority = MiddlewarePriority[MiddlewareName.COMPRESSION]

  constructor (private readonly options: CompressionOptions) {}

  onBeforeRequest = async (ctx: MiddlewareContext): Promise<MiddlewareRequestUpdate | undefined> => {
    const { body, headers } = ctx.request
    if (!(ctx.options.compression ?? this.options.compression) || body == null || body === '') return

    return {
      // Duck-typed like Transport's isStream; importing it from Transport would be circular.
      body: typeof (body as Readable).pipe === 'function'
        ? (body as Readable).pipe(zlib.createGzip())
        : await gzip(body as string | Buffer),
      headers: { ...headers, 'content-encoding': 'gzip' }
    }
  }
}
