/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import buffer from 'buffer'
import { promisify } from 'util'
import { Readable as ReadableStream } from 'stream'
import { gzipSync, deflateSync } from 'zlib'
import os from 'os'
import { Readable } from 'stream'
import intoStream from 'into-stream'
import * as http from 'http'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
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
import { connection, buildServer } from '../utils'

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
  t.same(res.body, { hello: 'world' })
  t.equal(res.statusCode, 200)
  t.equal(res.headers?.['content-type'], 'application/json;utf=8')
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

  const transport = new Transport({
    connectionPool: pool,
    maxRetries: 0,
    retryOnTimeout: true,
    retryBackoff: () => 0,
  })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    })
  } catch (err: any) {
    t.ok(err instanceof TimeoutError)
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

  const transport = new Transport({
    connectionPool: pool,
    maxRetries: 0,
    retryBackoff: () => 0
  })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    }, { meta: true })
  } catch (err: any) {
    t.ok(err instanceof ConnectionError)
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
  t.same(res.body, { hello: 'world' })
  t.equal(res.statusCode, 404)
  t.equal(res.headers?.['content-type'], 'application/json;utf=8')
})

test('Send POST (json)', async t => {
  t.plan(5)
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.equal(opts.headers?.accept, 'application/vnd.elasticsearch+json; compatible-with=8')
      t.equal(opts.headers?.['content-type'], 'application/vnd.elasticsearch+json; compatible-with=8')
      return {
        body: JSON.parse(opts.body as string),
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    vendoredHeaders: {
      jsonContentType: 'application/vnd.elasticsearch+json; compatible-with=8',
      ndjsonContentType: 'application/vnd.elasticsearch+x-ndjson; compatible-with=8',
      accept: 'application/vnd.elasticsearch+json; compatible-with=8'
    }
  })

  const res = await transport.request({
    method: 'POST',
    path: '/hello',
    body: { hello: 'world' }
  }, { meta: true })
  t.same(res.body, { hello: 'world' })
  t.equal(res.statusCode, 200)
  t.equal(res.headers?.['content-type'], 'application/json;utf=8')
})

test('Send POST (ndjson)', async t => {
  t.plan(6)
  const bulkBody = [
    { hello: 'world' },
    { winter: 'is coming' },
    { you_know: 'for search' }
  ]

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.equal(opts.headers?.accept, 'application/vnd.elasticsearch+json; compatible-with=8')
      t.equal(opts.headers?.['content-type'], 'application/vnd.elasticsearch+x-ndjson; compatible-with=8')
      const body = opts.body as string
      t.equal(body.split('\n')[0], JSON.stringify(bulkBody[0]))
      t.equal(body.split('\n')[1], JSON.stringify(bulkBody[1]))
      t.equal(body.split('\n')[2], JSON.stringify(bulkBody[2]))
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
    vendoredHeaders: {
      jsonContentType: 'application/vnd.elasticsearch+json; compatible-with=8',
      ndjsonContentType: 'application/vnd.elasticsearch+x-ndjson; compatible-with=8',
      accept: 'application/vnd.elasticsearch+json; compatible-with=8'
    }
  })

  const res = await transport.request({
    method: 'POST',
    path: '/hello',
    bulkBody
  }, { meta: true })
  t.equal(res.statusCode, 200)
})

test('Send POST (text/plain)', async t => {
  t.plan(4)

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.equal(opts.headers?.accept, 'application/json, text/plain')
      t.equal(opts.headers?.['content-type'], 'text/plain')
      t.equal(opts.body, 'hello world')
      return {
        body: { hello: 'world' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool
  })

  const res = await transport.request({
    method: 'POST',
    path: '/hello',
    body: 'hello world'
  }, { meta: true })
  t.equal(res.statusCode, 200)
})

test('Send stream (json)', async t => {
  t.plan(2)
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      const body = opts.body as Readable
      t.ok(typeof body?.pipe === 'function')
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
  t.equal(res.statusCode, 200)
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
      t.ok(typeof body?.pipe === 'function')
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
  t.equal(res.statusCode, 200)
})

test('Not JSON payload from server', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      t.equal(opts.headers?.accept, 'application/vnd.elasticsearch+json; compatible-with=8,text/plain')
      return {
        body: 'hello!',
        headers: { 'content-type': 'text/plain' },
        statusCode: 200
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    vendoredHeaders: {
      jsonContentType: 'application/vnd.elasticsearch+json; compatible-with=8',
      ndjsonContentType: 'application/vnd.elasticsearch+x-ndjson; compatible-with=8',
      accept: 'application/vnd.elasticsearch+json; compatible-with=8,text/plain'
    }
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.equal(res.statusCode, 200)
  t.equal(res.body, 'hello!')
})

test('NoLivingConnectionsError', async t => {
  const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    nodeFilter (node: Connection): boolean {
      t.ok(node instanceof UndiciConnection)
      return false
    }
  })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    })
  } catch (err: any) {
    t.ok(err instanceof NoLivingConnectionsError)
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
  } catch (err: any) {
    t.ok(err instanceof SerializationError)
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
  } catch (err: any) {
    t.ok(err instanceof SerializationError)
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
  } catch (err: any) {
    t.ok(err instanceof DeserializationError)
  }
})

test('ResponseError (query failure)', async t => {
  const queryError = {
    "error": {
      "root_cause": [
        {
          "type": "illegal_argument_exception",
          "reason": "Field [some.field] of type [keyword] is not supported for aggregation [max]"
        }
      ],
      "type": "search_phase_execution_exception",
      "reason": "",
      "phase": "fetch",
      "grouped": true,
      "failed_shards": [
        {
          "shard": 0,
          "index": "some-index",
          "node": "someNode",
          "reason": {
            "type": "illegal_argument_exception",
            "reason": "Field [some.field] of type [keyword] is not supported for aggregation [max]"
          }
        }
      ],
      "caused_by": {
        "type": "too_many_buckets_exception",
        "reason": "Trying to create too many buckets. Must be less than or equal to: [65536] but this number of buckets was exceeded. This limit can be set by changing the [search.max_buckets] cluster level setting.",
        "max_buckets": 65536
      }
    },
    "status": 400
  };

  const formattedErrorMessage = [
    'search_phase_execution_exception',
    '\tCaused by:',
    '\t\ttoo_many_buckets_exception: Trying to create too many buckets. Must be less than or equal to: [65536] but this number of buckets was exceeded. This limit can be set by changing the [search.max_buckets] cluster level setting.',
    '\tRoot causes:',
    '\t\tillegal_argument_exception: Field [some.field] of type [keyword] is not supported for aggregation [max]'
  ].join('\n');

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      return {
        body: queryError,
        statusCode: 400
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection([
    'http://localhost:9200',
  ])

  const transport = new Transport({ connectionPool: pool })

  try {
    await transport.request({
      method: 'POST',
      path: '/hello',
      body: intoStream(JSON.stringify({ hello: 'world' }))
    })
  } catch (err: any) {
    t.ok(err instanceof ResponseError)
    t.same(err.message, formattedErrorMessage)
    t.equal(err.statusCode, 400)
  }
})

test('Retry mechanism', async t => {
  let count = 0
  const Conn = buildMockConnection({
    onRequest(_opts: ConnectionRequestParams): { body: any, statusCode: number } {
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
  t.same(res.body, { hello: 'world' })
  t.equal(res.statusCode, 200)
  t.equal(res.meta.attempts, 2)
})

test('Should not retry if the body is a stream', async t => {
  let count = 0
  const Conn = buildMockConnection({
    onRequest(_opts: ConnectionRequestParams): { body: any, statusCode: number } {
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
  } catch (err: any) {
    t.ok(err instanceof ResponseError)
    t.same(err.body, { hello: 'world' })
    t.equal(err.statusCode, 502)
    t.equal(err.meta.meta.attempts, 0)
  }
})

test('Should not use retry backoff until retries exceeds node count', async t => {
  t.plan(3)

  const pool = new WeightedConnectionPool({ Connection: MockConnectionError })
  pool.addConnection([
    'http://localhost:9200',
    'http://localhost:9201',
    'http://localhost:9202',
  ])

  let backoffCount = 0
  const transport = new Transport({
    connectionPool: pool,
    retryBackoff: () => {
      backoffCount++
      return 0
    },
    maxRetries: 3
  })

  try {
    const res = transport.request({
      method: 'GET',
      path: '/hello'
    })
    await res
  } catch (err: any) {
    t.ok(err instanceof ConnectionError)
    t.equal(err.meta.meta.attempts, 3)
    t.equal(backoffCount, 1)
  }
})

test('Should not retry if the bulkBody is a stream', async t => {
  let count = 0
  const Conn = buildMockConnection({
    onRequest(_opts: ConnectionRequestParams): { body: any, statusCode: number } {
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
  } catch (err: any) {
    t.ok(err instanceof ResponseError)
    t.same(err.body, { hello: 'world' })
    t.equal(err.statusCode, 502)
    t.equal(err.meta.meta.attempts, 0)
  }
})

test('Should not retry on timeout error by default (retryOnTimeout is false)', async t => {
  t.plan(2)

  const pool = new WeightedConnectionPool({ Connection: MockConnectionTimeout })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    })
  } catch (err: any) {
    t.ok(err instanceof TimeoutError)
    t.equal(err.meta.meta.attempts, 0)
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
  } catch (err: any) {
    t.ok(err instanceof ResponseError)
    t.same(err.body, { hello: 'world' })
    t.equal(err.statusCode, 502)
    t.equal(err.meta.meta.attempts, 0)
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
  t.same(res.body, { hello: 'world' })
  t.equal(res.statusCode, 200)
  t.equal(res.meta.attempts, 2)
})

test('Retry on connection error', async t => {
  t.plan(2)

  const pool = new WeightedConnectionPool({ Connection: MockConnectionError })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    retryBackoff: () => 0,
  })

  try {
    const res = transport.request({
      method: 'GET',
      path: '/hello'
    })
    await res
  } catch (err: any) {
    t.ok(err instanceof ConnectionError)
    t.equal(err.meta.meta.attempts, 3)
  }
})

test('Retry on timeout error if retryOnTimeout is true', async t => {
  t.plan(2)
  t.clock.enter()
  t.teardown(() => t.clock.exit())

  const pool = new WeightedConnectionPool({ Connection: MockConnectionTimeout })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    retryOnTimeout: true,
    retryBackoff: () => 0
  })

  try {
    const res = transport.request({
      method: 'GET',
      path: '/hello'
    })
    t.clock.advance(4000)
    await res
  } catch (err: any) {
    t.ok(err instanceof TimeoutError)
    t.equal(err.meta.meta.attempts, 3)
  }
})

test('Abort a request', async t => {
  const Conn = buildMockConnection({
    onRequest(_opts: ConnectionRequestParams): { body: any, statusCode: number } {
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
      { signal: abortController.signal }
    )
  } catch (err: any) {
    t.ok(err instanceof RequestAbortedError)
  }
})

test('Serialize querystring', async t => {
  t.plan(2)

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.equal(opts.querystring, 'foo=bar&baz=faz')
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
  t.equal(res.statusCode, 200)
})

test('Serialize querystring (merge with options)', async t => {
  t.plan(2)

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.equal(opts.querystring, 'foo=bar&baz=faz')
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
  t.equal(res.statusCode, 200)
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
  t.equal(res.body, true)
  t.equal(res.statusCode, 200)
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
  t.equal(res.body, false)
  t.equal(res.statusCode, 404)
})

test('Should not cast to boolean HEAD request in case of error', async t => {
  t.plan(2)

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      return {
        body: { hello: 'world' },
        statusCode: 400
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  try {
    await transport.request({
      method: 'HEAD',
      path: '/hello'
    })
  } catch (err: any) {
    t.equal(typeof err.body === 'boolean', false)
    t.equal(err.statusCode, 400)
  }
})

test('Enable compression (gzip response)', async t => {
  t.plan(6)

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      t.equal(opts.headers?.['accept-encoding'], 'gzip,deflate')
      t.equal(opts.headers?.['content-encoding'], 'gzip')
      t.ok(opts.body instanceof Buffer)
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
  t.equal(res.headers?.['content-encoding'], 'gzip')
  t.same(res.body, { hello: 'world' })
  t.equal(res.statusCode, 200)
})

test('Enable compression (deflate response)', async t => {
  t.plan(6)

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      t.equal(opts.headers?.['accept-encoding'], 'gzip,deflate')
      t.equal(opts.headers?.['content-encoding'], 'gzip')
      t.ok(opts.body instanceof Buffer)
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
  t.equal(res.headers?.['content-encoding'], 'deflate')
  t.same(res.body, { hello: 'world' })
  t.equal(res.statusCode, 200)
})

test('Retry compressed request', async t => {
  t.plan(10)

  let count = 0
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      count += 1
      t.equal(opts.headers?.['accept-encoding'], 'gzip,deflate')
      t.equal(opts.headers?.['content-encoding'], 'gzip')
      t.ok(opts.body instanceof Buffer)
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
  t.equal(res.meta.attempts, 2)
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
  } catch (err: any) {
    t.ok(err)
  }
})

test('Compress stream', async t => {
  t.plan(6)

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      t.equal(opts.headers?.['accept-encoding'], 'gzip,deflate')
      t.equal(opts.headers?.['content-encoding'], 'gzip')
      const body = opts.body as Readable
      t.ok(typeof body?.pipe === 'function')
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
  t.equal(res.headers?.['content-encoding'], 'gzip')
  t.same(res.body, { hello: 'world' })
  t.equal(res.statusCode, 200)
})

test('Warning header (single)', async t => {
  const warn = '299 Elasticsearch-7.17.10-fecd68e3150eda0c307ab9a9d7557f5d5fd71349 "the default value for the ?wait_for_active_shards parameter will change"'
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
  t.same(res.warnings, [warn])
})

test('Warning header (multiple)', async t => {
  const warn1 = '112 - "cache down" "Wed, 21 Oct 2015 07:28:00 GMT"'
  const warn2 = '199 agent "Error message" "2015-01-01"'
  const warn3 = '299 Elasticsearch-7.17.10-fecd68e3150eda0c307ab9a9d7557f5d5fd71349 "the default value for the ?wait_for_active_shards parameter will change"'

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      return {
        body: { hello: 'world' },
        statusCode: 200,
        headers: { warning: `${warn1},${warn2},${warn3}` }
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
  t.same(res.warnings, [warn3])
})

test('Warning header (multiple as array)', async t => {
  const warn1 = '112 - "cache down" "Wed, 21 Oct 2015 07:28:00 GMT"'
  const warn2 = '199 agent "Error message" "2015-01-01"'
  const warn3 = '299 Elasticsearch-7.17.10-fecd68e3150eda0c307ab9a9d7557f5d5fd71349 "the default value for the ?wait_for_active_shards parameter will change"'

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      return {
        body: { hello: 'world' },
        statusCode: 200,
        headers: {
          // @ts-expect-error
          warning: [warn1, warn2, warn3],
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

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.same(res.warnings, [warn3])
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
  t.equal(res.warnings, null)
})

test('Custom global headers', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.equal(opts.headers?.['x-foo'], 'bar')
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
  t.equal(res.statusCode, 200)
})

test('Custom local headers', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.equal(opts.headers?.['x-foo'], 'bar')
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
  t.equal(res.statusCode, 200)
})

test('Merge local and global headers', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.equal(opts.headers?.['x-foo'], 'bar2')
      t.equal(opts.headers?.['x-faz'], 'baz')
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
  t.equal(res.statusCode, 200)
})

test('Node filter and node selector', async t => {
  t.plan(4)

  const pool = new ClusterConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    nodeFilter (connection: Connection): boolean {
      t.ok(connection instanceof MockConnection)
      return true
    },
    nodeSelector (connections: Connection[]): Connection {
      t.ok(Array.isArray(connections))
      t.ok(connections[0] instanceof MockConnection)
      return connections[0]
    }
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.equal(res.statusCode, 200)
})

test('User-Agent header', async t => {
  const userAgent = `elastic-transport-js/${transportVersion} (${os.platform()} ${os.release()}-${os.arch()}; Node.js ${process.version})`

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.equal(opts.headers?.['user-agent'], userAgent)
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
  t.equal(res.statusCode, 200)
})

test('generateRequestId', async t => {
  t.plan(5)

  const pool = new ClusterConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    generateRequestId (params: TransportRequestParams, options: TransportRequestOptions) {
      t.same(params, { method: 'GET', path: '/hello' })
      t.same(options, { ignore: [404], meta: true })
      return 42
    }
  })

  transport.diagnostic.on(events.REQUEST, (err, meta) => {
    t.error(err)
    t.equal(meta?.meta.request.id, 42)
  })

  const res = await transport.request(
    { method: 'GET', path: '/hello' },
    { ignore: [404], meta: true }
  )
  t.equal(res.statusCode, 200)
})

test('custom request id', async t => {
  t.plan(3)

  const pool = new ClusterConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  transport.diagnostic.on(events.REQUEST, (err, meta) => {
    t.error(err)
    t.equal(meta?.meta.request.id, 42)
  })

  const res = await transport.request(
    { method: 'GET', path: '/hello' },
    { id: 42, meta: true }
  )
  t.equal(res.statusCode, 200)
})

test('No opaque id by default', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.equal(opts.headers?.['x-opaque-id'], undefined)
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
  t.equal(res.statusCode, 200)
})

test('Opaque id', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.equal(opts.headers?.['x-opaque-id'], 'foo')
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
  t.equal(res.statusCode, 200)
})

test('Opaque id and prefix', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.equal(opts.headers?.['x-opaque-id'], 'bar-foo')
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
  t.equal(res.statusCode, 200)
})

test('Opaque id prefix', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.equal(opts.headers?.['x-opaque-id'], undefined)
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
  t.equal(res.statusCode, 200)
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
    t.same(meta?.meta.context, { hello: 'world' })
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.equal(res.statusCode, 200)
})

test('local context', async t => {
  t.plan(3)

  const pool = new ClusterConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  transport.diagnostic.on(events.REQUEST, (err, meta) => {
    t.error(err)
    t.same(meta?.meta.context, { hello: 'world' })
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, {
    context: { hello: 'world' },
    meta: true
  })
  t.equal(res.statusCode, 200)
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
    t.same(meta?.meta.context, { hello: 'world2' })
  })

  const res = await transport.request({
    method: 'GET',
    path: '/hello'
  }, {
    context: { hello: 'world2' },
    meta: true
  })
  t.equal(res.statusCode, 200)
})

test('Calls the sniff method on connection error', async t => {
  t.plan(6)

  class MyTransport extends Transport {
    sniff (opts: SniffOptions): void {
      t.equal(opts.reason, Transport.sniffReasons.SNIFF_ON_CONNECTION_FAULT)
    }
  }
  const pool = new WeightedConnectionPool({ Connection: MockConnectionError })
  pool.addConnection('http://localhost:9200')

  const transport = new MyTransport({
    connectionPool: pool,
    sniffOnConnectionFault: true,
    retryBackoff: () => 0
  })

  try {
    const res = transport.request({
      method: 'GET',
      path: '/hello'
    })
    await res
  } catch (err: any) {
    t.ok(err instanceof ConnectionError)
    t.equal(err.meta.meta.attempts, 3)
  }
})

test('Calls the sniff method on timeout error if retryOnTimeout is true', async t => {
  t.plan(6)

  t.clock.enter()
  t.teardown(() => t.clock.exit())

  class MyTransport extends Transport {
    sniff (opts: SniffOptions): void {
      t.equal(opts.reason, Transport.sniffReasons.SNIFF_ON_CONNECTION_FAULT)
    }
  }
  const pool = new WeightedConnectionPool({ Connection: MockConnectionTimeout })
  pool.addConnection('http://localhost:9200')

  const transport = new MyTransport({
    connectionPool: pool,
    sniffOnConnectionFault: true,
    retryOnTimeout: true,
    retryBackoff: () => 0,
  })

  try {
    const res = transport.request({
      method: 'GET',
      path: '/hello'
    })
    t.clock.advance(4000)
    await res
  } catch (err: any) {
    t.ok(err instanceof TimeoutError)
    t.equal(err.meta.meta.attempts, 3)
  }
})

test('Sniff on start', async t => {
  t.plan(1)

  class MyTransport extends Transport {
    sniff (opts: SniffOptions): void {
      t.equal(opts.reason, Transport.sniffReasons.SNIFF_ON_START)
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
  t.clock.enter()
  t.teardown(() => t.clock.exit())

  class MyTransport extends Transport {
    sniff (opts: SniffOptions): void {
      t.equal(opts.reason, Transport.sniffReasons.SNIFF_INTERVAL)
    }
  }
  const pool = new WeightedConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')

  const transport = new MyTransport({
    connectionPool: pool,
    sniffInterval: 50
  })

  let promise = transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })

  t.clock.advance(4000)

  let res = await promise
  t.equal(res.statusCode, 200)

  promise = sleep(80)
  t.clock.advance(80)
  await promise

  promise = transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.clock.advance(4000)
  res = await promise
  t.equal(res.statusCode, 200)

  promise = sleep(80)
  t.clock.advance(80)
  await promise

  promise = transport.request({
    method: 'GET',
    path: '/hello'
  }, { meta: true })
  t.clock.advance(4000)
  res = await promise
  t.equal(res.statusCode, 200)
})

test('No connection pool', t => {
  t.plan(1)
  try {
    // @ts-expect-error
    new Transport({})
  } catch (err: any) {
    t.ok(err instanceof ConfigurationError)
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
  } catch (err: any) {
    t.ok(err instanceof ConfigurationError)
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
  } catch (err: any) {
    t.ok(err instanceof ConfigurationError)
  }

  try {
    new Transport({
      connectionPool: pool,
      sniffInterval: -1
    })
  } catch (err: any) {
    t.ok(err instanceof ConfigurationError)
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
  t.same(res, { hello: 'world' })
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
  t.same(res, { hello: 'world' })
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
  t.same(res.body, { hello: 'world' })
})

test('Support mapbox vector tile', async t => {
   t.plan(1)
   const mvtContent = 'GoMCCgRtZXRhEikSFAAAAQACAQMBBAAFAgYDBwAIBAkAGAMiDwkAgEAagEAAAP8//z8ADxoOX3NoYXJkcy5mYWlsZWQaD19zaGFyZHMuc2tpcHBlZBoSX3NoYXJkcy5zdWNjZXNzZnVsGg1fc2hhcmRzLnRvdGFsGhlhZ2dyZWdhdGlvbnMuX2NvdW50LmNvdW50GhdhZ2dyZWdhdGlvbnMuX2NvdW50LnN1bRoTaGl0cy50b3RhbC5yZWxhdGlvbhoQaGl0cy50b3RhbC52YWx1ZRoJdGltZWRfb3V0GgR0b29rIgIwACICMAIiCRkAAAAAAAAAACIECgJlcSICOAAogCB4Ag=='

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams) {
      return {
        body: Buffer.from(mvtContent, 'base64'),
        statusCode: 200,
        headers: {
          'content-type': 'application/vnd.mapbox-vector-tile'
        }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const body = await transport.request<Buffer>({
    method: 'GET',
    path: '/_mvt'
  })
  t.same(body.toString('base64'), Buffer.from(mvtContent, 'base64').toString('base64'))
})

test('Compressed mapbox vector tile', async t => {
   t.plan(1)
   const mvtContent = 'GoMCCgRtZXRhEikSFAAAAQACAQMBBAAFAgYDBwAIBAkAGAMiDwkAgEAagEAAAP8//z8ADxoOX3NoYXJkcy5mYWlsZWQaD19zaGFyZHMuc2tpcHBlZBoSX3NoYXJkcy5zdWNjZXNzZnVsGg1fc2hhcmRzLnRvdGFsGhlhZ2dyZWdhdGlvbnMuX2NvdW50LmNvdW50GhdhZ2dyZWdhdGlvbnMuX2NvdW50LnN1bRoTaGl0cy50b3RhbC5yZWxhdGlvbhoQaGl0cy50b3RhbC52YWx1ZRoJdGltZWRfb3V0GgR0b29rIgIwACICMAIiCRkAAAAAAAAAACIECgJlcSICOAAogCB4Ag=='

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams) {
      return {
        body: gzipSync(Buffer.from(mvtContent, 'base64')),
        statusCode: 200,
        headers: {
          'content-type': 'application/vnd.mapbox-vector-tile',
          'content-encoding': 'gzip'
        }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const body = await transport.request<Buffer>({
    method: 'GET',
    path: '/_mvt'
  })
  t.same(body.toString('base64'), Buffer.from(mvtContent, 'base64').toString('base64'))
})

test('Support Apache Arrow content-type / 1', async t => {
   t.plan(1)
   const binaryContent = 'GoMCCgRtZXRhEikSFAAAAQACAQMBBAAFAgYDBwAIBAkAGAMiDwkAgEAagEAAAP8//z8ADxoOX3NoYXJkcy5mYWlsZWQaD19zaGFyZHMuc2tpcHBlZBoSX3NoYXJkcy5zdWNjZXNzZnVsGg1fc2hhcmRzLnRvdGFsGhlhZ2dyZWdhdGlvbnMuX2NvdW50LmNvdW50GhdhZ2dyZWdhdGlvbnMuX2NvdW50LnN1bRoTaGl0cy50b3RhbC5yZWxhdGlvbhoQaGl0cy50b3RhbC52YWx1ZRoJdGltZWRfb3V0GgR0b29rIgIwACICMAIiCRkAAAAAAAAAACIECgJlcSICOAAogCB4Ag=='

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams) {
      return {
        body: Buffer.from(binaryContent, 'base64'),
        statusCode: 200,
        headers: {
          'content-type': 'application/vnd.elasticsearch+arrow+stream'
        }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const body = await transport.request<Buffer>({
    method: 'GET',
    path: '/_query'
  })
  t.same(body.toString('base64'), Buffer.from(binaryContent, 'base64').toString('base64'))
})

test('Support Apache Arrow content-type / 2', async t => {
   t.plan(1)
   const binaryContent = 'GoMCCgRtZXRhEikSFAAAAQACAQMBBAAFAgYDBwAIBAkAGAMiDwkAgEAagEAAAP8//z8ADxoOX3NoYXJkcy5mYWlsZWQaD19zaGFyZHMuc2tpcHBlZBoSX3NoYXJkcy5zdWNjZXNzZnVsGg1fc2hhcmRzLnRvdGFsGhlhZ2dyZWdhdGlvbnMuX2NvdW50LmNvdW50GhdhZ2dyZWdhdGlvbnMuX2NvdW50LnN1bRoTaGl0cy50b3RhbC5yZWxhdGlvbhoQaGl0cy50b3RhbC52YWx1ZRoJdGltZWRfb3V0GgR0b29rIgIwACICMAIiCRkAAAAAAAAAACIECgJlcSICOAAogCB4Ag=='

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams) {
      return {
        body: Buffer.from(binaryContent, 'base64'),
        statusCode: 200,
        headers: {
          'content-type': 'application/vnd.apache.arrow.stream'
        }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const body = await transport.request<Buffer>({
    method: 'GET',
    path: '/_query'
  })
  t.same(body.toString('base64'), Buffer.from(binaryContent, 'base64').toString('base64'))
})

test('Support CBOR content-type / 1', async t => {
   t.plan(1)
   const binaryContent = 'GoMCCgRtZXRhEikSFAAAAQACAQMBBAAFAgYDBwAIBAkAGAMiDwkAgEAagEAAAP8//z8ADxoOX3NoYXJkcy5mYWlsZWQaD19zaGFyZHMuc2tpcHBlZBoSX3NoYXJkcy5zdWNjZXNzZnVsGg1fc2hhcmRzLnRvdGFsGhlhZ2dyZWdhdGlvbnMuX2NvdW50LmNvdW50GhdhZ2dyZWdhdGlvbnMuX2NvdW50LnN1bRoTaGl0cy50b3RhbC5yZWxhdGlvbhoQaGl0cy50b3RhbC52YWx1ZRoJdGltZWRfb3V0GgR0b29rIgIwACICMAIiCRkAAAAAAAAAACIECgJlcSICOAAogCB4Ag=='

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams) {
      return {
        body: Buffer.from(binaryContent, 'base64'),
        statusCode: 200,
        headers: {
          'content-type': 'application/cbor'
        }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const body = await transport.request<Buffer>({
    method: 'GET',
    path: '/_query'
  })
  t.same(body.toString('base64'), Buffer.from(binaryContent, 'base64').toString('base64'))
})

test('Support CBOR content-type / 2', async t => {
   t.plan(1)
   const binaryContent = 'GoMCCgRtZXRhEikSFAAAAQACAQMBBAAFAgYDBwAIBAkAGAMiDwkAgEAagEAAAP8//z8ADxoOX3NoYXJkcy5mYWlsZWQaD19zaGFyZHMuc2tpcHBlZBoSX3NoYXJkcy5zdWNjZXNzZnVsGg1fc2hhcmRzLnRvdGFsGhlhZ2dyZWdhdGlvbnMuX2NvdW50LmNvdW50GhdhZ2dyZWdhdGlvbnMuX2NvdW50LnN1bRoTaGl0cy50b3RhbC5yZWxhdGlvbhoQaGl0cy50b3RhbC52YWx1ZRoJdGltZWRfb3V0GgR0b29rIgIwACICMAIiCRkAAAAAAAAAACIECgJlcSICOAAogCB4Ag=='

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams) {
      return {
        body: Buffer.from(binaryContent, 'base64'),
        statusCode: 200,
        headers: {
          'content-type': 'application/application/vnd.elasticsearch+cbor'
        }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const body = await transport.request<Buffer>({
    method: 'GET',
    path: '/_query'
  })
  t.same(body.toString('base64'), Buffer.from(binaryContent, 'base64').toString('base64'))
})

test('Support Smile content-type / 1', async t => {
   t.plan(1)
   const binaryContent = 'GoMCCgRtZXRhEikSFAAAAQACAQMBBAAFAgYDBwAIBAkAGAMiDwkAgEAagEAAAP8//z8ADxoOX3NoYXJkcy5mYWlsZWQaD19zaGFyZHMuc2tpcHBlZBoSX3NoYXJkcy5zdWNjZXNzZnVsGg1fc2hhcmRzLnRvdGFsGhlhZ2dyZWdhdGlvbnMuX2NvdW50LmNvdW50GhdhZ2dyZWdhdGlvbnMuX2NvdW50LnN1bRoTaGl0cy50b3RhbC5yZWxhdGlvbhoQaGl0cy50b3RhbC52YWx1ZRoJdGltZWRfb3V0GgR0b29rIgIwACICMAIiCRkAAAAAAAAAACIECgJlcSICOAAogCB4Ag=='

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams) {
      return {
        body: Buffer.from(binaryContent, 'base64'),
        statusCode: 200,
        headers: {
          'content-type': 'application/smile'
        }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const body = await transport.request<Buffer>({
    method: 'GET',
    path: '/_query'
  })
  t.same(body.toString('base64'), Buffer.from(binaryContent, 'base64').toString('base64'))
})

test('Support Smile content-type / 2', async t => {
   t.plan(1)
   const binaryContent = 'GoMCCgRtZXRhEikSFAAAAQACAQMBBAAFAgYDBwAIBAkAGAMiDwkAgEAagEAAAP8//z8ADxoOX3NoYXJkcy5mYWlsZWQaD19zaGFyZHMuc2tpcHBlZBoSX3NoYXJkcy5zdWNjZXNzZnVsGg1fc2hhcmRzLnRvdGFsGhlhZ2dyZWdhdGlvbnMuX2NvdW50LmNvdW50GhdhZ2dyZWdhdGlvbnMuX2NvdW50LnN1bRoTaGl0cy50b3RhbC5yZWxhdGlvbhoQaGl0cy50b3RhbC52YWx1ZRoJdGltZWRfb3V0GgR0b29rIgIwACICMAIiCRkAAAAAAAAAACIECgJlcSICOAAogCB4Ag=='

  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams) {
      return {
        body: Buffer.from(binaryContent, 'base64'),
        statusCode: 200,
        headers: {
          'content-type': 'application/vnd.elasticsearch+smile'
        }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({ connectionPool: pool })

  const body = await transport.request<Buffer>({
    method: 'GET',
    path: '/_query'
  })
  t.same(body.toString('base64'), Buffer.from(binaryContent, 'base64').toString('base64'))
})

test('maxResponseSize request option', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      return {
        body: '',
        statusCode: 200,
        headers: {
          'content-length': '1100'
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
    }, { maxResponseSize: 1000 })
  } catch (err: any) {
    t.ok(err)
  }
})

test('maxCompressedResponseSize request option', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      return {
        body: '',
        statusCode: 200,
        headers: {
          'content-encoding': 'gzip',
          'content-length': '1100'
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
    }, { maxCompressedResponseSize: 1000 })
  } catch (err: any) {
    t.ok(err)
  }
})

test('maxResponseSize constructor option', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      return {
        body: '',
        statusCode: 200,
        headers: {
          'content-length': '1100'
        }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    compression: true,
    maxResponseSize: 1000
  })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    })
  } catch (err: any) {
    t.ok(err)
  }
})

test('maxCompressedResponseSize constructor option', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      return {
        body: '',
        statusCode: 200,
        headers: {
          'content-encoding': 'gzip',
          'content-length': '1100'
        }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    compression: true,
    maxCompressedResponseSize: 1000
  })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    })
  } catch (err: any) {
    t.ok(err)
  }
})

test('maxResponseSize constructor option override', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      return {
        body: '',
        statusCode: 200,
        headers: {
          'content-length': '1100'
        }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    compression: true,
    maxResponseSize: 2000
  })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    }, { maxResponseSize: 1000 })
  } catch (err: any) {
    t.ok(err)
  }
})

test('maxCompressedResponseSize constructor option override', async t => {
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number, headers: http.IncomingHttpHeaders } {
      return {
        body: '',
        statusCode: 200,
        headers: {
          'content-encoding': 'gzip',
          'content-length': '1100'
        }
      }
    }
  })

  const pool = new WeightedConnectionPool({ Connection: Conn })
  pool.addConnection('http://localhost:9200')

  const transport = new Transport({
    connectionPool: pool,
    compression: true,
    maxCompressedResponseSize: 2000
  })

  try {
    await transport.request({
      method: 'GET',
      path: '/hello'
    }, { maxCompressedResponseSize: 1000 })
  } catch (err: any) {
    t.ok(err)
  }
})

test('Should throw on bad maxResponseSize', t => {
  const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
  pool.addConnection('http://localhost:9200')

  try {
    new Transport({ // eslint-disable-line // eslint-disable-line
      connectionPool: pool,
      maxResponseSize: buffer.constants.MAX_STRING_LENGTH + 10
    })
    t.fail('Should throw')
  } catch (err: any) {
    t.ok(err instanceof ConfigurationError)
    t.equal(err.message, `The maxResponseSize cannot be bigger than ${buffer.constants.MAX_STRING_LENGTH}`)
  }
  t.end()
})

test('Should throw on bad maxCompressedResponseSize', t => {
  const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
  pool.addConnection('http://localhost:9200')

  try {
    new Transport({ // eslint-disable-line
      connectionPool: pool,
      maxCompressedResponseSize: buffer.constants.MAX_LENGTH + 10
    })
    t.fail('Should throw')
  } catch (err: any) {
    t.ok(err instanceof ConfigurationError)
    t.equal(err.message, `The maxCompressedResponseSize cannot be bigger than ${buffer.constants.MAX_LENGTH}`)
  }
  t.end()
})

test('Override headers', async t => {
  t.plan(5)
  const Conn = buildMockConnection({
    onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
      t.equal(opts.headers?.accept, 'application/json')
      t.equal(opts.headers?.['content-type'], 'application/yaml')
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
  }, {
    meta: true,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/yaml'
    }
  })
  t.same(res.body, { hello: 'world' })
  t.equal(res.statusCode, 200)
  t.equal(res.headers?.['content-type'], 'application/json;utf=8')
})

test('As stream', async t => {
  t.plan(2)
  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler)

  const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
  pool.addConnection(`http://localhost:${port}`)
  const transport = new Transport({ connectionPool: pool })

  const res = await transport.request<ReadableStream>({
    method: 'GET',
    path: '/'
  }, {
    meta: true,
    asStream: true
  })
  t.ok(res.body instanceof ReadableStream)
  t.equal(res.statusCode, 200)
  server.stop()
})

test('Error redaction defaults', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    setTimeout(() => res.end('ok'), 100)
  }
  const [{ port }, server] = await buildServer(handler)

  const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
  pool.addConnection(`http://localhost:${port}`)

  const transport = new Transport({
    connectionPool: pool,
    requestTimeout: 50,
  })

  try {
    await transport.request({
      path: '/hello',
      method: 'GET'
    }, {
        meta: true,
        headers: {
          authorization: '**-the--secret--code-**'
        }
      })
  } catch (err: any) {
    if (err instanceof TimeoutError) {
      t.notMatch(JSON.stringify(err.meta?.meta?.request?.options?.headers), '**-the--secret--code-**')
    } else {
      t.fail('should not be called')
    }
  }
  server.stop()
})

test('Error "remove" redaction', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    setTimeout(() => res.end('ok'), 100)
  }
  const [{ port }, server] = await buildServer(handler)

  const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
  pool.addConnection(`http://localhost:${port}`)

  const transport = new Transport({
    connectionPool: pool,
    requestTimeout: 50,
    redaction: { type: 'remove' }
  })

  try {
    await transport.request({
      path: '/hello',
      method: 'GET'
    })
  } catch (err: any) {
    if (err instanceof TimeoutError && err.meta !== undefined) {
      t.equal(err.meta.meta.connection, null)
    } else {
      t.fail(`should not be called, got error: ${err}`)
    }
  }
  server.stop()
})

test('Error additional key redaction', async t => {
  t.plan(4)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    setTimeout(() => res.end('ok'), 100)
  }
  const [{ port }, server] = await buildServer(handler)

  const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
  pool.addConnection(`http://localhost:${port}`)

  const transport = new Transport({
    connectionPool: pool,
    requestTimeout: 50,
    redaction: { type: 'replace', additionalKeys: ['x-elastic-secrets'] }
  })

  try {
    await transport.request({
      path: '/hello',
      method: 'GET'
    }, {
        meta: true,
        headers: {
          authorization: 'foo',
          'x-elastic-secrets': 'bar'
        }
      })
  } catch (err: any) {
    if (err instanceof TimeoutError) {
      t.notMatch(JSON.stringify(err.meta?.meta?.request?.options?.headers), '"authorization":"foo"')
      t.notMatch(JSON.stringify(err.meta?.meta?.request?.options?.headers), 'foo')
      t.notMatch(JSON.stringify(err.meta?.meta?.request?.options?.headers), '"x-elastic-secrets":"bar"')
      t.notMatch(JSON.stringify(err.meta?.meta?.request?.options?.headers), 'bar')
    } else {
      t.fail('should not be called')
    }
  }
  server.stop()
})

test('redaction does not get leaked to original object', async t => {
  t.plan(1)
  function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    setTimeout(() => res.end('ok'), 100)
  }
  const [{ port }, server] = await buildServer(handler)

  const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
  pool.addConnection(`http://localhost:${port}`)

  const transport = new Transport({
    connectionPool: pool,
    requestTimeout: 50,
  })

  const original = {
    meta: true,
    headers: {
      authorization: '**-the--secret--code-**'
    }
  }

  try {
    await transport.request({
      path: '/hello',
      method: 'GET'
    }, original)
  } catch (err: any) {
    if (err instanceof TimeoutError) {
      t.match(original.headers.authorization, '**-the--secret--code-**')
    } else {
      t.fail(`should not be called, got error: ${err}`)
    }
  }
  server.stop()
})

test('OpenTelemetry', t => {
  let processor: SimpleSpanProcessor
  let provider: BasicTracerProvider
  let exporter: InMemorySpanExporter

  t.before(() => {
    exporter = new InMemorySpanExporter()
    processor = new SimpleSpanProcessor(exporter)
    provider = new BasicTracerProvider()
    provider.addSpanProcessor(processor)
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

  t.end()
})
