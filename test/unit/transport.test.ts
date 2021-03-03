/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { test } from 'tap'
// import buffer from 'buffer'
// import { URL } from 'url'
// import FakeTimers from '@sinonjs/fake-timers'
import { promisify } from 'util'
import { gzipSync, deflateSync } from 'zlib'
import os from 'os'
import { Readable } from 'stream'
import intoStream from 'into-stream'
import * as http from 'http'
import AbortController from 'node-abort-controller'
import {
  Transport,
  Serializer,
  WeightedConnectionPool,
  ClusterConnectionPool,
  ConnectionRequestParams,
  UndiciConnection,
  Connection,
  TransportRequestParams,
  TransportRequestOptions,
  events,
  SniffOptions,
  errors
} from '../..'
import { connection } from '../utils'

const { version: transportVersion } = require('../../package.json') // eslint-disable-line
const sleep = promisify(setTimeout)
const {
  MockConnection,
  MockConnectionTimeout,
  MockConnectionError,
  buildMockConnection
} = connection
const {
  ResponseError,
  ConnectionError,
  TimeoutError,
  NoLivingConnectionsError,
  SerializationError,
  DeserializationError,
  RequestAbortedError,
  ConfigurationError
} = errors

test('Basic', async t => {
  t.plan(4)

  class MyPool extends WeightedConnectionPool {
    markAlive (connection: Connection): this {
      t.pass('called')
      return this
    }

    markDead (connection: Connection): this {
      t.fail('should not be called')
      return this
    }
  }
  const pool = new MyPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.deepEqual(res.body, { hello: 'world' })
  t.strictEqual(res.statusCode, 200)
  t.strictEqual(res.headers?.['content-type'], 'application/json;utf=8')
})

test('Basic error (TimeoutError)', async t => {
  t.plan(2)

  class MyPool extends WeightedConnectionPool {
    markAlive (connection: Connection): this {
      t.fail('should not be called')
      return this
    }

    markDead (connection: Connection): this {
      t.pass('called')
      return this
    }
  }
  const pool = new MyPool({ Connection: MockConnectionTimeout })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool, maxRetries: 0 })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    })
  } catch (err) {
    t.true(err instanceof TimeoutError)
  }
})

test('Basic error (ConnectionError)', async t => {
  t.plan(2)

  class MyPool extends WeightedConnectionPool {
    markAlive (connection: Connection): this {
      t.fail('should not be called')
      return this
    }

    markDead (connection: Connection): this {
      t.pass('called')
      return this
    }
  }
  const pool = new MyPool({ Connection: MockConnectionError })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool, maxRetries: 0 })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    }, { meta: true })
  } catch (err) {
    t.true(err instanceof ConnectionError)
  }
})

test('Ignore status code', async t => {
  const pool = new WeightedConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request(
    { method: 'GET', path: '/404' },
    { ignore: [404], meta: true }
  )
  t.deepEqual(res.body, { hello: 'world' })
  t.strictEqual(res.statusCode, 404)
  t.strictEqual(res.headers?.['content-type'], 'application/json;utf=8')
})

test('Send POST (json)', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      return {
        body: JSON.parse(opts.body as string),
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'POST',
    path: '/hello',
    body: { hello: 'world' }
  }, { meta: true })
  t.deepEqual(res.body, { hello: 'world' })
  t.strictEqual(res.statusCode, 200)
  t.strictEqual(res.headers?.['content-type'], 'application/json;utf=8')
})

test('Send POST (ndjson)', async t => {
  t.plan(5)
  const bulkBody = [
    { hello: 'world' },
    { winter: 'is coming' },
    { you_know: 'for search' }
  ]

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.strictEqual(opts.headers?.['content-type'], 'application/x-ndjson')
      const body = opts.body as string
      t.strictEqual(body.split('\n')[0], JSON.stringify(bulkBody[0]))
      t.strictEqual(body.split('\n')[1], JSON.stringify(bulkBody[1]))
      t.strictEqual(body.split('\n')[2], JSON.stringify(bulkBody[2]))
      return {
        body: { hello: 'world' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'POST',
    path: '/hello',
    bulkBody
  }, { meta: true })
  t.strictEqual(res.statusCode, 200)
})

test('Send stream (json)', async t => {
  t.plan(2)
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      const body = opts.body as Readable
      t.true(typeof body?.pipe === 'function')
      return {
        body: { hello: 'world' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'POST',
    path: '/hello',
    body: intoStream(JSON.stringify({ hello: 'world' }))
  }, { meta: true })
  t.strictEqual(res.statusCode, 200)
})

test('Send stream (ndjson)', async t => {
  t.plan(2)
  const bulkBody = [
    { hello: 'world' },
    { winter: 'is coming' },
    { you_know: 'for search' }
  ]

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      const body = opts.body as Readable
      t.true(typeof body?.pipe === 'function')
      return {
        body: { hello: 'world' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const s = new Serializer()
  const res = await transport.request({
    method: 'POST',
    path: '/hello',
    bulkBody: intoStream(s.ndserialize(bulkBody))
  }, { meta: true })
  t.strictEqual(res.statusCode, 200)
})

test('Not JSON payload from server', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      return {
        body: 'hello!',
        headers: { 'content-type': 'text/plain' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.strictEqual(res.statusCode, 200)
  t.strictEqual(res.body, 'hello!')
})

test('NoLivingConnectionsError', async t => {
  const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    nodeFilter (node: Connection): boolean {
      t.true(node instanceof UndiciConnection)
      return false
    }
  })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    })
  } catch (err) {
    t.true(err instanceof NoLivingConnectionsError)
  }
})

test('SerializationError', async t => {
  const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const body = { hello: 'world' }
  // @ts-expect-error
  body.o = body
  try {
    await transport.request({
      method: 'POST',
      path: '/hello',
      body
    })
  } catch (err) {
    t.true(err instanceof SerializationError)
  }
})

test('SerializationError (bulk)', async t => {
  const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const bulkBody = { hello: 'world' }
  // @ts-expect-error
  bulkBody.o = bulkBody
  try {
    await transport.request({
      method: 'POST',
      path: '/hello',
      bulkBody: [bulkBody]
    })
  } catch (err) {
    t.true(err instanceof SerializationError)
  }
})

test('DeserializationError', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      return {
        body: '{"hello":"wo',
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    })
  } catch (err) {
    t.true(err instanceof DeserializationError)
  }
})

test('Retry mechanism', async t => {
  let count = 0
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      count += 1
      return {
        body: { hello: 'world' },
        statusCode: count > 2 ? 200 : 502
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection([
    'http://localhost:9200',
    'http://localhost:9201',
    'http://localhost:9202'
  ])

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.deepEqual(res.body, { hello: 'world' })
  t.strictEqual(res.statusCode, 200)
  t.strictEqual(res.meta.attempts, 2)
})

test('Should not retry if the body is a stream', async t => {
  let count = 0
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      count += 1
      return {
        body: { hello: 'world' },
        statusCode: count > 2 ? 200 : 502
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection([
    'http://localhost:9200',
    'http://localhost:9201',
    'http://localhost:9202'
  ])

  const transport = new Transport({ connectionPool: pool })

  try {
    await transport.request({
      method: 'POST',
      path: '/hello',
      body: intoStream(JSON.stringify({ hello: 'world' }))
    })
  } catch (err) {
    t.true(err instanceof ResponseError)
    t.deepEqual(err.body, { hello: 'world' })
    t.strictEqual(err.statusCode, 502)
    t.strictEqual(err.meta.meta.attempts, 0)
  }
})

test('Should not retry if the bulkBody is a stream', async t => {
  let count = 0
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      count += 1
      return {
        body: { hello: 'world' },
        statusCode: count > 2 ? 200 : 502
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection([
    'http://localhost:9200',
    'http://localhost:9201',
    'http://localhost:9202'
  ])

  const transport = new Transport({ connectionPool: pool })

  try {
    await transport.request({
      method: 'POST',
      path: '/hello',
      bulkBody: intoStream(JSON.stringify({ hello: 'world' }))
    })
  } catch (err) {
    t.true(err instanceof ResponseError)
    t.deepEqual(err.body, { hello: 'world' })
    t.strictEqual(err.statusCode, 502)
    t.strictEqual(err.meta.meta.attempts, 0)
  }
})

test('Disable maxRetries locally', async t => {
  let count = 0
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      count += 1
      return {
        body: { hello: 'world' },
        statusCode: count > 2 ? 200 : 502
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection([
    'http://localhost:9200',
    'http://localhost:9201',
    'http://localhost:9202'
  ])

  const transport = new Transport({ connectionPool: pool })

  try {
    await transport.request(
      { method: 'GET', path: '/hello' },
      { maxRetries: 0 }
    )
  } catch (err) {
    t.true(err instanceof ResponseError)
    t.deepEqual(err.body, { hello: 'world' })
    t.strictEqual(err.statusCode, 502)
    t.strictEqual(err.meta.meta.attempts, 0)
  }
})

test('Override global maxRetries', async t => {
  let count = 0
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      count += 1
      return {
        body: { hello: 'world' },
        statusCode: count > 2 ? 200 : 502
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection([
    'http://localhost:9200',
    'http://localhost:9201',
    'http://localhost:9202'
  ])

  const transport = new Transport({ connectionPool: pool, maxRetries: 0 })

  const res = await transport.request(
    { method: 'GET', path: '/hello' },
    { maxRetries: 3, meta: true }
  )
  t.deepEqual(res.body, { hello: 'world' })
  t.strictEqual(res.statusCode, 200)
  t.strictEqual(res.meta.attempts, 2)
})

test('Retry on connection error', async t => {
  t.plan(2)

  const pool = new WeightedConnectionPool({ Connection: MockConnectionError })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    })
  } catch (err) {
    t.true(err instanceof ConnectionError)
    t.strictEqual(err.meta.meta.attempts, 3)
  }
})

test('Retry on timeout error', async t => {
  t.plan(2)

  const pool = new WeightedConnectionPool({ Connection: MockConnectionTimeout })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    })
  } catch (err) {
    t.true(err instanceof TimeoutError)
    t.strictEqual(err.meta.meta.attempts, 3)
  }
})

test('Abort a request', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      return {
        body: { hello: 'world' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const abortController = new AbortController()
  setImmediate(() => abortController.abort())
  try {
    await transport.request(
      { method: 'GET', path: '/hello' },
      { abortController }
    )
  } catch (err) {
    t.true(err instanceof RequestAbortedError)
  }
})

test('Serialize querystring', async t => {
  t.plan(2)

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.strictEqual(opts.querystring, 'foo=bar&baz=faz')
      return {
        body: { hello: 'world' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'GET',
    path: '/hello',
    querystring: {
      foo: 'bar',
      baz: 'faz'
    }
  }, { meta: true })
  t.strictEqual(res.statusCode, 200)
})

test('Serialize querystring (merge with options)', async t => {
  t.plan(2)

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.strictEqual(opts.querystring, 'foo=bar&baz=faz')
      return {
        body: { hello: 'world' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'GET',
    path: '/hello',
    querystring: {
      foo: 'bar'
    }
  }, {
    querystring: {
      baz: 'faz'
    },
    meta: true
  })
  t.strictEqual(res.statusCode, 200)
})

test('Should cast to boolean HEAD request (true)', async t => {
  t.plan(2)

  const pool = new WeightedConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'HEAD',
    path: '/hello'
  }, { meta: true })
  t.strictEqual(res.body, true)
  t.strictEqual(res.statusCode, 200)
})

test('Should cast to boolean HEAD request (false)', async t => {
  t.plan(2)

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      return {
        body: { hello: 'world' },
        statusCode: 404
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'HEAD',
    path: '/hello'
  }, { meta: true })
  t.strictEqual(res.body, false)
  t.strictEqual(res.statusCode, 404)
})

test('Enable compression (gzip response)', async t => {
  t.plan(6)

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      t.strictEqual(opts.headers?.['accept-encoding'], 'gzip,deflate')
      t.strictEqual(opts.headers?.['content-encoding'], 'gzip')
      t.true(opts.body instanceof Buffer)
      return {
        body: gzipSync(JSON.stringify({ hello: 'world' })),
        statusCode: 200,
        headers: { 'content-encoding': 'gzip' }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    compression: true
  })

  const res = await transport.request({
    method: 'POST',
    path: '/hello',
    body: { hello: 'world' }
  }, { meta: true })
  t.strictEqual(res.headers?.['content-encoding'], 'gzip')
  t.deepEqual(res.body, { hello: 'world' })
  t.strictEqual(res.statusCode, 200)
})

test('Enable compression (deflate response)', async t => {
  t.plan(6)

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      t.strictEqual(opts.headers?.['accept-encoding'], 'gzip,deflate')
      t.strictEqual(opts.headers?.['content-encoding'], 'gzip')
      t.true(opts.body instanceof Buffer)
      return {
        body: deflateSync(JSON.stringify({ hello: 'world' })),
        statusCode: 200,
        headers: { 'content-encoding': 'deflate' }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    compression: true
  })

  const res = await transport.request({
    method: 'POST',
    path: '/hello',
    body: { hello: 'world' }
  }, { meta: true })
  t.strictEqual(res.headers?.['content-encoding'], 'deflate')
  t.deepEqual(res.body, { hello: 'world' })
  t.strictEqual(res.statusCode, 200)
})

test('Retry compressed request', async t => {
  t.plan(10)

  let count = 0
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      count += 1
      t.strictEqual(opts.headers?.['accept-encoding'], 'gzip,deflate')
      t.strictEqual(opts.headers?.['content-encoding'], 'gzip')
      t.true(opts.body instanceof Buffer)
      return {
        body: { hello: 'world' },
        statusCode: count > 2 ? 200 : 502
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    compression: true
  })

  const res = await transport.request({
    method: 'POST',
    path: '/hello',
    body: { hello: 'world' }
  }, { meta: true })
  t.strictEqual(res.meta.attempts, 2)
})

test('Broken compression', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      const body = gzipSync(JSON.stringify({ hello: 'world' }))
      return {
        body: body.slice(0, -5),
        statusCode: 200,
        headers: {
          'content-encoding': 'gzip',
          'content-length': undefined
        }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    compression: true
  })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    })
  } catch (err) {
    t.ok(err)
  }
})

test('Compress stream', async t => {
  t.plan(6)

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      t.strictEqual(opts.headers?.['accept-encoding'], 'gzip,deflate')
      t.strictEqual(opts.headers?.['content-encoding'], 'gzip')
      const body = opts.body as Readable
      t.true(typeof body?.pipe === 'function')
      return {
        body: gzipSync(JSON.stringify({ hello: 'world' })),
        statusCode: 200,
        headers: { 'content-encoding': 'gzip' }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    compression: true
  })

  const res = await transport.request({
    method: 'POST',
    path: '/hello',
    body: intoStream(JSON.stringify({ hello: 'world' }))
  }, { meta: true })
  t.strictEqual(res.headers?.['content-encoding'], 'gzip')
  t.deepEqual(res.body, { hello: 'world' })
  t.strictEqual(res.statusCode, 200)
})

test('Warning header (single)', async t => {
  const warn = '112 - "cache down" "Wed, 21 Oct 2015 07:28:00 GMT"'
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      return {
        body: { hello: 'world' },
        statusCode: 200,
        headers: { warning: warn }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    compression: true
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.deepEqual(res.warnings, [warn])
})

test('Warning header (multiple)', async t => {
  const warn1 = '112 - "cache down" "Wed, 21 Oct 2015 07:28:00 GMT"'
  const warn2 = '199 agent "Error message" "2015-01-01"'

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      return {
        body: { hello: 'world' },
        statusCode: 200,
        headers: { warning: `${warn1},${warn2}` }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    compression: true
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.deepEqual(res.warnings, [warn1, warn2])
})

test('No warnings', async t => {
  const pool = new WeightedConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    compression: true
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.strictEqual(res.warnings, null)
})

test('Custom global headers', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.strictEqual(opts.headers?.['x-foo'], 'bar')
      return {
        body: { hello: 'world' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    headers: { 'x-foo': 'bar' }
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.strictEqual(res.statusCode, 200)
})

test('Custom local headers', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.strictEqual(opts.headers?.['x-foo'], 'bar')
      return {
        body: { hello: 'world' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, {
    headers: { 'x-foo': 'bar' },
    meta: true
  })
  t.strictEqual(res.statusCode, 200)
})

test('Merge local and global headers', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.strictEqual(opts.headers?.['x-foo'], 'bar2')
      t.strictEqual(opts.headers?.['x-faz'], 'baz')
      return {
        body: { hello: 'world' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    headers: { 'x-foo': 'bar1' }
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, {
    headers: {
      'x-foo': 'bar2',
      'x-faz': 'baz'
    },
    meta: true
  })
  t.strictEqual(res.statusCode, 200)
})

test('Node filter and node selector', async t => {
  t.plan(4)

  const pool = new ClusterConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    nodeFilter (connection: Connection): boolean {
      t.true(connection instanceof MockConnection)
      return true
    },
    nodeSelector (connections: Connection[]): Connection {
      t.true(Array.isArray(connections))
      t.true(connections[0] instanceof MockConnection)
      return connections[0]
    }
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.strictEqual(res.statusCode, 200)
})

test('User-Agent header', async t => {
  const userAgent = `elastic-transport-js/${transportVersion} (${os.platform()} ${os.release()}-${os.arch()}; Node.js ${process.version})`

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.strictEqual(opts.headers?.['user-agent'], userAgent)
      return {
        body: { hello: 'world' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    headers: { 'x-foo': 'bar1' }
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.strictEqual(res.statusCode, 200)
})

test('generateRequestId', async t => {
  t.plan(5)

  const pool = new ClusterConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    generateRequestId (params: TransportRequestParams, options: TransportRequestOptions) {
      t.deepEqual(params, { method: 'GET', path: '/hello' })
      t.deepEqual(options, { ignore: [404], meta: true })
      return 42
    }
  })

  transport.diagnostic.on(events.REQUEST, (err, meta) => {
    t.error(err)
    t.strictEqual(meta?.meta.request.id, 42)
  })

  const res = await transport.request(
    { method: 'GET', path: '/hello' },
    { ignore: [404], meta: true }
  )
  t.strictEqual(res.statusCode, 200)
})

test('custom request id', async t => {
  t.plan(3)

  const pool = new ClusterConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  transport.diagnostic.on(events.REQUEST, (err, meta) => {
    t.error(err)
    t.strictEqual(meta?.meta.request.id, 42)
  })

  const res = await transport.request(
    { method: 'GET', path: '/hello' },
    { id: 42, meta: true }
  )
  t.strictEqual(res.statusCode, 200)
})

test('No opaque id by default', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.strictEqual(opts.headers?.['x-opaque-id'], undefined)
      return {
        body: { hello: 'world' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.strictEqual(res.statusCode, 200)
})

test('Opaque id', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.strictEqual(opts.headers?.['x-opaque-id'], 'foo')
      return {
        body: { hello: 'world' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, {
    opaqueId: 'foo',
    meta: true
  })
  t.strictEqual(res.statusCode, 200)
})

test('Opaque id and prefix', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.strictEqual(opts.headers?.['x-opaque-id'], 'bar-foo')
      return {
        body: { hello: 'world' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    opaqueIdPrefix: 'bar-'
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, {
    opaqueId: 'foo',
    meta: true
  })
  t.strictEqual(res.statusCode, 200)
})

test('Opaque id prefix', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.strictEqual(opts.headers?.['x-opaque-id'], undefined)
      return {
        body: { hello: 'world' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    opaqueIdPrefix: 'bar-'
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.strictEqual(res.statusCode, 200)
})

test('global context', async t => {
  t.plan(3)

  const pool = new ClusterConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    context: { hello: 'world' }
  })

  transport.diagnostic.on(events.REQUEST, (err, meta) => {
    t.error(err)
    t.deepEqual(meta?.meta.context, { hello: 'world' })
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.strictEqual(res.statusCode, 200)
})

test('local context', async t => {
  t.plan(3)

  const pool = new ClusterConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  transport.diagnostic.on(events.REQUEST, (err, meta) => {
    t.error(err)
    t.deepEqual(meta?.meta.context, { hello: 'world' })
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, {
    context: { hello: 'world' },
    meta: true
  })
  t.strictEqual(res.statusCode, 200)
})

test('local and global context', async t => {
  t.plan(3)

  const pool = new ClusterConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    context: { hello: 'world1' }
  })

  transport.diagnostic.on(events.REQUEST, (err, meta) => {
    t.error(err)
    t.deepEqual(meta?.meta.context, { hello: 'world2' })
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, {
    context: { hello: 'world2' },
    meta: true
  })
  t.strictEqual(res.statusCode, 200)
})

test('Calls the sniff method on connection error', async t => {
  t.plan(6)

  class MyTransport extends Transport {
    sniff (opts: SniffOptions): void {
      t.strictEqual(opts.reason, Transport.sniffReasons.SNIFF_ON_CONNECTION_FAULT)
    }
  }
  const pool = new WeightedConnectionPool({ Connection: MockConnectionError })
  pool.addConnection('http://localhost:9200')

  const transport = new MyTransport({
    connectionPool: pool,
    sniffOnConnectionFault: true
  })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    })
  } catch (err) {
    t.true(err instanceof ConnectionError)
    t.strictEqual(err.meta.meta.attempts, 3)
  }
})

test('Calls the sniff method on timeout error', async t => {
  t.plan(6)

  class MyTransport extends Transport {
    sniff (opts: SniffOptions): void {
      t.strictEqual(opts.reason, Transport.sniffReasons.SNIFF_ON_CONNECTION_FAULT)
    }
  }
  const pool = new WeightedConnectionPool({ Connection: MockConnectionTimeout })
  pool.addConnection('http://localhost:9200')

  const transport = new MyTransport({
    connectionPool: pool,
    sniffOnConnectionFault: true
  })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    })
  } catch (err) {
    t.true(err instanceof TimeoutError)
    t.strictEqual(err.meta.meta.attempts, 3)
  }
})

test('Sniff on start', async t => {
  t.plan(1)

  class MyTransport extends Transport {
    sniff (opts: SniffOptions): void {
      t.strictEqual(opts.reason, Transport.sniffReasons.SNIFF_ON_START)
    }
  }
  const pool = new WeightedConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  new MyTransport({
    connectionPool: pool,
    sniffOnStart: true
  })
})

test('Sniff interval', async t => {
  t.plan(5)

  class MyTransport extends Transport {
    sniff (opts: SniffOptions): void {
      t.strictEqual(opts.reason, Transport.sniffReasons.SNIFF_INTERVAL)
    }
  }
  const pool = new WeightedConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new MyTransport({
    connectionPool: pool,
    sniffInterval: 50
  })

  let res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.strictEqual(res.statusCode, 200)

  await sleep(80)

  res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.strictEqual(res.statusCode, 200)

  await sleep(80)

  res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.strictEqual(res.statusCode, 200)
})

test('No connection pool', t => {
  t.plan(1)
  try {
    // @ts-expect-error
    new Transport({})
  } catch (err) {
    t.true(err instanceof ConfigurationError)
  }
})

test('Negative maxRetries is not valid', t => {
  t.plan(1)
  const pool = new WeightedConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  try {
    new Transport({
      connectionPool: pool,
      maxRetries: -1
    })
  } catch (err) {
    t.true(err instanceof ConfigurationError)
  }
})

test('sniffInterval should be false or a positive integer', t => {
  t.plan(2)
  const pool = new WeightedConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  try {
    new Transport({
      connectionPool: pool,
      sniffInterval: true
    })
  } catch (err) {
    t.true(err instanceof ConfigurationError)
  }

  try {
    new Transport({
      connectionPool: pool,
      sniffInterval: -1
    })
  } catch (err) {
    t.true(err instanceof ConfigurationError)
  }
})

test('No meta', async t => {
  t.plan(1)

  const pool = new WeightedConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  })
  t.deepEqual(res, { hello: 'world' })
})

test('meta is false', async t => {
  t.plan(1)

  const pool = new WeightedConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: false })
  t.deepEqual(res, { hello: 'world' })
})

test('meta is true', async t => {
  t.plan(1)

  const pool = new WeightedConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.deepEqual(res.body, { hello: 'world' })
})

// test('asStream set to true', t => {
//   t.plan(3)
//   function handler (req, res) {
//     res.setHeader('Content-Type', 'application/json;utf=8')
//     res.end(JSON.stringify({ hello: 'world' }))
//   }

//   buildServer(handler, ({ port }, server) => {
//     const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
//     pool.addConnection(`http://localhost:${port}`)

//     const transport = new Transport({ connectionPool: pool })

//     transport.request({
//       method: 'GET',
//       path: '/hello'
//     }, {
//       asStream: true
//     }, (err, { body, headers }) => {
//       t.error(err)
//       t.match(headers, {
//         connection: 'keep-alive',
//         'content-type': 'application/json;utf=8'
//       })

//       let payload = ''
//       body.setEncoding('utf8')
//       body.on('data', chunk => { payload += chunk })
//       body.on('error', err => t.fail(err))
//       body.on('end', () => {
//         t.deepEqual(JSON.parse(payload), { hello: 'world' })
//         server.stop()
//       })
//     })
//   })
// })

// test('Secure json parsing', t => {
//   t.test('__proto__ protection', t => {
//     t.plan(2)
//     function handler (req, res) {
//       res.setHeader('Content-Type', 'application/json;utf=8')
//       res.end('{"__proto__":{"a":1}}')
//     }

//     buildServer(handler, ({ port }, server) => {
//       const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
//       pool.addConnection(`http://localhost:${port}`)

//       const transport = new Transport({
//         emit: () => {},
//         connectionPool: pool,
//         serializer: new Serializer(),
//         maxRetries: 3,
//         requestTimeout: 30000,
//         sniffInterval: false,
//         sniffOnStart: false
//       })

//       transport.request({
//         method: 'GET',
//         path: '/hello'
//       }, (err, { body }) => {
//         t.true(err instanceof DeserializationError)
//         t.is(err.message, 'Object contains forbidden prototype property')
//         server.stop()
//       })
//     })
//   })

//   t.test('constructor protection', t => {
//     t.plan(2)
//     function handler (req, res) {
//       res.setHeader('Content-Type', 'application/json;utf=8')
//       res.end('{"constructor":{"prototype":{"bar":"baz"}}}')
//     }

//     buildServer(handler, ({ port }, server) => {
//       const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
//       pool.addConnection(`http://localhost:${port}`)

//       const transport = new Transport({
//         emit: () => {},
//         connectionPool: pool,
//         serializer: new Serializer(),
//         maxRetries: 3,
//         requestTimeout: 30000,
//         sniffInterval: false,
//         sniffOnStart: false
//       })

//       transport.request({
//         method: 'GET',
//         path: '/hello'
//       }, (err, { body }) => {
//         t.true(err instanceof DeserializationError)
//         t.is(err.message, 'Object contains forbidden prototype property')
//         server.stop()
//       })
//     })
//   })

//   t.end()
// })

// test('Lowercase headers utilty', t => {
//   t.plan(4)
//   const { lowerCaseHeaders } = Transport.internals

//   t.deepEqual(lowerCaseHeaders({
//     Foo: 'bar',
//     Faz: 'baz',
//     'X-Hello': 'world'
//   }), {
//     foo: 'bar',
//     faz: 'baz',
//     'x-hello': 'world'
//   })

//   t.deepEqual(lowerCaseHeaders({
//     Foo: 'bar',
//     faz: 'baz',
//     'X-hello': 'world'
//   }), {
//     foo: 'bar',
//     faz: 'baz',
//     'x-hello': 'world'
//   })

//   t.strictEqual(lowerCaseHeaders(null), null)

//   t.strictEqual(lowerCaseHeaders(undefined), undefined)
// })