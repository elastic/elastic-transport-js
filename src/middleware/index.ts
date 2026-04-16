/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export { MiddlewareEngine, MiddlewareException } from './MiddlewareEngine'
export { ProductCheck, type ProductCheckOptions } from './ProductCheck'
export {
  OpenTelemetryMiddleware,
  type OpenTelemetryOptions,
  SEARCH_LIKE_ENDPOINTS,
  STRING_QUERY_ENDPOINTS,
  NDJSON_ENDPOINTS,
  SEARCH_QUERY_MAX_LENGTH
} from './OpenTelemetry'
export { MiddlewareName, MiddlewarePriority } from './types'
export type { Middleware, MiddlewareContext, MiddlewareResult } from './types'
