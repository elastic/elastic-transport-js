/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as http from 'node:http'
import { TransportRequestOptions } from '../Transport'
import { RequestBody } from '../types'

/**
 * POC: Minimal middleware context - immutable design
 */
export interface MiddlewareContext {
  // Request data (immutable)
  readonly request: {
    readonly method: string
    readonly path: string
    readonly body?: RequestBody
    readonly headers: Readonly<http.IncomingHttpHeaders>
  }

  // Request options (immutable)
  readonly options: Readonly<TransportRequestOptions>

  // Shared state between middleware (immutable map)
  readonly shared: ReadonlyMap<string, any>
}

/**
 * POC: Middleware result for functional transformations
 * Return new state instead of mutating existing context
 */
export interface MiddlewareResult {
  // Updated context (partial merge into existing context)
  context?: {
    request?: {
      headers?: http.IncomingHttpHeaders
      body?: RequestBody
    }
    shared?: ReadonlyMap<string, any>
  }

  // Continue to next middleware (default: true)
  continue?: boolean

  // Error to propagate (stops execution chain)
  error?: Error
}

/**
 * POC: Simplified middleware interface
 * Functional lifecycle hooks
 */
export interface Middleware {
  readonly name: string
  readonly priority?: number

  // Return MiddlewareResult | void instead of mutating
  onBeforeRequest?: (ctx: MiddlewareContext) => Promise<MiddlewareResult | undefined> | MiddlewareResult | undefined
  onRequest?: (ctx: MiddlewareContext) => Promise<MiddlewareResult | undefined> | MiddlewareResult | undefined

  // Always void return for cleanup
  onComplete?: (ctx: MiddlewareContext) => Promise<void> | void
}

export type MiddlewarePhase = 'onBeforeRequest' | 'onRequest' | 'onComplete'
