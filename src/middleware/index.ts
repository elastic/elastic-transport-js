/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export { MiddlewareEngine, MiddlewareException } from './MiddlewareEngine'
export { DefaultHeaders, type DefaultHeadersOptions } from './DefaultHeaders'
export { Compression, type CompressionOptions } from './Compression'
export { ProductCheck, type ProductCheckOptions } from './ProductCheck'
export { OpenTelemetryMiddleware, type OpenTelemetryOptions } from './OpenTelemetry'
export { MiddlewareName, MiddlewarePriority } from './types'
export type { Middleware, MiddlewareContext, MiddlewareRequestUpdate, MiddlewareResult } from './types'
