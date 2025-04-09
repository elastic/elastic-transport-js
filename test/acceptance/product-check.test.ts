/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
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
  } catch (err: any) {
    t.equal(err.message, 'The client noticed that the server is not Elasticsearch and we do not support this unknown product.')
  }
})

function withCode (code: number): void {
  test(`With code ${code}`, async t => {
    t.plan(2)

    const MockConnection = buildMockConnection({
      onRequest (params) {
        return {
          statusCode: code,
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
    } catch (err: any) {
      t.equal(err.statusCode, code)
    }
  })
}

withCode(401)
withCode(403)
withCode(404)
withCode(413)
