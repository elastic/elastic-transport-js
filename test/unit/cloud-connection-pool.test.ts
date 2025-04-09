/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import { CloudConnectionPool, HttpConnection } from '../..'

test('Should expose a cloudConnection property', t => {
  const pool = new CloudConnectionPool({ Connection: HttpConnection })
  pool.addConnection('http://localhost:9200/')
  t.ok(pool.cloudConnection instanceof HttpConnection)
  t.end()
})

test('Get connection should always return cloudConnection', t => {
  const pool = new CloudConnectionPool({ Connection: HttpConnection })
  pool.addConnection('http://localhost:9200/')
  const opts = {
    now: Date.now() + 1000 * 60 * 3,
    requestId: 1,
    name: 'elasticsearch-js',
    context: null
  }
  t.ok(pool.getConnection(opts) instanceof HttpConnection)
  t.end()
})

test('pool.empty should reset cloudConnection', async t => {
  const pool = new CloudConnectionPool({ Connection: HttpConnection })
  pool.addConnection('http://localhost:9200/')
  t.ok(pool.cloudConnection instanceof HttpConnection)
  await pool.empty()
  t.equal(pool.cloudConnection, null)
})
