/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Middleware, MiddlewareContext, MiddlewareNext } from './types'
import { TransportResult } from '../types'
import { ElasticsearchClientError, NativeErrorOptions } from '../errors'

export class MiddlewareException extends Error {
  constructor (message: string, options?: NativeErrorOptions) {
    super(message, options)
    this.name = 'MiddlewareException'
  }
}

export class MiddlewareEngine {
  private readonly middleware: Middleware[] = []

  register (middleware: Middleware): void {
    this.middleware.push(middleware)
    this.middleware.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
  }

  /**
   * Wraps `run` (the request, including all retries) in the `around` handlers as
   * an onion: highest priority (lowest number) is outermost. Errors propagate as-is.
   */
  async run (context: MiddlewareContext, run: MiddlewareNext): Promise<TransportResult> {
    let next: MiddlewareNext = run
    for (let i = this.middleware.length - 1; i >= 0; i--) {
      const around = this.middleware[i].around
      if (around == null) continue
      const inner = next
      next = async () => await around(context, inner)
    }
    return await next()
  }

  /**
   * Executes all `onResponse` handlers synchronously in priority order.
   * Called on each HTTP response within the retry loop. A handler may return
   * `{ continue: false }` to stop subsequent handlers from running.
   */
  executePhase (
    phase: 'onResponse',
    context: MiddlewareContext,
    result: TransportResult
  ): void {
    for (const middleware of this.middleware) {
      const handler = middleware[phase]
      if (handler == null) continue

      try {
        const handlerResult = handler(context, result)

        if (handlerResult?.continue === false) {
          return
        }
      } catch (error) {
        if (error instanceof ElasticsearchClientError) {
          throw error
        }
        throw new MiddlewareException(`Middleware ${middleware.name} failed in ${phase}`, { cause: error })
      }
    }
  }
}
