/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Middleware, MiddlewareContext } from './types'
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
   * Executes all `onBeforeRequest` handlers in priority order, once per
   * `transport.request()` call, before the first connection attempt.
   */
  async executeBeforeRequest (context: MiddlewareContext): Promise<void> {
    for (const middleware of this.middleware) {
      if (middleware.onBeforeRequest == null) continue

      try {
        await middleware.onBeforeRequest(context)
      } catch (error) {
        if (error instanceof ElasticsearchClientError) {
          throw error
        }
        throw new MiddlewareException(`Middleware ${middleware.name} failed in onBeforeRequest`, { cause: error })
      }
    }
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

  /**
   * Executes all `onError` handlers in priority order, once per
   * `transport.request()` call, when the request fails with an unrecoverable
   * error. The original error is re-thrown by the caller after all handlers run.
   */
  async executeOnError (context: MiddlewareContext, error: Error, result: TransportResult): Promise<void> {
    for (const middleware of this.middleware) {
      if (middleware.onError == null) continue

      try {
        await middleware.onError(context, error, result)
      } catch (err) {
        if (err instanceof ElasticsearchClientError) {
          throw err
        }
        throw new MiddlewareException(`Middleware ${middleware.name} failed in onError`, { cause: err })
      }
    }
  }

  /**
   * Executes all `onComplete` handlers in priority order, once per
   * `transport.request()` call, on a successful final response.
   */
  async executeOnComplete (context: MiddlewareContext, result: TransportResult): Promise<void> {
    for (const middleware of this.middleware) {
      if (middleware.onComplete == null) continue

      try {
        await middleware.onComplete(context, result)
      } catch (error) {
        if (error instanceof ElasticsearchClientError) {
          throw error
        }
        throw new MiddlewareException(`Middleware ${middleware.name} failed in onComplete`, { cause: error })
      }
    }
  }
}
