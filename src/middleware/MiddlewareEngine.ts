/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Middleware, MiddlewareContext, MiddlewareResult, MiddlewarePhase } from './types'

/**
 * POC: Minimal middleware execution engine
 * Sequential execution with immutable context transformations
 */
export class MiddlewareEngine {
  private readonly middleware: Middleware[] = []

  /**
   * Register middleware with automatic priority sorting
   */
  register (middleware: Middleware): void {
    this.middleware.push(middleware)
    // Sort by priority (lower numbers execute first)
    this.middleware.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
  }

  /**
   * Execute middleware phase functionally
   * Each middleware gets result of previous middleware
   */
  async executePhase (
    phase: MiddlewarePhase,
    initialContext: MiddlewareContext
  ): Promise<{ context: MiddlewareContext, error?: Error }> {
    let currentContext = initialContext
    const syncPhase = (phase + 'Sync') as keyof Middleware

    for (const middleware of this.middleware) {
      try {
        // Try sync version first (faster, no await overhead)
        const syncHandler = middleware[syncPhase] as ((ctx: MiddlewareContext) => MiddlewareResult | undefined) | undefined
        if (syncHandler != null) {
          const result = syncHandler(currentContext)

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
          continue
        }

        // Fall back to async version if no sync handler
        const asyncHandler = middleware[phase]
        if (asyncHandler == null) continue

        const result = await asyncHandler(currentContext)

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

  /**
   * Get registered middleware for debugging
   */
  getRegisteredMiddleware (): readonly Middleware[] {
    return [...this.middleware]
  }
}
