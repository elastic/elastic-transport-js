/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as http from 'node:http'
import { TransportRequestOptions, TransportRequestParams } from '../Transport'
import { RequestBody, TransportResult, Context } from '../types'
import { Connection } from '../connection'

export interface MiddlewareContext {
  readonly request: {
    readonly method: string
    readonly path: string
    readonly body?: RequestBody
    readonly querystring?: string
    readonly headers: Readonly<http.IncomingHttpHeaders>
  }
  readonly params: Readonly<TransportRequestParams>
  readonly options: Readonly<TransportRequestOptions>
  readonly meta: {
    readonly requestId: any
    readonly name: string | symbol
    readonly context: Context
    readonly connection: Connection | null
    readonly attempts: number
  }
}

export interface MiddlewareResult {
  context?: {
    request?: {
      headers?: http.IncomingHttpHeaders
      body?: RequestBody
    }
  }
  continue?: boolean
}

export interface Middleware {
  readonly name: string
  readonly priority?: number
  readonly enabled?: boolean
  onBeforeRequest?: (ctx: MiddlewareContext) => Promise<MiddlewareResult | undefined> | MiddlewareResult | undefined
  onRequest?: (ctx: MiddlewareContext) => Promise<MiddlewareResult | undefined> | MiddlewareResult | undefined
  onResponse?: (ctx: MiddlewareContext, result: TransportResult) => Promise<MiddlewareResult | undefined> | MiddlewareResult | undefined
  onError?: (ctx: MiddlewareContext, error: Error) => Promise<MiddlewareResult | undefined> | MiddlewareResult | undefined
  onComplete?: (ctx: MiddlewareContext) => Promise<void> | void
}

export type MiddlewarePhase = 'onBeforeRequest' | 'onRequest' | 'onResponse' | 'onError' | 'onComplete'
