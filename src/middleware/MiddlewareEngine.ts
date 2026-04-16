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

  async executeBeforeRequest (ctx: MiddlewareContext): Promise<void> {
    for (const mw of this.middleware) {
      if (mw.onBeforeRequest == null) continue
      try {
        await mw.onBeforeRequest(ctx)
      } catch (error) {
        if (error instanceof ElasticsearchClientError) throw error
        throw new MiddlewareException(`Middleware ${mw.name} failed in onBeforeRequest`, { cause: error })
      }
    }
  }

  /**
   * Executes all `onResponse` handlers synchronously in priority order.
   * Called on each HTTP response within the retry loop.
   */
  executeOnResponse (ctx: MiddlewareContext, result: TransportResult): void {
    for (const mw of this.middleware) {
      if (mw.onResponse == null) continue
      try {
        const handlerResult = mw.onResponse(ctx, result)
        if (handlerResult?.continue === false) return
      } catch (error) {
        if (error instanceof ElasticsearchClientError) throw error
        throw new MiddlewareException(`Middleware ${mw.name} failed in onResponse`, { cause: error })
      }
    }
  }

  async executeOnError (ctx: MiddlewareContext, error: Error): Promise<void> {
    for (const mw of this.middleware) {
      if (mw.onError == null) continue
      try {
        await mw.onError(ctx, error)
      } catch (err) {
        if (err instanceof ElasticsearchClientError) throw err
        throw new MiddlewareException(`Middleware ${mw.name} failed in onError`, { cause: err })
      }
    }
  }

  async executeOnComplete (ctx: MiddlewareContext, result: TransportResult): Promise<void> {
    for (const mw of this.middleware) {
      if (mw.onComplete == null) continue
      try {
        await mw.onComplete(ctx, result)
      } catch (error) {
        if (error instanceof ElasticsearchClientError) throw error
        throw new MiddlewareException(`Middleware ${mw.name} failed in onComplete`, { cause: error })
      }
    }
  }
}
