/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

// Real-socket properties for HttpConnection and UndiciConnection against a local server.
// Requests carry content-length, as Transport always sets it.

import { test } from 'tap'
import assert from 'node:assert/strict'
import http from 'node:http'
import { gzipSync } from 'node:zlib'
import * as hegel from '@hegeldev/hegel'
import * as gs from '@hegeldev/hegel/generators'
import { HttpConnection, UndiciConnection, CloudConnectionPool, BaseConnection, errors } from '../../index.js'

// the server replies with whatever the current test case put in `reply`, echoing the request back
let reply = null
const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    const { statusCode, headers, body } = reply
    res.writeHead(statusCode, { 'x-echo-method': req.method, 'x-echo-url': encodeURI(req.url), 'x-echo-body': Buffer.concat(chunks).toString('base64'), ...headers })
    res.end(body)
  })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = new URL(`http://127.0.0.1:${server.address().port}`)
server.unref()

const Connection = gs.sampledFrom([HttpConnection, UndiciConnection])
const pathText = gs.text({ alphabet: 'abcxyz_-019', maxSize: 15 })

test('connections round-trip method, path, body and response bytes', async () => await hegel.testAsync(async tc => {
  const Conn = tc.draw(Connection)
  const conn = new Conn({ url })
  try {
    const method = tc.draw(gs.sampledFrom(['GET', 'POST', 'PUT', 'DELETE']))
    const path = '/' + tc.draw(pathText)
    const querystring = tc.draw(gs.text({ alphabet: 'ab=&', maxSize: 10 }))
    const body = method === 'GET' ? undefined : tc.draw(gs.text())
    const responseBody = tc.draw(gs.text())
    const statusCode = tc.draw(gs.sampledFrom([200, 201, 400, 404, 500]))
    const gzip = tc.draw(gs.booleans())
    reply = {
      statusCode,
      headers: { 'content-type': 'text/plain', ...(gzip ? { 'content-encoding': 'gzip' } : {}) },
      body: gzip ? gzipSync(responseBody) : responseBody
    }
    const res = await conn.request({ method, path, querystring, body, headers: body != null ? { 'content-length': String(Buffer.byteLength(body)) } : {} }, { requestId: 1, name: 'x', context: null })
    assert.equal(res.statusCode, statusCode)
    assert.equal(res.headers['x-echo-method'], method)
    assert.equal(res.headers['x-echo-url'], encodeURI(path + (querystring !== '' ? '?' + querystring : '')))
    assert.equal(Buffer.from(res.headers['x-echo-body'], 'base64').toString(), body ?? '')
    const received = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body)
    assert.deepEqual(received, Buffer.from(reply.body))
  } finally {
    await conn.close()
  }
}))

test('connections enforce maxResponseSize exactly', async () => await hegel.testAsync(async tc => {
  const Conn = tc.draw(Connection)
  const conn = new Conn({ url })
  try {
    const size = tc.draw(gs.integers({ minValue: 0, maxValue: 200 }))
    const max = tc.draw(gs.integers({ minValue: 0, maxValue: 200 }))
    reply = { statusCode: 200, headers: { 'content-type': 'text/plain' }, body: 'x'.repeat(size) }
    const req = conn.request({ method: 'GET', path: '/' }, { requestId: 1, name: 'x', context: null, maxResponseSize: max })
    if (size > max) await assert.rejects(req, errors.RequestAbortedError)
    else assert.equal((await req).body, 'x'.repeat(size))
  } finally {
    await conn.close()
  }
}))

test('connections reject paths with unescaped characters', async () => await hegel.testAsync(async tc => {
  const conn = new (tc.draw(Connection))({ url })
  try {
    const path = '/' + tc.draw(pathText) + tc.draw(gs.sampledFrom([' ', '\n', '\u0100', '\u{1F600}'])) + tc.draw(pathText)
    reply = { statusCode: 200, headers: {}, body: '' }
    await assert.rejects(conn.request({ method: 'GET', path }, { requestId: 1, name: 'x', context: null }), TypeError)
  } finally {
    await conn.close()
  }
}))

test('pre-aborted signals reject with RequestAbortedError', async () => await hegel.testAsync(async tc => {
  const conn = new (tc.draw(Connection))({ url })
  try {
    const ac = new AbortController()
    ac.abort()
    await assert.rejects(conn.request({ method: 'GET', path: '/' }, { requestId: 1, name: 'x', context: null, signal: ac.signal }), errors.RequestAbortedError)
  } finally {
    await conn.close()
  }
}))

test('CloudConnectionPool always returns its single connection', async () => {
  hegel.test(tc => {
    const pool = new CloudConnectionPool({ Connection: BaseConnection })
    const host = tc.draw(gs.text({ alphabet: 'abc', minSize: 1, maxSize: 6 }))
    pool.addConnection(`http://${host}:9200`)
    assert.equal(pool.getConnection({ now: 0, requestId: 1, name: 'x', context: null }), pool.connections[0])
  })
})
