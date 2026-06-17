/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as http from 'node:http'
import { TransportRequestOptions, TransportRequestParams } from '../Transport'
import { RequestBody, TransportResult, Context } from '../types'
import { Connection } from '../connection'

/**
 * Enum of all registered middleware names.
 * Each middleware should have a unique name for identification and debugging.
 */
export enum MiddlewareName {
  OPEN_TELEMETRY = 'opentelemetry',
  PRODUCT_CHECK = 'product-check'
  // Add new middleware names here
}

/**
 * Priority values for each middleware.
 * Lower values execute first. Middleware is sorted by priority before execution.
 */
export const MiddlewarePriority: Record<MiddlewareName, number> = {
  [MiddlewareName.OPEN_TELEMETRY]: 10,
  [MiddlewareName.PRODUCT_CHECK]: 50
  // Add new middleware priorities here
} as const

export interface MiddlewareContext {
  readonly request: {
    readonly method: string
    readonly path: string
    readonly body?: RequestBody | null
    readonly querystring?: string
    readonly headers: Readonly<http.IncomingHttpHeaders>
  }
  readonly params: Readonly<TransportRequestParams>
  readonly options: Readonly<TransportRequestOptions>
  readonly meta: {
    readonly requestId: any
    readonly name: string | symbol
    readonly context: Context | null
    /** Updated to the active connection before each `onResponse` call. */
    connection: Connection | null
    /** Updated to the current retry count before each `onResponse` call. */
    attempts: number
  }
  /**
   * Per-request scratch space shared across phases. Middleware can stash state
   * here keyed by a private symbol when it must survive from one phase to the next.
   */
  readonly state: Map<symbol, unknown>
}

export interface MiddlewareResult {
  continue?: boolean
}

/** Runs the rest of the middleware chain plus the actual request, resolving to the final result. */
export type MiddlewareNext = () => Promise<TransportResult>

export interface Middleware {
  readonly name: MiddlewareName
  readonly priority?: number
  /**
   * Wraps the whole request (all retries). Call `next()` to run the inner layers
   * and the HTTP request, then return its result. Because the work runs inside the
   * handler, this is the only hook that can keep an async context (e.g. an active
   * OpenTelemetry span) active across the request so HTTP-layer spans nest under it.
   */
  around?: (ctx: MiddlewareContext, next: MiddlewareNext) => Promise<TransportResult>
  /**
   * Called on each successful HTTP response within the retry loop.
   * Returning `{ continue: false }` stops subsequent middleware from running.
   */
  onResponse?: (ctx: MiddlewareContext, result: TransportResult) => MiddlewareResult | undefined
}
