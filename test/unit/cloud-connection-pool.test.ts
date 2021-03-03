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
  t.strictEqual(pool.cloudConnection, null)
})
