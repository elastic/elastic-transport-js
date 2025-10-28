/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Middleware, MiddlewareContext, MiddlewareResult } from './types'

export interface RetryOptions {
  maxRetries: number
  retryOnTimeout: boolean
  retryBackoff: (min: number, max: number, attempt: number) => number
}

export class Retry implements Middleware {
  readonly name = 'retry'
  readonly priority = 95

  constructor (private readonly options: RetryOptions) {}

  // ORIGINAL: Transport.ts lines 671-682, 699-770 (retry logic and backoff strategy)
  onBeforeRequest = (ctx: MiddlewareContext): MiddlewareResult | undefined => {
    const shared = new Map(ctx.shared)
    shared.set('retryConfig', {
      maxRetries: this.options.maxRetries,
      retryOnTimeout: this.options.retryOnTimeout,
      retryBackoff: this.options.retryBackoff
    })
    shared.set('retryAttempt', ctx.meta.attempts)

    return {
      context: {
        shared
      }
    }
  }
}
