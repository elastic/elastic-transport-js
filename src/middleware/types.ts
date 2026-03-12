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
    readonly connection: Connection | null
    readonly attempts: number
  }
}

export interface MiddlewareResult {
  continue?: boolean
}

export interface Middleware {
  readonly name: MiddlewareName
  readonly priority?: number
  /**
   * Wraps the entire request execution. Called once per `transport.request()` call.
   * Middleware with lower priority numbers wrap outer (execute first, last to return).
   * Must call `next()` to continue the chain, or skip it to short-circuit.
   */
  wrap?: (params: TransportRequestParams, options: TransportRequestOptions, next: () => Promise<any>) => Promise<any>
  onResponse?: (ctx: MiddlewareContext, result: TransportResult) => MiddlewareResult | undefined
}
