/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import zlib from 'node:zlib'
import { promisify } from 'node:util'
import { Middleware, MiddlewareContext, MiddlewareResult } from './types'

const gzip = promisify(zlib.gzip)

export interface CompressionOptions {
  enabled?: boolean
}

/**
 * POC: Compression middleware demonstrating functional approach
 * Returns new context instead of mutating original
 */
export class CompressionMiddleware implements Middleware {
  readonly name = 'compression'
  readonly priority = 20 // Execute after auth (if present)

  constructor (private readonly options: CompressionOptions = {}) {}

  /**
   * Setup compression headers
   * Return MiddlewareResult with new context, don't mutate
   */
  onBeforeRequest = async (ctx: MiddlewareContext): Promise<MiddlewareResult | undefined> => {
    if (!this.shouldCompress(ctx)) {
      return undefined // void = no changes needed
    }

    // Return NEW context with updates
    return {
      context: {
        request: {
          headers: {
            ...ctx.request.headers,
            'accept-encoding': 'gzip,deflate'
          }
        },
        shared: new Map([
          ...ctx.shared.entries(),
          ['compressionEnabled', true]
        ])
      }
    }
  }

  /**
   * Compress request body
   * Functional transformation of body and headers
   */
  onRequest = async (ctx: MiddlewareContext): Promise<MiddlewareResult | undefined> => {
    if (ctx.shared.get('compressionEnabled') !== true) {
      return undefined // void = no compression needed
    }

    const { body } = ctx.request
    if (body == null || body === '') {
      return undefined // void = no body to compress
    }

    try {
      // Only compress string and Buffer bodies (not streams)
      if (typeof body === 'string' || Buffer.isBuffer(body)) {
        // Compress body
        const compressedBody = await gzip(body)

        // Return NEW context with compressed body
        return {
          context: {
            request: {
              body: compressedBody,
              headers: {
                ...ctx.request.headers,
                'content-encoding': 'gzip',
                'content-length': Buffer.byteLength(compressedBody).toString()
              }
            }
          }
        }
      } else {
        // For streams, we can't compress here - would need stream handling
        console.debug('Skipping compression for stream body')
        return undefined // void = no changes
      }
    } catch (error) {
      console.warn('Compression failed:', error)
      return undefined // void = continue without compression
    }
  }

  onComplete = async (ctx: MiddlewareContext): Promise<void> => {
    // Cleanup phase - silent in production
  }

  /**
   * Determine if compression should be applied
   */
  private shouldCompress (ctx: MiddlewareContext): boolean {
    return this.options.enabled === true
  }
}
