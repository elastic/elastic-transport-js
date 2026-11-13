/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { promisify } from 'node:util'
import zlib from 'node:zlib'
import { Middleware, MiddlewareContext, MiddlewareName, MiddlewarePriority, MiddlewareRequestUpdate } from './types'
import { isStream } from '../utils'

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
      body: isStream(body)
        ? body.pipe(zlib.createGzip())
        : await gzip(body as string | Buffer),
      headers: { ...headers, 'content-encoding': 'gzip' }
    }
  }
}
