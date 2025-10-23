/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import opentelemetry, { Attributes, Exception, SpanKind, SpanStatusCode, Span, Tracer } from '@opentelemetry/api'
import { suppressTracing } from '@opentelemetry/core'
import { Middleware, MiddlewareContext, MiddlewareResult } from './types'
import { TransportResult } from '../types'

export interface OpenTelemetryOptions {
  enabled?: boolean
  suppressInternalInstrumentation?: boolean
  tracer?: Tracer
}

export class OpenTelemetryMiddleware implements Middleware {
  readonly name = 'opentelemetry'
  readonly priority = 1
  private readonly tracer: Tracer
  private readonly spans: WeakMap<MiddlewareContext, Span> = new WeakMap()

  constructor (private readonly options: OpenTelemetryOptions) {
    this.tracer = options.tracer ?? opentelemetry.trace.getTracer('@elastic/transport')
  }

  get enabled (): boolean {
    return this.options.enabled !== false
  }

  // ORIGINAL: Transport.ts lines 781-818 (span creation and attribute setting)
  onBeforeRequest = (ctx: MiddlewareContext): MiddlewareResult | undefined => {
    if (!this.enabled || ctx.params.meta?.name == null) {
      return undefined
    }

    let context = opentelemetry.context.active()
    if (this.options.suppressInternalInstrumentation === true) {
      context = suppressTracing(context)
    }

    const attributes: Attributes = {
      'db.system': 'elasticsearch',
      'http.request.method': ctx.request.method,
      'db.operation.name': ctx.params.meta.name
    }

    if (ctx.params.meta.pathParts != null) {
      for (const [key, value] of Object.entries(ctx.params.meta.pathParts)) {
        if (value == null) continue

        attributes[`db.operation.parameter.${key}`] = value.toString()

        if (['index', '_index', 'indices'].includes(key)) {
          let indices: string[] = []
          if (typeof value === 'string') {
            indices.push(value)
          } else if (Array.isArray(value)) {
            indices = indices.concat(value.map(v => v.toString()))
          } else if (typeof value === 'object') {
            try {
              const keys = Object.keys(value)
              indices = indices.concat(keys.map(v => v.toString()))
            } catch {
            }
          }
          if (indices.length > 0) attributes['db.collection.name'] = indices.join(', ')
        }
      }
    }

    const span = this.tracer.startSpan(ctx.params.meta.name, { attributes, kind: SpanKind.CLIENT }, context)
    this.spans.set(ctx, span)

    if (ctx.meta.connection != null) {
      const requestUrl = ctx.meta.connection.url
      span.setAttributes({
        'url.full': requestUrl.toString(),
        'server.address': requestUrl.hostname
      })
      if (requestUrl.port === '') {
        if (requestUrl.protocol === 'https:') {
          span.setAttribute('server.port', 443)
        } else if (requestUrl.protocol === 'http:') {
          span.setAttribute('server.port', 80)
        }
      } else {
        const port = parseInt(requestUrl.port, 10)
        if (!Number.isNaN(port)) span.setAttribute('server.port', port)
      }
    }

    return undefined
  }

  // ORIGINAL: Transport.ts lines 617-626 (response status and cluster attributes)
  onResponse = (ctx: MiddlewareContext, result: TransportResult): MiddlewareResult | undefined => {
    const span = this.spans.get(ctx)
    if (span == null) return undefined

    span.setAttribute('db.response.status_code', result.statusCode.toString())

    if (result.headers['x-found-handling-cluster'] != null) {
      span.setAttribute('db.namespace', result.headers['x-found-handling-cluster'])
    }

    if (result.headers['x-found-handling-instance'] != null) {
      span.setAttribute('elasticsearch.node.name', result.headers['x-found-handling-instance'])
    }

    return undefined
  }

  // ORIGINAL: Transport.ts lines 825-828 (error recording)
  onError = (ctx: MiddlewareContext, error: Error): MiddlewareResult | undefined => {
    const span = this.spans.get(ctx)
    if (span == null) return undefined

    span.recordException(error as Exception)
    span.setStatus({ code: SpanStatusCode.ERROR })
    span.setAttribute('error.type', error.name ?? 'Error')

    return undefined
  }

  // ORIGINAL: Transport.ts line 832 (span end)
  onComplete = (ctx: MiddlewareContext): void => {
    const span = this.spans.get(ctx)
    if (span == null) return

    span.end()
    this.spans.delete(ctx)
  }
}
