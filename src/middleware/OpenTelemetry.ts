/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import opentelemetry, { Attributes, Exception, Span, SpanKind, SpanStatusCode, Tracer } from '@opentelemetry/api'
import { suppressTracing } from '@opentelemetry/core'
import { Middleware, MiddlewareContext, MiddlewareName, MiddlewarePriority } from './types'
import { TransportResult } from '../types'
import { transportVersion } from '../version.generated'

/** Key under which the in-flight span is stored in `MiddlewareContext.state`. */
const SPAN_STATE_KEY = Symbol('opentelemetry.span')

export interface OpenTelemetryOptions {
  enabled?: boolean
  /**
   * Marks this request's tracing context as suppressed so the Elasticsearch
   * operation span is not recorded.
   *
   * BEHAVIOR CHANGE vs the pre-middleware implementation: the old inline code
   * wrapped the whole request in `startActiveSpan`, so the suppressed context
   * was *active* during the underlying HTTP call and therefore also suppressed
   * the HTTP-layer (e.g. undici) instrumentation. With the lifecycle-hook
   * design the span starts and ends in separate hooks and is never made the
   * active context, so this option now only prevents the Elasticsearch span
   * itself; it no longer suppresses lower-level HTTP instrumentation. See
   * elastic/elasticsearch-js#3107.
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

    // The suppressed context is only used as the span's parent (making the span
    // non-recording); it is not activated for the HTTP call. See the note on
    // OpenTelemetryOptions.suppressInternalInstrumentation for the implications.
    let otelContext = opentelemetry.context.active()
    if (otelOptions.suppressInternalInstrumentation ?? false) {
      otelContext = suppressTracing(otelContext)
    }

    const attributes = this.buildAttributes(ctx)
    const span = this.tracer.startSpan(ctx.params.meta.name, { attributes, kind: SpanKind.CLIENT }, otelContext)
    // The span is stashed in the per-request state map (keyed by a private
    // symbol) so it survives from this hook through to onComplete/onError.
    ctx.state.set(SPAN_STATE_KEY, span)
  }

  onError = (ctx: MiddlewareContext, error: Error, result: TransportResult): void => {
    const span = ctx.state.get(SPAN_STATE_KEY) as Span | undefined
    if (span == null) return
    ctx.state.delete(SPAN_STATE_KEY)

    // Capture whatever response metadata exists even on failure (e.g. status
    // code and node info for a ResponseError).
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
    // statusCode is 0 when the request failed before receiving a response
    // (e.g. connection errors), in which case there is no HTTP status to report.
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
        'url.full': url.toString(),
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
