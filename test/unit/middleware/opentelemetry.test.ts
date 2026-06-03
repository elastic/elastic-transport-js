/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { SpanStatusCode } from '@opentelemetry/api'
import { OpenTelemetryMiddleware } from '../../../src/middleware/OpenTelemetry'
import { MiddlewareContext, MiddlewareName, MiddlewarePriority } from '../../../src/middleware/types'
import { TransportRequestParams } from '../../../src/Transport'
import { TransportResult } from '../../../src/types'

function createContext (params: Partial<TransportRequestParams> = {}, options: any = {}): MiddlewareContext {
  return {
    request: {
      method: params.method ?? 'GET',
      path: params.path ?? '/test',
      headers: {}
    },
    params: {
      method: 'GET',
      path: '/test',
      meta: { name: 'search' },
      ...params
    },
    options,
    meta: {
      requestId: 1,
      name: 'search',
      context: null,
      connection: null,
      attempts: 0
    }
  }
}

function createResult (overrides: Partial<TransportResult> = {}): TransportResult {
  return {
    body: {},
    statusCode: 200,
    headers: {},
    meta: {
      context: null,
      request: { params: { method: 'GET', path: '/test' }, options: {}, id: 1 },
      name: 'search',
      connection: { url: new URL('http://localhost:9200/') } as any,
      attempts: 0,
      aborted: false
    },
    warnings: null,
    ...overrides
  }
}

test('OpenTelemetryMiddleware', async t => {
  let exporter: InMemorySpanExporter
  let provider: BasicTracerProvider

  t.before(() => {
    exporter = new InMemorySpanExporter()
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
    provider.register()
  })

  t.afterEach(async () => {
    await provider.forceFlush()
    exporter.reset()
  })

  t.after(async () => {
    await provider.shutdown()
  })

  await t.test('has the expected name and priority', async t => {
    const mw = new OpenTelemetryMiddleware({})
    t.equal(mw.name, MiddlewareName.OPEN_TELEMETRY)
    t.equal(mw.priority, MiddlewarePriority[MiddlewareName.OPEN_TELEMETRY])
  })

  await t.test('onComplete records base span attributes', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    const ctx = createContext({ method: 'POST', meta: { name: 'search' } })

    mw.onBeforeRequest(ctx)
    mw.onComplete(ctx, createResult({ statusCode: 200 }))

    const spans = exporter.getFinishedSpans()
    t.equal(spans.length, 1)
    const span = spans[0]
    t.equal(span.name, 'search')
    t.equal(span.attributes['db.system'], 'elasticsearch')
    t.equal(span.attributes['http.request.method'], 'POST')
    t.equal(span.attributes['db.operation.name'], 'search')
    t.equal(span.attributes['db.response.status_code'], '200')
    t.equal(span.attributes['url.full'], 'http://localhost:9200/')
    t.equal(span.attributes['server.address'], 'localhost')
    t.equal(span.attributes['server.port'], 9200)
    t.equal(span.status.code, SpanStatusCode.UNSET)
  })

  await t.test('records path params and db.collection.name from index', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    const ctx = createContext({
      meta: { name: 'search', pathParts: { index: ['idx-1', 'idx-2'] } }
    })

    mw.onBeforeRequest(ctx)
    mw.onComplete(ctx, createResult())

    const span = exporter.getFinishedSpans()[0]
    t.equal(span.attributes['db.operation.parameter.index'], 'idx-1,idx-2')
    t.equal(span.attributes['db.collection.name'], 'idx-1, idx-2')
  })

  await t.test('records cloud cluster and instance details from headers', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    const ctx = createContext()

    mw.onBeforeRequest(ctx)
    mw.onComplete(ctx, createResult({
      headers: { 'x-found-handling-cluster': 'foobar', 'x-found-handling-instance': 'instance-1' }
    }))

    const span = exporter.getFinishedSpans()[0]
    t.equal(span.attributes['db.namespace'], 'foobar')
    t.equal(span.attributes['elasticsearch.node.name'], 'instance-1')
  })

  await t.test('onError records exception and error status', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    const ctx = createContext()

    mw.onBeforeRequest(ctx)
    mw.onError(ctx, new (class extends Error { name = 'TimeoutError' })('boom'))

    const span: ReadableSpan = exporter.getFinishedSpans()[0]
    t.equal(span.status.code, SpanStatusCode.ERROR)
    t.equal(span.attributes['error.type'], 'TimeoutError')
    t.equal(span.events.length, 1, 'exception is recorded as a span event')
  })

  await t.test('does not create a span when disabled at instantiation', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: false })
    const ctx = createContext()

    mw.onBeforeRequest(ctx)
    mw.onComplete(ctx, createResult())

    t.equal(exporter.getFinishedSpans().length, 0)
  })

  await t.test('request-time openTelemetry option overrides instantiation default', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    const ctx = createContext({}, { openTelemetry: { enabled: false } })

    mw.onBeforeRequest(ctx)
    mw.onComplete(ctx, createResult())

    t.equal(exporter.getFinishedSpans().length, 0)
  })

  await t.test('does not create a span when meta.name is missing', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    const ctx = createContext({ meta: undefined })

    mw.onBeforeRequest(ctx)
    mw.onComplete(ctx, createResult())

    t.equal(exporter.getFinishedSpans().length, 0)
  })

  await t.test('suppresses tracing when suppressInternalInstrumentation is true', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true, suppressInternalInstrumentation: true })
    const ctx = createContext()

    mw.onBeforeRequest(ctx)
    mw.onComplete(ctx, createResult())

    t.equal(exporter.getFinishedSpans().length, 0)
  })

  await t.test('onComplete/onError are no-ops without a started span', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    const ctx = createContext()

    // No onBeforeRequest call, so no span was started
    t.doesNotThrow(() => mw.onComplete(ctx, createResult()))
    t.doesNotThrow(() => mw.onError(ctx, new Error('boom')))
    t.equal(exporter.getFinishedSpans().length, 0)
  })
})
