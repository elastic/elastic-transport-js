/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from 'node:stream'
import * as http from 'node:http'
import intoStream from 'into-stream'
import { test } from 'tap'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import {
  Transport,
  WeightedConnectionPool,
  UndiciConnection
} from '../../..'
import { connection, buildServer } from '../../utils'

const {
  MockConnection,
  MockConnectionTimeout,
  buildMockConnection
} = connection

test('OpenTelemetry', t => {
  let processor: SimpleSpanProcessor
  let provider: BasicTracerProvider
  let exporter: InMemorySpanExporter

  t.before(() => {
    exporter = new InMemorySpanExporter()
    processor = new SimpleSpanProcessor(exporter)
    provider = new BasicTracerProvider({
      spanProcessors: [processor]
    })
    provider.register()
  })

  t.afterEach(async () => {
    await provider.forceFlush()
    exporter.reset()
  })

  t.after(async () => {
    await provider.shutdown()
  })

  t.test('basic details', async t => {
    t.plan(2)

    function handler (req: http.IncomingMessage, res: http.ServerResponse) {
      res.end('ok')
    }

    const [{ port }, server] = await buildServer(handler)
    const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
    pool.addConnection(`http://localhost:${port}`)
    const transport = new Transport({ connectionPool: pool })

    await transport.request({
      path: '/hello',
      method: 'GET',
      meta: { name: 'hello' },
    })

    const spans = exporter.getFinishedSpans()

    t.same(spans[0].attributes, {
      'db.system': 'elasticsearch',
      'http.request.method': 'GET',
      'db.operation.name': 'hello',
      'url.full': `http://localhost:${port}/`,
      'server.address': 'localhost',
      'server.port': port,
      'db.response.status_code': "200"
    })
    t.equal(spans[0].status.code, 0)

    server.stop()
  })

  t.test('cloud cluster and instance details', async t => {
    t.plan(2)

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      res.setHeader('x-found-handling-cluster', 'foobar')
      res.setHeader('x-found-handling-instance', 'instance-1')
      res.end('ok')
    }

    const [{ port }, server] = await buildServer(handler)
    const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
    pool.addConnection(`http://localhost:${port}`)
    const transport = new Transport({ connectionPool: pool })

    await transport.request({
      path: '/hello2',
      method: 'GET',
      meta: { name: 'hello.2' },
    })

    const spans = exporter.getFinishedSpans()
    t.same(spans[0].attributes, {
      'db.system': 'elasticsearch',
      'http.request.method': 'GET',
      'db.operation.name': 'hello.2',
      'url.full': `http://localhost:${port}/`,
      'server.address': 'localhost',
      'server.port': port,
      'db.namespace': 'foobar',
      'elasticsearch.node.name': 'instance-1',
      'db.response.status_code': '200'
    })
    t.equal(spans[0].status.code, 0)

    server.stop()
  })

  t.test('span records error state', async t => {
    t.plan(3)

    const pool = new WeightedConnectionPool({ Connection: MockConnectionTimeout })
    pool.addConnection('http://localhost:9200')

    const transport = new Transport({
      connectionPool: pool,
    })

    try {
      await transport.request({
        path: '/hello2',
        method: 'GET',
        meta: { name: 'hello.2' },
      })
    } catch (err: any) {
      t.ok(err instanceof Error)
    }

    const spans = exporter.getFinishedSpans()

    t.equal(spans[0].attributes['error.type'], 'TimeoutError')
    t.not(spans[0].status.code, 0)
  })

  t.test('disable otel if openTelemetry.enabled === false at instantiation', async t => {
    t.plan(1)

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      res.end('ok')
    }

    const [{ port }, server] = await buildServer(handler)
    const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
    pool.addConnection(`http://localhost:${port}`)
    const transport = new Transport({
      connectionPool: pool,
      openTelemetry: { enabled: false }
    })

    await transport.request({
      path: '/hello',
      method: 'GET',
      meta: { name: 'hello' },
    })

    t.equal(exporter.getFinishedSpans().length, 0)

    server.stop()
  })

  t.test('disable otel if OTEL_ELASTICSEARCH_ENABLED === false', async t => {
    t.plan(1)

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      res.end('ok')
    }

    const [{ port }, server] = await buildServer(handler)
    const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
    pool.addConnection(`http://localhost:${port}`)

    process.env.OTEL_ELASTICSEARCH_ENABLED = 'false'
    const transport = new Transport({ connectionPool: pool })

    await transport.request({
      path: '/hello',
      method: 'GET',
      meta: { name: 'hello' },
    })

    t.equal(exporter.getFinishedSpans().length, 0)

    process.env.OTEL_ELASTICSEARCH_ENABLED = ''
    server.stop()
  })

  t.test('disable otel if openTelemetry.enabled === false at request time', async t => {
    t.plan(1)

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      res.end('ok')
    }

    const [{ port }, server] = await buildServer(handler)
    const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
    pool.addConnection(`http://localhost:${port}`)

    const transport = new Transport({
      connectionPool: pool,
      openTelemetry: { enabled: true }
    })

    await transport.request({
      path: '/hello',
      method: 'GET',
      meta: { name: 'hello' },
    }, { openTelemetry: { enabled: false } })

    t.equal(exporter.getFinishedSpans().length, 0)

    server.stop()
  })

  t.test('suppress tracing if openTelemetry.suppressInternalInstrumentation === true at instantiation', async t => {
    t.plan(1)

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      res.end('ok')
    }

    const [{ port }, server] = await buildServer(handler)
    const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
    pool.addConnection(`http://localhost:${port}`)

    const transport = new Transport({
      connectionPool: pool,
      openTelemetry: {
        enabled: true,
        suppressInternalInstrumentation: true
      }
    })

    await transport.request({
      path: '/hello',
      method: 'GET',
      meta: { name: 'hello' },
    })

    t.equal(exporter.getFinishedSpans().length, 0)

    server.stop()
  })

  t.test('suppress tracing if openTelemetry.suppressInternalInstrumentation === true at request time', async t => {
    t.plan(1)

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      res.end('ok')
    }

    const [{ port }, server] = await buildServer(handler)
    const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
    pool.addConnection(`http://localhost:${port}`)

    const transport = new Transport({
      connectionPool: pool,
      openTelemetry: {
        enabled: true,
        suppressInternalInstrumentation: false
      }
    })

    await transport.request({
      path: '/hello',
      method: 'GET',
      meta: { name: 'hello' },
    }, { openTelemetry: { suppressInternalInstrumentation: true } })

    t.equal(exporter.getFinishedSpans().length, 0)

    server.stop()
  })


  t.test('sets db.query.text for DSL search-like endpoints when captureSearchQuery: true', async t => {
    const dslEndpoints = [
      'async_search.submit',
      'fleet.search',
      'knn_search',
      'rollup.rollup_search',
      'search',
      'search_mvt'
    ]
    t.plan(dslEndpoints.length)

    for (const name of dslEndpoints) {
      const pool = new WeightedConnectionPool({ Connection: MockConnection })
      pool.addConnection('http://localhost:9200')
      const transport = new Transport({
        connectionPool: pool,
        openTelemetry: { captureSearchQuery: true }
      })
      await transport.request({
        method: 'POST',
        path: '/_search',
        body: { query: { match_all: {} } },
        meta: { name }
      })

      const spans = exporter.getFinishedSpans()
      t.equal(spans[0].attributes['db.query.text'], '{"?":{"?":{}}}', `${name} sets db.query.text`)
      exporter.reset()
    }
  })

  t.test('sets db.query.text for NDJSON endpoints via bulkBody when captureSearchQuery: true', async t => {
    const ndjsonEndpoints = ['msearch', 'fleet.msearch']
    t.plan(ndjsonEndpoints.length)

    for (const name of ndjsonEndpoints) {
      const pool = new WeightedConnectionPool({ Connection: MockConnection })
      pool.addConnection('http://localhost:9200')
      const transport = new Transport({
        connectionPool: pool,
        openTelemetry: { captureSearchQuery: true }
      })
      await transport.request({
        method: 'POST',
        path: '/_msearch',
        bulkBody: '{"index":"test"}\n{"query":{"match_all":{}}}\n',
        meta: { name }
      })

      const spans = exporter.getFinishedSpans()
      t.equal(
        spans[0].attributes['db.query.text'],
        '{"index":"test"}\n{"?":{"?":{}}}\n',
        `${name} sets db.query.text from bulkBody`
      )
      exporter.reset()
    }
  })

  t.test('sets db.query.text for string-query endpoints with parameterized queries when captureSearchQuery: true', async t => {
    const stringQueryEndpoints = ['esql.async_query', 'esql.query', 'sql.query']
    t.plan(stringQueryEndpoints.length)

    for (const name of stringQueryEndpoints) {
      const pool = new WeightedConnectionPool({ Connection: MockConnection })
      pool.addConnection('http://localhost:9200')
      const transport = new Transport({
        connectionPool: pool,
        openTelemetry: { captureSearchQuery: true }
      })
      await transport.request({
        method: 'POST',
        path: '/_query',
        body: '{"query":"SELECT * FROM employees WHERE id = ?"}',
        meta: { name }
      })

      const spans = exporter.getFinishedSpans()
      t.equal(
        spans[0].attributes['db.query.text'],
        'SELECT * FROM employees WHERE id = ?',
        `${name} sets db.query.text with parameterized query`
      )
      exporter.reset()
    }
  })

  t.test('omits db.query.text for string-query endpoints when query is not parameterized', async t => {
    t.plan(1)

    const pool = new WeightedConnectionPool({ Connection: MockConnection })
    pool.addConnection('http://localhost:9200')
    const transport = new Transport({
      connectionPool: pool,
      openTelemetry: { captureSearchQuery: true }
    })
    await transport.request({
      method: 'POST',
      path: '/_query',
      body: '{"query":"SELECT * FROM employees"}',
      meta: { name: 'esql.query' }
    })

    const spans = exporter.getFinishedSpans()
    t.equal(spans[0].attributes['db.query.text'], undefined, 'no db.query.text for non-parameterized query')
  })

  t.test('omits db.query.text for null, empty string, and stream bodies', async t => {
    t.plan(4)

    for (const [label, body] of [
      ['null body', null] as const,
      ['undefined body', undefined] as const,
      ['empty string body', ''] as const,
      ['stream body', new Readable({ read () { this.push(null) } })] as const
    ]) {
      const pool = new WeightedConnectionPool({ Connection: MockConnection })
      pool.addConnection('http://localhost:9200')
      const transport = new Transport({
        connectionPool: pool,
        openTelemetry: { captureSearchQuery: true }
      })
      await transport.request({
        method: 'POST',
        path: '/_search',
        body,
        meta: { name: 'search' }
      })

      const spans = exporter.getFinishedSpans()
      t.equal(spans[0].attributes['db.query.text'], undefined, `no db.query.text for ${label}`)
      exporter.reset()
    }
  })

  t.test('omits db.query.text for non-search endpoints when captureSearchQuery: true', async t => {
    const nonSearchEndpoints = [
      { name: 'index', path: '/test/_doc', body: { title: 'hello' } },
      { name: 'bulk', path: '/_bulk', body: [{ index: { _index: 'test' } }, { title: 'hello' }] },
      { name: 'get', path: '/test/_doc/1', body: null }
    ]
    t.plan(nonSearchEndpoints.length)

    for (const { name, path, body } of nonSearchEndpoints) {
      const pool = new WeightedConnectionPool({ Connection: MockConnection })
      pool.addConnection('http://localhost:9200')
      const transport = new Transport({
        connectionPool: pool,
        openTelemetry: { captureSearchQuery: true }
      })
      await transport.request({
        method: body == null ? 'GET' : 'POST',
        path,
        body: body as any,
        meta: { name }
      })

      const spans = exporter.getFinishedSpans()
      t.equal(spans[0].attributes['db.query.text'], undefined, `no db.query.text for ${name} endpoint`)
      exporter.reset()
    }
  })
  t.test('omits db.query.text when captureSearchQuery is not configured (default)', async t => {
    t.plan(1)

    const pool = new WeightedConnectionPool({ Connection: MockConnection })
    pool.addConnection('http://localhost:9200')
    const transport = new Transport({
      connectionPool: pool,
      openTelemetry: {}
    })
    await transport.request({
      method: 'POST',
      path: '/_search',
      body: { query: { match_all: {} } },
      meta: { name: 'search' }
    })

    const spans = exporter.getFinishedSpans()
    t.equal(spans[0].attributes['db.query.text'], undefined, 'no db.query.text without opt-in')
  })

  t.test('omits db.query.text when captureSearchQuery is explicitly false', async t => {
    t.plan(1)

    const pool = new WeightedConnectionPool({ Connection: MockConnection })
    pool.addConnection('http://localhost:9200')
    const transport = new Transport({
      connectionPool: pool,
      openTelemetry: { captureSearchQuery: false }
    })
    await transport.request({
      method: 'POST',
      path: '/_search',
      body: { query: { match_all: {} } },
      meta: { name: 'search' }
    })

    const spans = exporter.getFinishedSpans()
    t.equal(spans[0].attributes['db.query.text'], undefined, 'no db.query.text when captureSearchQuery: false')
  })

  t.test('per-request captureSearchQuery: false suppresses db.query.text when transport default is true', async t => {
    t.plan(2)

    const pool = new WeightedConnectionPool({ Connection: MockConnection })
    pool.addConnection('http://localhost:9200')
    const transport = new Transport({
      connectionPool: pool,
      openTelemetry: { captureSearchQuery: true }
    })

    // per-request override disables capture
    await transport.request({
      method: 'POST',
      path: '/_search',
      body: { query: { match_all: {} } },
      meta: { name: 'search' }
    }, { openTelemetry: { captureSearchQuery: false } })

    const spansAfterOverride = exporter.getFinishedSpans()
    t.equal(spansAfterOverride[0].attributes['db.query.text'], undefined, 'per-request false suppresses db.query.text')
    exporter.reset()

    // subsequent request without override — transport default applies
    await transport.request({
      method: 'POST',
      path: '/_search',
      body: { query: { match_all: {} } },
      meta: { name: 'search' }
    })

    const spansAfterDefault = exporter.getFinishedSpans()
    t.equal(spansAfterDefault[0].attributes['db.query.text'], '{"?":{"?":{}}}', 'subsequent request uses transport default')
  })

  t.test('per-request captureSearchQuery: true enables db.query.text when transport default is false', async t => {
    t.plan(1)

    const pool = new WeightedConnectionPool({ Connection: MockConnection })
    pool.addConnection('http://localhost:9200')
    const transport = new Transport({
      connectionPool: pool,
      openTelemetry: { captureSearchQuery: false }
    })

    await transport.request({
      method: 'POST',
      path: '/_search',
      body: { query: { match_all: {} } },
      meta: { name: 'search' }
    }, { openTelemetry: { captureSearchQuery: true } })

    const spans = exporter.getFinishedSpans()
    t.equal(spans[0].attributes['db.query.text'], '{"?":{"?":{}}}', 'per-request true enables db.query.text')
  })

  t.test('OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY=false disables capture when transport sets captureSearchQuery: true', async t => {
    t.plan(1)

    process.env.OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY = 'false'
    const pool = new WeightedConnectionPool({ Connection: MockConnection })
    pool.addConnection('http://localhost:9200')
    const transport = new Transport({
      connectionPool: pool,
      openTelemetry: { captureSearchQuery: true }
    })
    delete process.env.OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY

    await transport.request({
      method: 'POST',
      path: '/_search',
      body: { query: { match_all: {} } },
      meta: { name: 'search' }
    })

    const spans = exporter.getFinishedSpans()
    t.equal(spans[0].attributes['db.query.text'], undefined, 'env var false disables capture')
  })

  t.test('OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY=FALSE (uppercase) also disables capture', async t => {
    t.plan(1)

    process.env.OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY = 'FALSE'
    const pool = new WeightedConnectionPool({ Connection: MockConnection })
    pool.addConnection('http://localhost:9200')
    const transport = new Transport({
      connectionPool: pool,
      openTelemetry: { captureSearchQuery: true }
    })
    delete process.env.OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY

    await transport.request({
      method: 'POST',
      path: '/_search',
      body: { query: { match_all: {} } },
      meta: { name: 'search' }
    })

    const spans = exporter.getFinishedSpans()
    t.equal(spans[0].attributes['db.query.text'], undefined, 'env var FALSE (uppercase) disables capture')
  })

  t.test('db.query.text is set when env var is absent and captureSearchQuery: true', async t => {
    t.plan(1)

    delete process.env.OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY
    const pool = new WeightedConnectionPool({ Connection: MockConnection })
    pool.addConnection('http://localhost:9200')
    const transport = new Transport({
      connectionPool: pool,
      openTelemetry: { captureSearchQuery: true }
    })

    await transport.request({
      method: 'POST',
      path: '/_search',
      body: { query: { match_all: {} } },
      meta: { name: 'search' }
    })

    const spans = exporter.getFinishedSpans()
    t.equal(spans[0].attributes['db.query.text'], '{"?":{"?":{}}}', 'db.query.text is set when env var absent')
  })

  t.test('values other than false (e.g. true, 1, yes) defer to code-level captureSearchQuery', async t => {
    t.plan(3)

    for (const envVal of ['true', '1', 'yes']) {
      process.env.OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY = envVal
      const pool = new WeightedConnectionPool({ Connection: MockConnection })
      pool.addConnection('http://localhost:9200')
      const transport = new Transport({
        connectionPool: pool,
        openTelemetry: { captureSearchQuery: true }
      })
      delete process.env.OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY

      await transport.request({
        method: 'POST',
        path: '/_search',
        body: { query: { match_all: {} } },
        meta: { name: 'search' }
      })

      const spans = exporter.getFinishedSpans()
      t.equal(spans[0].attributes['db.query.text'], '{"?":{"?":{}}}', `env var '${envVal}' defers to code-level config`)
      exporter.reset()
    }
  })

  t.test('truncates sanitized query body to 2048 characters when it exceeds the limit', async t => {
    t.plan(1)

    // 1025-element numeric array sanitizes to [?,?,...,?] — 2051 chars, exceeds 2048
    const body = JSON.stringify(Array.from({ length: 1025 }, (_, i) => i))

    const pool = new WeightedConnectionPool({ Connection: MockConnection })
    pool.addConnection('http://localhost:9200')
    const transport = new Transport({
      connectionPool: pool,
      openTelemetry: { captureSearchQuery: true }
    })

    await transport.request({
      method: 'POST',
      path: '/_search',
      body,
      meta: { name: 'search' }
    })

    const spans = exporter.getFinishedSpans()
    const queryText = spans[0].attributes['db.query.text'] as string
    t.equal(queryText.length, 2048, 'db.query.text is truncated to exactly 2048 characters')
    exporter.reset()
  })

  t.test('stores sanitized query body in full when it is exactly 2048 characters', async t => {
    t.plan(2)

    // body of exactly 2048 '?' chars — no JSON tokens, sanitizeJsonBody returns it unchanged
    const body = '?'.repeat(2048)

    const pool = new WeightedConnectionPool({ Connection: MockConnection })
    pool.addConnection('http://localhost:9200')
    const transport = new Transport({
      connectionPool: pool,
      openTelemetry: { captureSearchQuery: true }
    })

    await transport.request({
      method: 'POST',
      path: '/_search',
      body,
      meta: { name: 'search' }
    })

    const spans = exporter.getFinishedSpans()
    const queryText = spans[0].attributes['db.query.text'] as string
    t.equal(queryText.length, 2048, 'db.query.text length is 2048')
    t.equal(queryText, body, 'db.query.text is stored in full without truncation')
    exporter.reset()
  })

  t.test('truncation occurs after sanitization — no raw literal value appears near the boundary', async t => {
    t.plan(3)

    // 600 string elements; sanitizes to {"?":["?","?",...]} — 2407 chars, exceeds 2048
    // raw literal values (secret_value_N) must not appear in the truncated output
    const body = JSON.stringify({ sensitive: Array.from({ length: 600 }, (_, i) => `secret_value_${i}`) })

    const pool = new WeightedConnectionPool({ Connection: MockConnection })
    pool.addConnection('http://localhost:9200')
    const transport = new Transport({
      connectionPool: pool,
      openTelemetry: { captureSearchQuery: true }
    })

    await transport.request({
      method: 'POST',
      path: '/_search',
      body,
      meta: { name: 'search' }
    })

    const spans = exporter.getFinishedSpans()
    const queryText = spans[0].attributes['db.query.text'] as string
    t.equal(queryText.length, 2048, 'db.query.text is truncated to 2048 chars')
    t.notMatch(queryText, /secret_value_/, 'no raw sensitive literal values appear in truncated output')
    t.notOk(spans[0].events?.length, 'no span events emitted on truncation')
    exporter.reset()
  })

  t.end()
})
