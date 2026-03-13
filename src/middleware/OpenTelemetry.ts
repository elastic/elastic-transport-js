/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import opentelemetry, { Attributes, Exception, Span, SpanKind, SpanStatusCode, Tracer } from '@opentelemetry/api'
import { suppressTracing } from '@opentelemetry/core'
import { Middleware, MiddlewareContext, MiddlewareName, MiddlewarePriority } from './types'
import { TransportResult } from '../types'
import { sanitizeJsonBody, sanitizeNdjsonBody, sanitizeStringQuery } from '../security'
import Serializer from '../Serializer'
import { transportVersion } from '../version.generated'

/** Endpoints that support `db.query.text` capture. */
export const SEARCH_LIKE_ENDPOINTS: ReadonlySet<string> = new Set([
  'async_search.submit',
  'esql.async_query',
  'esql.query',
  'fleet.msearch',
  'fleet.search',
  'knn_search',
  'msearch',
  'rollup.rollup_search',
  'search',
  'search_mvt',
  'sql.query'
])

/** Endpoints whose request body is an ES|QL or SQL string query (parameterized only). */
export const STRING_QUERY_ENDPOINTS: ReadonlySet<string> = new Set([
  'esql.async_query',
  'esql.query',
  'sql.query'
])

/** Endpoints whose request body is NDJSON (header + query line pairs). */
export const NDJSON_ENDPOINTS: ReadonlySet<string> = new Set([
  'fleet.msearch',
  'msearch'
])

/** Maximum length (in characters) for the `db.query.text` span attribute. */
export const SEARCH_QUERY_MAX_LENGTH = 2048

export interface OpenTelemetryOptions {
  enabled?: boolean
  suppressInternalInstrumentation?: boolean
  /**
   * When true, sanitized request bodies are recorded as `db.query.text` on OTel spans.
   * WARNING: even after sanitization, query structure may reveal sensitive data about
   * your schema or search patterns. Enable only in environments where tracing data
   * is appropriately access-controlled.
   */
  captureSearchQuery?: boolean
}

function isStream (body: unknown): boolean {
  return body != null && typeof (body as any).pipe === 'function'
}

export class OpenTelemetryMiddleware implements Middleware {
  readonly name = MiddlewareName.OPEN_TELEMETRY
  readonly priority = MiddlewarePriority[MiddlewareName.OPEN_TELEMETRY]

  private readonly tracer: Tracer
  private readonly transportOptions: OpenTelemetryOptions
  private readonly serializer: Serializer
  /**
   * Spans indexed by request context, cleaned up in onComplete/onError.
   *
   * A WeakMap is used instead of attaching the span directly to `ctx` to keep
   * `MiddlewareContext` free of OTel-specific fields (which would force an
   * `@opentelemetry/api` import into shared types for all consumers) and to
   * preserve encapsulation — no other code can access or mutate these spans.
   * The weak reference also acts as a safety net: if a context is ever abandoned
   * without onComplete/onError firing, the entry is reclaimed automatically.
   */
  private readonly activeSpans = new WeakMap<MiddlewareContext, Span>()

  constructor (transportOptions: OpenTelemetryOptions) {
    this.tracer = opentelemetry.trace.getTracer('@elastic/transport', transportVersion)
    this.transportOptions = transportOptions
    this.serializer = new Serializer()
  }

  onBeforeRequest = (ctx: MiddlewareContext): void => {
    const otelOptions = Object.assign({}, this.transportOptions, ctx.options.openTelemetry ?? {})

    if (!(otelOptions.enabled ?? true) || ctx.params.meta?.name == null) return

    let otelContext = opentelemetry.context.active()
    if (otelOptions.suppressInternalInstrumentation ?? false) {
      otelContext = suppressTracing(otelContext)
    }

    const attributes = this.buildAttributes(ctx, otelOptions)
    const span = this.tracer.startSpan(ctx.params.meta.name, { attributes, kind: SpanKind.CLIENT }, otelContext)
    this.activeSpans.set(ctx, span)
  }

  onError = (ctx: MiddlewareContext, error: Error): void => {
    const span = this.activeSpans.get(ctx)
    if (span == null) return
    this.activeSpans.delete(ctx)

    span.recordException(error as Exception)
    span.setStatus({ code: SpanStatusCode.ERROR })
    span.setAttribute('error.type', (error as any).name ?? 'Error')
    span.end()
  }

  onComplete = (ctx: MiddlewareContext, result: TransportResult): void => {
    const span = this.activeSpans.get(ctx)
    if (span == null) return
    this.activeSpans.delete(ctx)

    this.setResponseAttributes(span, result)
    span.end()
  }

  private setResponseAttributes (span: Span, result: TransportResult): void {
    span.setAttribute('db.response.status_code', result.statusCode.toString())

    if (result.headers['x-found-handling-cluster'] != null) {
      span.setAttribute('db.namespace', result.headers['x-found-handling-cluster'] as string)
    }

    if (result.headers['x-found-handling-instance'] != null) {
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

  private buildAttributes (ctx: MiddlewareContext, otelOptions: OpenTelemetryOptions): Attributes {
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

    if ((otelOptions.captureSearchQuery ?? false) && params.meta?.name != null && SEARCH_LIKE_ENDPOINTS.has(params.meta.name)) {
      const rawBody = NDJSON_ENDPOINTS.has(params.meta.name) ? params.bulkBody : params.body
      if (rawBody != null && rawBody !== '' && !isStream(rawBody)) {
        let bodyStr: string
        if (typeof rawBody === 'string') {
          bodyStr = rawBody
        } else if (Array.isArray(rawBody)) {
          bodyStr = this.serializer.ndserialize(rawBody)
        } else {
          bodyStr = this.serializer.serialize(rawBody)
        }
        let sanitized: string | null
        if (NDJSON_ENDPOINTS.has(params.meta.name)) {
          sanitized = sanitizeNdjsonBody(bodyStr)
        } else if (STRING_QUERY_ENDPOINTS.has(params.meta.name)) {
          sanitized = sanitizeStringQuery(bodyStr)
        } else {
          sanitized = sanitizeJsonBody(bodyStr)
        }
        if (sanitized !== null) {
          attributes['db.query.text'] = sanitized.slice(0, SEARCH_QUERY_MAX_LENGTH)
        }
      }
    }

    return attributes
  }
}
