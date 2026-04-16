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
  PRODUCT_CHECK = 'product-check',
  OPEN_TELEMETRY = 'opentelemetry'
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
}

export interface MiddlewareResult {
  continue?: boolean
}

export interface Middleware {
  readonly name: MiddlewareName
  readonly priority?: number
  /**
   * Called once per `transport.request()` call, after serialization and before
   * the first connection attempt. Use this to set up per-request state.
   */
  onBeforeRequest?: (ctx: MiddlewareContext) => void | Promise<void>
  /**
   * Called on each successful HTTP response within the retry loop.
   * Returning `{ continue: false }` stops subsequent middleware from running.
   */
  onResponse?: (ctx: MiddlewareContext, result: TransportResult) => MiddlewareResult | undefined
  /**
   * Called once per `transport.request()` call when the request fails with an
   * unrecoverable error (after all retries are exhausted). The error is
   * re-thrown after all handlers run.
   */
  onError?: (ctx: MiddlewareContext, error: Error) => void | Promise<void>
  /**
   * Called once per `transport.request()` call on a successful final response.
   */
  onComplete?: (ctx: MiddlewareContext, result: TransportResult) => void | Promise<void>
}
