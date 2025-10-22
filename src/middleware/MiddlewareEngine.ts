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

    for (const middleware of this.middleware) {
      const handler = middleware[phase]
      if (handler == null) continue

      try {
        // Execute middleware handler
        const result = await handler(currentContext)

        if (result === undefined) {
          // void return = no changes, continue to next middleware
          continue
        }

        if (result.error != null) {
          return { context: currentContext, error: result.error }
        }

        if (result.continue === false) {
          // Middleware requested to stop execution
          return { context: currentContext }
        }

        if (result.context != null) {
          // Merge returned context changes immutably
          currentContext = this.mergeContext(currentContext, result.context)
        }
      } catch (error) {
        // Log middleware error but continue execution with other middleware (fault tolerance)
        console.warn(`Middleware ${middleware.name} failed in ${phase}:`, error)
      }
    }

    return { context: currentContext }
  }

  /**
   * Immutable context merging
   * Creates new context object without mutating the original
   */
  private mergeContext (
    current: MiddlewareContext,
    updates: NonNullable<MiddlewareResult['context']>
  ): MiddlewareContext {
    return {
      ...current,

      // Merge request object if provided
      request: updates.request != null
        ? {
            ...current.request,
            ...updates.request,
            headers: updates.request.headers != null
              ? {
                  ...current.request.headers,
                  ...updates.request.headers
                }
              : current.request.headers
          }
        : current.request,

      // Replace shared map if provided (maps are immutable)
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
