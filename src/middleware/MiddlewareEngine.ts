/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Middleware, MiddlewareContext, MiddlewareResult, MiddlewarePhase } from './types'
import { TransportResult } from '../types'

export class MiddlewareException extends Error {
  constructor (message: string, options?: ErrorOptions) {
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

  async executePhase (
    phase: MiddlewarePhase,
    initialContext: MiddlewareContext,
    additionalArg?: TransportResult | Error
  ): Promise<MiddlewareContext> {
    let currentContext = initialContext

    for (const middleware of this.middleware) {
      if (middleware.enabled === false) {
        continue
      }

      const handler = middleware[phase] as ((ctx: MiddlewareContext, ...args: any[]) => Promise<MiddlewareResult | undefined> | MiddlewareResult | undefined) | undefined
      if (handler == null) continue

      try {
        const handlerResult = additionalArg != null
          ? handler(currentContext, additionalArg)
          : handler(currentContext)

        const result = (handlerResult != null && typeof (handlerResult as any).then === 'function')
          ? await (handlerResult as Promise<MiddlewareResult | undefined>)
          : handlerResult as MiddlewareResult | undefined

        if (result === undefined) {
          continue
        }

        if (result.continue === false) {
          return currentContext
        }

        if (result.context != null) {
          currentContext = this.mergeContext(currentContext, result.context)
        }
      } catch (error) {
        throw new MiddlewareException(`Middleware ${middleware.name} failed in ${phase}`, { cause: error })
      }
    }

    return currentContext
  }

  private mergeContext (
    current: MiddlewareContext,
    updates: NonNullable<MiddlewareResult['context']>
  ): MiddlewareContext {
    if (updates.request == null && updates.shared == null) {
      return current
    }

    let mergedRequest = current.request
    if (updates.request != null) {
      const mergedHeaders = updates.request.headers != null
        ? { ...current.request.headers, ...updates.request.headers }
        : current.request.headers

      mergedRequest = {
        ...current.request,
        ...updates.request,
        headers: mergedHeaders
      }
    }

    return {
      ...current,
      request: mergedRequest,
      shared: updates.shared ?? current.shared
    }
  }

  getRegisteredMiddleware (): readonly Middleware[] {
    return [...this.middleware]
  }
}
