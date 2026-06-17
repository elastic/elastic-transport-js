/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import opentelemetry, { Context, ROOT_CONTEXT, SpanStatusCode } from '@opentelemetry/api'
import { OpenTelemetryMiddleware } from '../../../src/middleware/OpenTelemetry'
import { MiddlewareContext, MiddlewareName, MiddlewarePriority } from '../../../src/middleware/types'
import { TransportRequestParams } from '../../../src/Transport'
import { TransportResult } from '../../../src/types'

// ponytail: synchronous stack context manager so `startActiveSpan` propagates an
// active span without pulling in @opentelemetry/context-async-hooks. Ceiling: it
// does NOT survive `await` boundaries; fine here because the nesting test creates
// its child span synchronously inside the callback. Upgrade path: swap in
// AsyncLocalStorageContextManager if a test ever needs cross-await propagation.
class SyncContextManager {
  private current: Context = ROOT_CONTEXT
  active (): Context { return this.current }
  with (ctx: Context, fn: (...a: any[]) => any, thisArg?: any, ...args: any[]): any {
    const prev = this.current
    this.current = ctx
    try { return fn.call(thisArg, ...args) } finally { this.current = prev }
  }
  bind (_ctx: Context, target: any): any { return target }
  enable (): this { return this }
  disable (): this { return this }
}

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

async function runOk (mw: OpenTelemetryMiddleware, ctx: MiddlewareContext, result: TransportResult = createResult()): Promise<TransportResult> {
  return await mw.around(ctx, async () => result)
}

async function runErr (mw: OpenTelemetryMiddleware, ctx: MiddlewareContext, error: Error, result: TransportResult = createResult()): Promise<void> {
  ;(error as any).meta = result
  await mw.around(ctx, async () => { throw error }).catch(() => {})
}

test('OpenTelemetryMiddleware', async t => {
  let exporter: InMemorySpanExporter
  let provider: BasicTracerProvider

  t.before(() => {
    exporter = new InMemorySpanExporter()
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
    provider.register()
    opentelemetry.context.setGlobalContextManager(new SyncContextManager().enable() as any)
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

  await t.test('records base span attributes on success', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    await runOk(mw, createContext({ method: 'POST', meta: { name: 'search' } }), createResult({ statusCode: 200 }))

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

  await t.test('returns the result produced by next', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    const result = createResult()
    t.equal(await runOk(mw, createContext(), result), result)
  })

  await t.test('records path params and db.collection.name from index', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    await runOk(mw, createContext({ meta: { name: 'search', pathParts: { index: ['idx-1', 'idx-2'] } } }))

    const span = exporter.getFinishedSpans()[0]
    t.equal(span.attributes['db.operation.parameter.index'], 'idx-1,idx-2')
    t.equal(span.attributes['db.collection.name'], 'idx-1, idx-2')
  })

  await t.test('records cloud cluster and instance details from headers', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    await runOk(mw, createContext(), createResult({
      headers: { 'x-found-handling-cluster': 'foobar', 'x-found-handling-instance': 'instance-1' }
    }))

    const span = exporter.getFinishedSpans()[0]
    t.equal(span.attributes['db.namespace'], 'foobar')
    t.equal(span.attributes['elasticsearch.node.name'], 'instance-1')
  })

  await t.test('HTTP-layer spans created during the request nest under the ES span', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    const tracer = opentelemetry.trace.getTracer('test')

    await mw.around(createContext({ meta: { name: 'search' } }), async () => {
      tracer.startSpan('http', undefined, opentelemetry.context.active()).end()
      return createResult()
    })

    const spans = exporter.getFinishedSpans()
    const es = spans.find(s => s.name === 'search')
    const http = spans.find(s => s.name === 'http')
    t.ok(es != null && http != null, 'both spans exported')
    t.equal(http?.parentSpanId, es?.spanContext().spanId, 'http span nests under the ES span')
  })

  await t.test('records exception and error status on failure', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    await runErr(mw, createContext(), new (class extends Error { name = 'TimeoutError' })('boom'), createResult({ statusCode: 0, meta: { connection: null } as any }))

    const span = exporter.getFinishedSpans()[0]
    t.equal(span.status.code, SpanStatusCode.ERROR)
    t.equal(span.attributes['error.type'], 'TimeoutError')
    t.equal(span.events.length, 1, 'exception is recorded as a span event')
  })

  await t.test('captures response attributes for a failed response', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    await runErr(mw, createContext(), new (class extends Error { name = 'ResponseError' })('not found'), createResult({ statusCode: 404 }))

    const span = exporter.getFinishedSpans()[0]
    t.equal(span.status.code, SpanStatusCode.ERROR)
    t.equal(span.attributes['db.response.status_code'], '404', 'status code captured on error spans')
    t.equal(span.attributes['server.address'], 'localhost', 'connection info captured on error spans')
  })

  await t.test('omits status code when the request never got a response', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    await runErr(mw, createContext(), new Error('connection failed'), createResult({ statusCode: 0, meta: { connection: null } as any }))

    const span = exporter.getFinishedSpans()[0]
    t.equal(span.attributes['db.response.status_code'], undefined, 'no status code when statusCode is 0')
  })

  await t.test('does not create a span when disabled at instantiation', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: false })
    await runOk(mw, createContext())
    t.equal(exporter.getFinishedSpans().length, 0)
  })

  await t.test('request-time openTelemetry option overrides instantiation default', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    await runOk(mw, createContext({}, { openTelemetry: { enabled: false } }))
    t.equal(exporter.getFinishedSpans().length, 0)
  })

  await t.test('does not create a span when meta.name is missing', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true })
    await runOk(mw, createContext({ meta: undefined }))
    t.equal(exporter.getFinishedSpans().length, 0)
  })

  await t.test('suppresses tracing when suppressInternalInstrumentation is true', async t => {
    const mw = new OpenTelemetryMiddleware({ enabled: true, suppressInternalInstrumentation: true })
    await runOk(mw, createContext())
    t.equal(exporter.getFinishedSpans().length, 0)
  })

  async function captureQuerySpan (params: Partial<TransportRequestParams>, options: any = {}, transportOptions: any = { enabled: true, captureSearchQuery: true }): Promise<any> {
    const mw = new OpenTelemetryMiddleware(transportOptions)
    await runOk(mw, createContext(params, options))
    const spans = exporter.getFinishedSpans()
    return spans[spans.length - 1]
  }

  await t.test('captures sanitized db.query.text for a DSL search body', async t => {
    const span = await captureQuerySpan({ method: 'POST', meta: { name: 'search' }, body: { query: { match: { title: 'elasticsearch' } } } })
    t.equal(span.attributes['db.query.text'], '{"query":{"match":{"title":"?"}}}')
  })

  await t.test('captures sanitized db.query.text from an NDJSON bulkBody', async t => {
    const span = await captureQuerySpan({
      method: 'POST',
      meta: { name: 'msearch' },
      bulkBody: [{ index: 'my-index' }, { query: { match_all: {} } }]
    })
    t.equal(span.attributes['db.query.text'], '{"index":"my-index"}\n{"query":{"match_all":{}}}\n')
  })

  await t.test('captures db.query.text for parameterized string-query endpoints', async t => {
    const span = await captureQuerySpan({ method: 'POST', meta: { name: 'esql.query' }, body: { query: 'FROM logs | WHERE host == ?' } })
    t.equal(span.attributes['db.query.text'], 'FROM logs | WHERE host == ?')
  })

  await t.test('omits db.query.text for non-parameterized string queries', async t => {
    const span = await captureQuerySpan({ method: 'POST', meta: { name: 'esql.query' }, body: { query: 'FROM logs | WHERE host == "a"' } })
    t.equal(span.attributes['db.query.text'], undefined)
  })

  await t.test('omits db.query.text for empty, null and stream bodies', async t => {
    t.equal((await captureQuerySpan({ method: 'POST', meta: { name: 'search' }, body: '' })).attributes['db.query.text'], undefined, 'empty string')
    t.equal((await captureQuerySpan({ method: 'POST', meta: { name: 'search' } })).attributes['db.query.text'], undefined, 'no body')
    t.equal((await captureQuerySpan({ method: 'POST', meta: { name: 'search' }, body: { pipe () {} } as any })).attributes['db.query.text'], undefined, 'stream body')
  })

  await t.test('omits db.query.text for non-search endpoints', async t => {
    const span = await captureQuerySpan({ method: 'PUT', meta: { name: 'index' }, body: { title: 'doc' } })
    t.equal(span.attributes['db.query.text'], undefined)
  })

  await t.test('omits db.query.text when captureSearchQuery is not configured', async t => {
    const span = await captureQuerySpan({ method: 'POST', meta: { name: 'search' }, body: { query: { match_all: {} } } }, {}, { enabled: true })
    t.equal(span.attributes['db.query.text'], undefined)
  })

  await t.test('omits db.query.text when captureSearchQuery is false', async t => {
    const span = await captureQuerySpan({ method: 'POST', meta: { name: 'search' }, body: { query: { match_all: {} } } }, {}, { enabled: true, captureSearchQuery: false })
    t.equal(span.attributes['db.query.text'], undefined)
  })

  await t.test('per-request captureSearchQuery: false suppresses capture', async t => {
    const span = await captureQuerySpan(
      { method: 'POST', meta: { name: 'search' }, body: { query: { match_all: {} } } },
      { openTelemetry: { captureSearchQuery: false } }
    )
    t.equal(span.attributes['db.query.text'], undefined)
  })

  await t.test('per-request captureSearchQuery: true enables capture when transport default is false', async t => {
    const span = await captureQuerySpan(
      { method: 'POST', meta: { name: 'search' }, body: { query: { match_all: {} } } },
      { openTelemetry: { captureSearchQuery: true } },
      { enabled: true, captureSearchQuery: false }
    )
    t.equal(span.attributes['db.query.text'], '{"query":{"match_all":{}}}')
  })

  await t.test('truncates db.query.text to the maximum length', async t => {
    const body: Record<string, string> = {}
    for (let i = 0; i < 400; i++) body[`k${i}`] = `v${i}`
    const span = await captureQuerySpan({ method: 'POST', meta: { name: 'search' }, body })
    t.equal((span.attributes['db.query.text'] as string).length, 2048)
  })
})
