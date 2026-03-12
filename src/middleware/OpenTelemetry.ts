/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import opentelemetry, { Attributes, Exception, Span, SpanKind, SpanStatusCode, Tracer } from '@opentelemetry/api'
import { suppressTracing } from '@opentelemetry/core'
import { Middleware, MiddlewareName, MiddlewarePriority } from './types'
import { TransportRequestParams, TransportRequestOptions } from '../Transport'
import { TransportResult } from '../types'
import { sanitizeJsonBody, sanitizeNdjsonBody, sanitizeStringQuery } from '../security'

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

  constructor (tracer: Tracer, transportOptions: OpenTelemetryOptions) {
    this.tracer = tracer
    this.transportOptions = transportOptions
  }

  wrap = async (params: TransportRequestParams, options: TransportRequestOptions, next: () => Promise<any>): Promise<any> => {
    const otelOptions: OpenTelemetryOptions = Object.assign({}, this.transportOptions, options.openTelemetry ?? {})

    if (!(otelOptions.enabled ?? true) || params.meta?.name == null) {
      return await next()
    }

    let context = opentelemetry.context.active()
    if (otelOptions.suppressInternalInstrumentation ?? false) {
      context = suppressTracing(context)
    }

    const attributes = this.buildAttributes(params, otelOptions)

    return await this.tracer.startActiveSpan(params.meta.name, { attributes, kind: SpanKind.CLIENT }, context, async (span) => {
      try {
        const result = await next()
        this.setResponseAttributes(span, result)
        return result
      } catch (err: any) {
        span.recordException(err as Exception)
        span.setStatus({ code: SpanStatusCode.ERROR })
        span.setAttribute('error.type', err.name ?? 'Error')
        throw err
      } finally {
        span.end()
      }
    })
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

  private buildAttributes (params: TransportRequestParams, otelOptions: OpenTelemetryOptions): Attributes {
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
        const bodyStr = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)
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
