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
import { MockAgent } from 'undici'
import { UndiciConnection, errors } from '../..'
import { TestClient } from '../utils'

test('Mocking undici with undici\'s mocking utility should work', async t => {
  t.plan(1)

  const mockAgent = new MockAgent()
  const mockPool = mockAgent.get('http://test-cluster:9200')

  const mockResponse = {
    _index: 'test-index',
    _type: '_doc',
    _id: 'TEST_ID',
    _version: 1,
    _seq_no: 0,
    _primary_term: 1,
    found: true,
    _source: {}
  }

  mockPool
    .intercept({ path: '/my-index/_doc/my-id', method: 'GET' })
    .reply(200, mockResponse, {
      headers: {
        'x-elastic-product': 'Elasticsearch',
        'content-type': 'application/json'
      }
    })

  const client = new TestClient({
    node: 'http://test-cluster:9200',
    Connection: UndiciConnection,
    agent: () => mockPool
  })

  const response = await client.request({ method: 'GET', path: '/my-index/_doc/my-id' })
  t.same(response, mockResponse)
})

test('Mock not found', async t => {
  t.plan(2)

  const mockAgent = new MockAgent()
  const mockPool = mockAgent.get('http://test-cluster:9200')

  const client = new TestClient({
    node: 'http://test-cluster:9200',
    Connection: UndiciConnection,
    agent: () => mockPool
  })

  try {
    await client.request({ method: 'GET', path: '/my-index/_doc/my-id' })
  } catch (err: any) {
    t.ok(err instanceof errors.ConnectionError)
    t.ok(['getaddrinfo ENOTFOUND test-cluster', 'getaddrinfo EAI_AGAIN test-cluster'].includes(err.message))
  }
})
