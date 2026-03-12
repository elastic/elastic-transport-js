/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Middleware, MiddlewareContext } from './types'
import { TransportRequestOptions, TransportRequestParams } from '../Transport'
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
   * Composes all `wrap` handlers around `innermost` and executes the chain.
   * Middleware with lower priority numbers are outermost (wrap first, return last).
   */
  async executeWrap (
    params: TransportRequestParams,
    options: TransportRequestOptions,
    innermost: () => Promise<any>
  ): Promise<any> {
    const wrappers = this.middleware.filter(m => m.wrap != null)

    // Build chain from innermost outward: iterate sorted array in reverse so
    // lowest-priority middleware wraps outermost.
    let chain = innermost
    for (let i = wrappers.length - 1; i >= 0; i--) {
      const mw = wrappers[i]
      const next = chain
      chain = async () => {
        try {
          if (mw.wrap == null) return await next()
          return await mw.wrap(params, options, next)
        } catch (error) {
          if (error instanceof ElasticsearchClientError) throw error
          throw new MiddlewareException(`Middleware ${mw.name} failed in wrap`, { cause: error })
        }
      }
    }

    return await chain()
  }

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
