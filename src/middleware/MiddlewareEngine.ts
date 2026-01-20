/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Middleware, MiddlewareContext } from './types.js'
import { TransportResult } from '../types.js'
import { ElasticsearchClientError, NativeErrorOptions } from '../errors.js'

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
