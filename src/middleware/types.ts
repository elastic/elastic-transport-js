/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as http from 'node:http'
import { TransportRequestOptions, TransportRequestParams } from '../Transport.js'
import { RequestBody, TransportResult, Context } from '../types.js'
import { Connection } from '../connection/index.js'

/**
 * Enum of all registered middleware names.
 * Each middleware should have a unique name for identification and debugging.
 */
export enum MiddlewareName {
  PRODUCT_CHECK = 'product-check'
  // Add new middleware names here
}

/**
 * Priority values for each middleware.
 * Lower values execute first. Middleware is sorted by priority before execution.
 */
export const MiddlewarePriority: Record<MiddlewareName, number> = {
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
  onResponse?: (ctx: MiddlewareContext, result: TransportResult) => MiddlewareResult | undefined
}
