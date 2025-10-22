/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Middleware, MiddlewareContext, MiddlewareResult, MiddlewarePhase } from './types'
import { TransportResult } from '../types'

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
  ): Promise<{ context: MiddlewareContext, error?: Error }> {
    let currentContext = initialContext
    const syncPhase = (phase + 'Sync') as keyof Middleware

    for (const middleware of this.middleware) {
      if (middleware.enabled === false) {
        continue
      }

      try {
        const syncHandler = middleware[syncPhase] as ((ctx: MiddlewareContext) => MiddlewareResult | undefined) | undefined
        if (syncHandler != null) {
          const result = syncHandler(currentContext)
          if (result !== undefined) {
            if (result.error != null) {
              return { context: currentContext, error: result.error }
            }
            if (result.continue === false) {
              return { context: currentContext }
            }
            if (result.context != null) {
              currentContext = this.mergeContext(currentContext, result.context)
            }
          }
          continue
        }

        const asyncHandler = middleware[phase] as ((ctx: MiddlewareContext, ...args: any[]) => Promise<MiddlewareResult | undefined> | MiddlewareResult | undefined) | undefined
        if (asyncHandler == null) continue

        const result = additionalArg != null
          ? await asyncHandler(currentContext, additionalArg)
          : await asyncHandler(currentContext)

        if (result === undefined) {
          continue
        }

        if (result.error != null) {
          return { context: currentContext, error: result.error }
        }

        if (result.continue === false) {
          return { context: currentContext }
        }

        if (result.context != null) {
          currentContext = this.mergeContext(currentContext, result.context)
        }
      } catch (error) {
        console.warn(`Middleware ${middleware.name} failed in ${phase}:`, error)
      }
    }

    return { context: currentContext }
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
