/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import opentelemetry, { Attributes, Exception, Span, SpanKind, SpanStatusCode, Tracer } from '@opentelemetry/api'
import { suppressTracing } from '@opentelemetry/core'
import { Middleware, MiddlewareContext, MiddlewareName, MiddlewarePriority } from './types'
import { TransportResult } from '../types'
import { stripAuth } from '../connection/BaseConnection'
import { transportVersion } from '../version.generated'

const SPAN_STATE_KEY = Symbol('opentelemetry.span')

export interface OpenTelemetryOptions {
  enabled?: boolean
  /**
   * Suppresses the Elasticsearch operation span for the request. Note: unlike
   * the pre-middleware implementation (which wrapped the request in an active
   * span), this no longer suppresses lower-level HTTP (e.g. undici)
   * instrumentation, since the span is never the active context during the HTTP
   * call. See elastic/elasticsearch-js#3107.
   */
  suppressInternalInstrumentation?: boolean
}

export class OpenTelemetryMiddleware implements Middleware {
  readonly name = MiddlewareName.OPEN_TELEMETRY
  readonly priority = MiddlewarePriority[MiddlewareName.OPEN_TELEMETRY]

  private readonly tracer: Tracer
  private readonly transportOptions: OpenTelemetryOptions

  constructor (transportOptions: OpenTelemetryOptions) {
    this.tracer = opentelemetry.trace.getTracer('@elastic/transport', transportVersion)
    this.transportOptions = transportOptions
  }

  onBeforeRequest = (ctx: MiddlewareContext): void => {
    const otelOptions = Object.assign({}, this.transportOptions, ctx.options.openTelemetry ?? {})

    if (!(otelOptions.enabled ?? true) || ctx.params.meta?.name == null) return

    let otelContext = opentelemetry.context.active()
    if (otelOptions.suppressInternalInstrumentation ?? false) {
      otelContext = suppressTracing(otelContext)
    }

    const attributes = this.buildAttributes(ctx)
    const span = this.tracer.startSpan(ctx.params.meta.name, { attributes, kind: SpanKind.CLIENT }, otelContext)
    ctx.state.set(SPAN_STATE_KEY, span)
  }

  onError = (ctx: MiddlewareContext, error: Error, result: TransportResult): void => {
    const span = ctx.state.get(SPAN_STATE_KEY) as Span | undefined
    if (span == null) return
    ctx.state.delete(SPAN_STATE_KEY)

    this.setResponseAttributes(span, result)
    span.recordException(error as Exception)
    span.setStatus({ code: SpanStatusCode.ERROR })
    span.setAttribute('error.type', error.name ?? 'Error')
    span.end()
  }

  onComplete = (ctx: MiddlewareContext, result: TransportResult): void => {
    const span = ctx.state.get(SPAN_STATE_KEY) as Span | undefined
    if (span == null) return
    ctx.state.delete(SPAN_STATE_KEY)

    this.setResponseAttributes(span, result)
    span.end()
  }

  private setResponseAttributes (span: Span, result: TransportResult): void {
    // statusCode is 0 when the request failed before receiving a response.
    if (result.statusCode > 0) {
      span.setAttribute('db.response.status_code', result.statusCode.toString())
    }

    if (result.headers?.['x-found-handling-cluster'] != null) {
      span.setAttribute('db.namespace', result.headers['x-found-handling-cluster'] as string)
    }

    if (result.headers?.['x-found-handling-instance'] != null) {
      span.setAttribute('elasticsearch.node.name', result.headers['x-found-handling-instance'] as string)
    }

    if (result.meta.connection != null) {
      const url = result.meta.connection.url
      span.setAttributes({
        'url.full': stripAuth(url.toString()),
        'server.address': url.hostname
      })
      if (url.port === '') {
        span.setAttribute('server.port', url.protocol === 'https:' ? 443 : 80)
      } else {
        const port = parseInt(url.port, 10)
        if (!Number.isNaN(port)) span.setAttribute('server.port', port)
      }
    }
  }

  private buildAttributes (ctx: MiddlewareContext): Attributes {
    const { params } = ctx
    const attributes: Attributes = {
      'db.system': 'elasticsearch',
      'http.request.method': params.method,
      'db.operation.name': params.meta?.name
    }

    if (params.meta?.pathParts != null) {
      for (const [key, value] of Object.entries(params.meta.pathParts)) {
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
              indices = indices.concat(Object.keys(value).map(v => v.toString()))
            } catch {
              // ignore
            }
          }
          if (indices.length > 0) attributes['db.collection.name'] = indices.join(', ')
        }
      }
    }

    return attributes
  }
}
