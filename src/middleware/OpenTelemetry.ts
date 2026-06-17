/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import opentelemetry, { Attributes, Exception, Span, SpanKind, SpanStatusCode, Tracer } from '@opentelemetry/api'
import { suppressTracing } from '@opentelemetry/core'
import { Middleware, MiddlewareContext, MiddlewareName, MiddlewareNext, MiddlewarePriority } from './types'
import { TransportResult } from '../types'
import { stripAuth } from '../connection/BaseConnection'
import { sanitizeJsonBody, sanitizeNdjsonBody, sanitizeStringQuery } from '../security'
import Serializer from '../Serializer'
import { transportVersion } from '../version.generated'

/** Endpoints whose body can be captured as `db.query.text`. */
export const SEARCH_LIKE_ENDPOINTS: ReadonlySet<string> = new Set([
  'async_search.submit', 'esql.async_query', 'esql.query', 'fleet.msearch', 'fleet.search',
  'knn_search', 'msearch', 'rollup.rollup_search', 'search', 'search_mvt', 'sql.query'
])

/** Endpoints whose body is an ES|QL/SQL string query (captured only when parameterized). */
export const STRING_QUERY_ENDPOINTS: ReadonlySet<string> = new Set(['esql.async_query', 'esql.query', 'sql.query'])

/** Endpoints whose body is NDJSON (header + query line pairs). */
export const NDJSON_ENDPOINTS: ReadonlySet<string> = new Set(['fleet.msearch', 'msearch'])

/** Max length of the `db.query.text` attribute, in characters. */
export const SEARCH_QUERY_MAX_LENGTH = 2048

export interface OpenTelemetryOptions {
  enabled?: boolean
  /**
   * Suppresses tracing for the request: the Elasticsearch span is non-recording
   * and, because the suppressed context is active during the HTTP call, lower-level
   * HTTP (e.g. undici) instrumentation is suppressed too.
   */
  suppressInternalInstrumentation?: boolean
  /**
   * Records sanitized request bodies as `db.query.text`. Off by default: even
   * sanitized, query structure can reveal schema or search patterns, so enable only
   * where tracing data is access-controlled.
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

  constructor (transportOptions: OpenTelemetryOptions) {
    this.tracer = opentelemetry.trace.getTracer('@elastic/transport', transportVersion)
    this.transportOptions = transportOptions
    this.serializer = new Serializer()
  }

  around = async (ctx: MiddlewareContext, next: MiddlewareNext): Promise<TransportResult> => {
    const otelOptions = Object.assign({}, this.transportOptions, ctx.options.openTelemetry ?? {})

    if (!(otelOptions.enabled ?? true) || ctx.params.meta?.name == null) {
      return await next()
    }

    let otelContext = opentelemetry.context.active()
    if (otelOptions.suppressInternalInstrumentation ?? false) {
      otelContext = suppressTracing(otelContext)
    }

    const attributes = this.buildAttributes(ctx, otelOptions)
    // startActiveSpan makes the span the active context for the duration of `next()`,
    // so spans created by the HTTP layer nest under this Elasticsearch span.
    return await this.tracer.startActiveSpan(
      ctx.params.meta.name,
      { attributes, kind: SpanKind.CLIENT },
      otelContext,
      async (span: Span): Promise<TransportResult> => {
        try {
          const result = await next()
          this.setResponseAttributes(span, result)
          return result
        } catch (error: any) {
          // ElasticsearchClientErrors carry the partial result on `.meta`.
          if (error?.meta != null) this.setResponseAttributes(span, error.meta as TransportResult)
          span.recordException(error as Exception)
          span.setStatus({ code: SpanStatusCode.ERROR })
          span.setAttribute('error.type', (error as Error).name ?? 'Error')
          throw error
        } finally {
          span.end()
        }
      }
    )
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
      const queryText = this.captureQueryText(params.meta.name, ctx)
      if (queryText != null) attributes['db.query.text'] = queryText
    }

    return attributes
  }

  private captureQueryText (name: string, ctx: MiddlewareContext): string | null {
    const { params } = ctx
    const rawBody = NDJSON_ENDPOINTS.has(name) ? params.bulkBody : params.body
    if (rawBody == null || rawBody === '' || isStream(rawBody)) return null

    let bodyStr: string
    if (typeof rawBody === 'string') {
      bodyStr = rawBody
    } else if (Array.isArray(rawBody)) {
      bodyStr = this.serializer.ndserialize(rawBody)
    } else {
      bodyStr = this.serializer.serialize(rawBody)
    }

    let sanitized: string | null
    if (NDJSON_ENDPOINTS.has(name)) {
      sanitized = sanitizeNdjsonBody(bodyStr)
    } else if (STRING_QUERY_ENDPOINTS.has(name)) {
      sanitized = sanitizeStringQuery(bodyStr)
    } else {
      sanitized = sanitizeJsonBody(bodyStr)
    }

    if (sanitized == null) return null
    // Sanitize first, then truncate, so no raw literal can survive near the cutoff.
    return sanitized.slice(0, SEARCH_QUERY_MAX_LENGTH)
  }
}
