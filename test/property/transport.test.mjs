/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import assert from 'node:assert/strict'
import { gzipSync, gunzipSync } from 'node:zlib'
import * as hegel from '@hegeldev/hegel'
import * as gs from '@hegeldev/hegel/generators'
import { Transport, BaseConnection, ClusterConnectionPool, WeightedConnectionPool, errors } from '../../index.js'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { json, jsonObject } from './gen.mjs'

// One scripted outcome per connection attempt: either an HTTP response or a thrown error
const outcome = gs.oneOf(
  gs.record({
    kind: gs.just('response'),
    statusCode: gs.oneOf(gs.sampledFrom([200, 201, 404, 400, 500, 502, 503, 504]), gs.integers({ minValue: 200, maxValue: 599 })),
    body: json,
    gzip: gs.booleans(),
    contentType: gs.sampledFrom(['application/json', 'application/vnd.elasticsearch+json;compatible-with=9', 'text/plain', undefined])
  }),
  gs.record({ kind: gs.just('error'), error: gs.sampledFrom(['ConnectionError', 'TimeoutError']) })
)

function scriptedTransport (tc, script, opts = {}) {
  const sent = []
  class ScriptedConnection extends BaseConnection {
    async request (params) {
      sent.push({ ...params, connection: this.id })
      const next = script[sent.length - 1] ?? { kind: 'response', statusCode: 200, body: {}, contentType: 'application/json' }
      if (next.kind === 'error') throw new errors[next.error]('scripted')
      const text = next.contentType?.includes('json') ? JSON.stringify(next.body) : String(next.body)
      const headers = { ...next.headers, ...(next.contentType != null ? { 'content-type': next.contentType } : {}) }
      if (next.gzip) headers['content-encoding'] = 'gzip'
      return { statusCode: next.statusCode, headers, body: next.gzip ? gzipSync(text) : text }
    }
  }
  const Pool = tc.draw(gs.sampledFrom([ClusterConnectionPool, WeightedConnectionPool]))
  const pool = new Pool({ Connection: ScriptedConnection })
  const nodes = tc.draw(gs.integers({ minValue: 1, maxValue: 4 }))
  pool.addConnection(Array.from({ length: nodes }, (_, i) => `http://node${i}:9200`))
  const transport = new Transport({ connectionPool: pool, retryBackoff: () => 0, ...opts })
  return { transport, sent }
}

const retriable = o => o.kind === 'error' || [502, 503, 504].includes(o.statusCode)

test('request retries exactly the retriable outcomes and classifies the final one', async () => await hegel.testAsync(async tc => {
  const maxRetries = tc.draw(gs.integers({ minValue: 0, maxValue: 4 }))
  const script = tc.draw(gs.arrays(outcome, { minSize: 1, maxSize: 6 }))
  const { transport, sent } = scriptedTransport(tc, script, { maxRetries, retryOnTimeout: true })

  // expected: the first non-retriable outcome, or the last attempt allowed
  let last = 0
  while (last < maxRetries && last < script.length && retriable(script[last])) last++
  const final = script[last] ?? { kind: 'response', statusCode: 200, body: {}, contentType: 'application/json' }

  let res, err
  try {
    res = await transport.request({ method: 'GET', path: '/' }, { meta: true })
  } catch (e) {
    err = e
  }
  assert.equal(sent.length, last + 1, 'attempt count')
  if (final.kind === 'error') {
    assert.equal(err?.name, final.error)
  } else if (final.statusCode >= 400) {
    assert.ok(err instanceof errors.ResponseError, `expected ResponseError, got ${err}`)
    assert.equal(err.meta.statusCode, final.statusCode)
  } else {
    assert.equal(err, undefined, String(err))
    assert.equal(res.statusCode, final.statusCode)
    assert.equal(res.meta.attempts, last)
    if (final.contentType?.includes('json')) assert.deepEqual(res.body, JSON.parse(JSON.stringify(final.body)))
    else assert.equal(res.body, String(final.body))
  }
}))

test('ignored status codes never throw', async () => await hegel.testAsync(async tc => {
  const statusCode = tc.draw(gs.integers({ minValue: 400, maxValue: 599 }))
  tc.assume(![502, 503, 504].includes(statusCode))
  const { transport } = scriptedTransport(tc, [{ kind: 'response', statusCode, body: tc.draw(jsonObject), contentType: 'application/json' }])
  const res = await transport.request({ method: 'GET', path: '/' }, { ignore: [statusCode], meta: true })
  assert.equal(res.statusCode, statusCode)
}))

test('HEAD requests resolve to booleans', async () => await hegel.testAsync(async tc => {
  const statusCode = tc.draw(gs.sampledFrom([200, 204, 404]))
  const { transport } = scriptedTransport(tc, [{ kind: 'response', statusCode, body: '', contentType: undefined }])
  assert.equal(await transport.request({ method: 'HEAD', path: '/' }), statusCode !== 404)
}))

test('request bodies are serialized and content-length is accurate', async () => await hegel.testAsync(async tc => {
  const body = tc.draw(gs.oneOf(jsonObject, gs.text({ minSize: 1 })))
  const bulk = tc.draw(gs.booleans())
  const compression = tc.draw(gs.booleans())
  const { transport, sent } = scriptedTransport(tc, [], { compression })
  const params = { method: 'POST', path: '/' }
  if (bulk) params.bulkBody = [body]
  else params.body = body
  await transport.request(params)
  const { body: wire, headers } = sent[0]
  let raw = Buffer.isBuffer(wire) ? wire : Buffer.from(wire)
  assert.equal(headers['content-length'], String(raw.length))
  if (compression) raw = gunzipSync(raw)
  const expected = bulk
    ? (typeof body === 'string' ? body : JSON.stringify(body)) + '\n'
    : typeof body === 'string' ? body : JSON.stringify(body)
  assert.equal(raw.toString(), expected)
}))

test('querystrings from params and options are merged', async () => await hegel.testAsync(async tc => {
  const key = gs.text({ alphabet: 'abcdef', minSize: 1, maxSize: 4 })
  const value = gs.text({ alphabet: 'xyz123', maxSize: 4 })
  const a = Object.fromEntries(tc.draw(gs.arrays(gs.tuples(key, value), { maxSize: 4 })))
  const b = Object.fromEntries(tc.draw(gs.arrays(gs.tuples(key, value), { maxSize: 4 })))
  const { transport, sent } = scriptedTransport(tc, [])
  await transport.request({ method: 'GET', path: '/', querystring: { ...a } }, { querystring: { ...b } })
  assert.deepEqual(Object.fromEntries(new URLSearchParams(sent[0].querystring)), { ...a, ...b })
}))

test('maxPathLength rejects exactly the over-long request lines', async () => await hegel.testAsync(async tc => {
  const path = '/' + tc.draw(gs.text({ maxSize: 40 }))
  const querystring = tc.draw(gs.text({ alphabet: 'ab=&', maxSize: 20 }))
  const maxPathLength = tc.draw(gs.integers({ minValue: 1, maxValue: 120 }))
  const { transport } = scriptedTransport(tc, [], { maxPathLength })
  const bytes = Buffer.byteLength(path) + (querystring !== '' ? 1 + Buffer.byteLength(querystring) : 0)
  const req = transport.request({ method: 'GET', path, querystring })
  if (bytes > maxPathLength) await assert.rejects(req, errors.ConfigurationError)
  else await req
}))

test('warnings parse only Elasticsearch warning headers', async () => await hegel.testAsync(async tc => {
  const messages = tc.draw(gs.arrays(gs.text({ alphabet: 'abc xyz', minSize: 1, maxSize: 10 }), { minSize: 1, maxSize: 4 }))
  const warning = messages.map(m => `299 Elasticsearch-9.0.0 "${m}"`).join(',')
  const { transport } = scriptedTransport(tc, [])
  const conn = transport.connectionPool.connections[0]
  conn.request = async () => ({ statusCode: 200, headers: { warning }, body: '' })
  transport.connectionPool.getConnection = () => conn
  const res = await transport.request({ method: 'GET', path: '/' }, { meta: true })
  assert.equal(res.warnings.length, messages.length)
}))

test('diagnostic events fire in order for every request', async () => await hegel.testAsync(async tc => {
  const script = tc.draw(gs.arrays(outcome, { maxSize: 3 }))
  const { transport } = scriptedTransport(tc, script, { maxRetries: 2 })
  const events = []
  for (const name of ['serialization', 'request', 'deserialization', 'response']) {
    transport.diagnostic.on(name, () => events.push(name))
  }
  await transport.request({ method: 'GET', path: '/' }).catch(() => {})
  assert.equal(events[0], 'serialization')
  assert.equal(events.at(-1), 'response')
  assert.equal(events.filter(e => e === 'response').length, 1)
}))

test('productCheck rejects exactly the 2xx responses from other products', async () => await hegel.testAsync(async tc => {
  const statusCode = tc.draw(gs.sampledFrom([200, 201, 299, 400, 404]))
  const product = tc.draw(gs.optional(gs.sampledFrom(['Elasticsearch', 'elasticsearch', 'Other'])))
  const headers = product != null ? { 'x-elastic-product': product } : {}
  const { transport } = scriptedTransport(tc, [{ kind: 'response', statusCode, headers, body: {}, contentType: 'application/json' }], { productCheck: 'Elasticsearch' })
  const req = transport.request({ method: 'GET', path: '/' }, { ignore: [400, 404] })
  if (statusCode < 300 && product !== 'Elasticsearch') await assert.rejects(req, errors.ProductNotSupportedError)
  else await req
}))

const exporter = new InMemorySpanExporter()
new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).register()

// string literals of a JSON value, excluding any that also occur inside a key
function literals (v, keys = []) {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.flatMap(x => literals(x, keys))
  if (v !== null && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => { keys.push(k); return literals(x, keys) })
  return []
}

test('OpenTelemetry records one span per request and never leaks query literals', async () => await hegel.testAsync(async tc => {
  exporter.reset()
  const name = tc.draw(gs.sampledFrom(['search', 'msearch', 'esql.query', 'index', 'knn_search']))
  const body = tc.draw(jsonObject)
  const script = tc.draw(gs.arrays(outcome, { maxSize: 2 }))
  const { transport } = scriptedTransport(tc, script, { maxRetries: 1, openTelemetry: { captureSearchQuery: tc.draw(gs.booleans()) } })
  const params = { method: 'POST', path: '/', meta: { name } }
  if (name === 'msearch') params.bulkBody = [{}, body]
  else params.body = body
  let failed = false
  await transport.request(params).catch(() => { failed = true })
  const spans = exporter.getFinishedSpans()
  assert.equal(spans.length, 1)
  const attrs = spans[0].attributes
  assert.equal(attrs['error.type'] != null, failed)
  const text = attrs['db.query.text']
  if (text != null) {
    const keys = []
    const lits = literals(body, keys)
    for (const lit of lits) {
      if (lit.length < 3 || keys.some(k => k.includes(lit)) || (name === 'esql.query' && lit === body.query)) continue
      assert.ok(!text.includes(JSON.stringify(lit)), `literal ${JSON.stringify(lit)} leaked into ${text}`)
    }
  }
}))
