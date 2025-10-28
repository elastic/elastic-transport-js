/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import zlib from 'node:zlib'
import { promisify } from 'node:util'
import { Readable as ReadableStream } from 'node:stream'
import { Middleware, MiddlewareContext, MiddlewareResult } from './types'

const gzip = promisify(zlib.gzip)
const { createGzip } = zlib

export interface CompressionOptions {
  enabled?: boolean
}

function isStream (obj: any): obj is ReadableStream {
  return obj != null && typeof obj.pipe === 'function'
}

export class Compression implements Middleware {
  readonly name = 'compression'
  readonly priority = 20

  constructor (private readonly options: CompressionOptions = {}) {}

  get enabled (): boolean {
    return this.options.enabled === true
  }

  // ORIGINAL: Transport.ts line 285 (accept-encoding header in constructor)
  onBeforeRequest = (ctx: MiddlewareContext): MiddlewareResult | undefined => {
    if (!this.enabled) {
      return undefined
    }

    return {
      context: {
        request: {
          headers: {
            'accept-encoding': 'gzip,deflate'
          }
        }
      }
    }
  }

  // ORIGINAL: Transport.ts lines 531-553 (gzip compression for streams and buffers)
  onRequest = async (ctx: MiddlewareContext): Promise<MiddlewareResult | undefined> => {
    if (!this.enabled) {
      return undefined
    }

    const { body } = ctx.request
    if (body == null || body === '') {
      return undefined
    }

    try {
      if (isStream(body)) {
        return {
          context: {
            request: {
              body: body.pipe(createGzip()),
              headers: {
                'content-encoding': 'gzip'
              }
            }
          }
        }
      } else {
        const compressedBody = await gzip(body as string | Buffer)
        return {
          context: {
            request: {
              body: compressedBody,
              headers: {
                'content-encoding': 'gzip',
                'content-length': Buffer.byteLength(compressedBody).toString()
              }
            }
          }
        }
      }
    } catch (error) {
      return undefined
    }
  }
}
