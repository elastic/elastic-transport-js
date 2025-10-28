/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Middleware, MiddlewareContext, MiddlewareResult } from './types'
import { RedactionOptions } from '../Transport'

export class ErrorRedaction implements Middleware {
  readonly name = 'error-redaction'
  readonly priority = 90

  constructor (private readonly options: RedactionOptions) {}

  // ORIGINAL: Transport.ts lines 467-469 (errorOptions configuration)
  onError = (ctx: MiddlewareContext, error: Error): MiddlewareResult | undefined => {
    if (this.options.type === 'off') {
      return undefined
    }

    const shared = new Map(ctx.shared)
    shared.set('errorRedaction', this.options)

    return {
      context: {
        shared
      }
    }
  }
}
