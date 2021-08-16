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

'use strict'

import { test } from 'tap'
import { events, errors } from '../..'
import { TestClient, connection } from '../utils'

const { buildMockConnection } = connection

test('No errors v8', async t => {
  t.plan(2)

  const MockConnection = buildMockConnection({
    onRequest (params) {
      return {
        statusCode: 200,
        headers: {
          'x-elastic-product': 'Elasticsearch'
        },
        body: {
          name: '1ef419078577',
          cluster_name: 'docker-cluster',
          cluster_uuid: 'cQ5pAMvRRTyEzObH4L5mTA',
          version: {
            number: '8.0.0-SNAPSHOT',
            build_flavor: 'default',
            build_type: 'docker',
            build_hash: '5fb4c050958a6b0b6a70a6fb3e616d0e390eaac3',
            build_date: '2021-07-10T01:45:02.136546168Z',
            build_snapshot: true,
            lucene_version: '8.9.0',
            minimum_wire_compatibility_version: '7.15.0',
            minimum_index_compatibility_version: '7.0.0'
          },
          tagline: 'You Know, for Search'
        }
      }
    }
  })

  const client = new TestClient({
    node: 'http://localhost:9200',
    Connection: MockConnection
  })

  client.diagnostic.on(events.RESPONSE, (err, event) => {
    t.error(err)
  })

  await client.request({
    path: '/foo/_search',
    method: 'POST',
    body: {
      query: {
        match_all: {}
      }
    }
  })
  t.pass('ok')
})

test('Errors v8', async t => {
  t.plan(2)

  const MockConnection = buildMockConnection({
    onRequest (params) {
      return {
        statusCode: 200,
        headers: {
          'x-elastic-product': undefined
        },
        body: {
          name: '1ef419078577',
          cluster_name: 'docker-cluster',
          cluster_uuid: 'cQ5pAMvRRTyEzObH4L5mTA',
          version: {
            number: '8.0.0-SNAPSHOT',
            build_flavor: 'default',
            build_type: 'docker',
            build_hash: '5fb4c050958a6b0b6a70a6fb3e616d0e390eaac3',
            build_date: '2021-07-10T01:45:02.136546168Z',
            build_snapshot: true,
            lucene_version: '8.9.0',
            minimum_wire_compatibility_version: '7.15.0',
            minimum_index_compatibility_version: '7.0.0'
          },
          tagline: 'You Know, for Search'
        }
      }
    }
  })

  const client = new TestClient({
    node: 'http://localhost:9200',
    Connection: MockConnection
  })

  client.diagnostic.on(events.RESPONSE, (err, event) => {
    t.ok(err instanceof errors.ProductNotSupportedError)
  })

  try {
    await client.request({
      path: '/foo/_search',
      method: 'POST',
      body: {
        query: {
          match_all: {}
        }
      }
    })
    t.fail('Should throw')
  } catch (err) {
    t.equal(err.message, 'The client noticed that the server is not Elasticsearch and we do not support this unknown product.')
  }
})

test('401', async t => {
  t.plan(2)

  const MockConnection = buildMockConnection({
    onRequest (params) {
      return {
        statusCode: 401,
        headers: {
          'x-elastic-product': undefined
        },
        body: { error: true }
      }
    }
  })

  const client = new TestClient({
    node: 'http://localhost:9200',
    Connection: MockConnection
  })

  client.diagnostic.on(events.RESPONSE, (err, event) => {
    t.ok(err instanceof errors.ResponseError)
  })

  try {
    await client.request({
      path: '/foo/_search',
      method: 'POST',
      body: {
        query: {
          match_all: {}
        }
      }
    })
    t.fail('Should throw')
  } catch (err) {
    t.equal(err.statusCode, 401)
  }
})

test('403', async t => {
  t.plan(2)

  const MockConnection = buildMockConnection({
    onRequest (params) {
      return {
        statusCode: 403,
        headers: {
          'x-elastic-product': undefined
        },
        body: { error: true }
      }
    }
  })

  const client = new TestClient({
    node: 'http://localhost:9200',
    Connection: MockConnection
  })

  client.diagnostic.on(events.RESPONSE, (err, event) => {
    t.ok(err instanceof errors.ResponseError)
  })

  try {
    await client.request({
      path: '/foo/_search',
      method: 'POST',
      body: {
        query: {
          match_all: {}
        }
      }
    })
    t.fail('Should throw')
  } catch (err) {
    t.equal(err.statusCode, 403)
  }
})
