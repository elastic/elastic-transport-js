/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Middleware, MiddlewareContext, MiddlewareResult } from './types'
import { TransportResult } from '../types'
import { ProductNotSupportedError, ErrorOptions } from '../errors'

export interface ProductCheckOptions {
  productCheck: string | null
}

export class ProductCheckMiddleware implements Middleware {
  readonly name = 'product-check'
  readonly priority = 50

  constructor (private readonly options: ProductCheckOptions) {}

  onResponse = (ctx: MiddlewareContext, result: TransportResult): MiddlewareResult | undefined => {
    if (this.options.productCheck == null) {
      return undefined
    }

    if (result.headers['x-elastic-product'] !== this.options.productCheck &&
        result.statusCode >= 200 &&
        result.statusCode < 300) {
      const errorOptions: ErrorOptions = {
        redaction: ctx.options.redaction ?? { type: 'replace', additionalKeys: [] }
      }
      return {
        error: new ProductNotSupportedError(this.options.productCheck, result, errorOptions)
      }
    }

    return undefined
  }
}
