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

const { EventEmitter } = require('events')
const { test } = require('tap')
const {
  Transport,
  Serializer,
  ClusterConnectionPool,
  events
} = require('../../index')
const { TimeoutError } = require('../../lib/errors')
const {
  connection: {
    MockConnection,
    MockConnectionTimeout
  }
} = require('../utils')

function prepare (Connection = MockConnection) {
  const ee = new EventEmitter()
  const pool = new ClusterConnectionPool({ Connection })
  pool.addConnection('http://localhost:9200')
  const transport = new Transport({
    emit: ee.emit.bind(ee),
    connectionPool: pool,
    serializer: new Serializer(),
    maxRetries: 3,
    requestTimeout: 30000,
    sniffInterval: false,
    sniffOnStart: false,
    sniffEndpoint: '_nodes/_all/http',
    sniffOnConnectionFault: false,
    name: 'elasticsearch-js'
  })
  return { transport, ee }
}

test('Should emit a request event when a request is performed', t => {
  t.plan(3)

  const { transport, ee } = prepare()

  ee.on(events.REQUEST, (err, request) => {
    t.error(err)
    t.match(request, {
      body: null,
      statusCode: null,
      headers: null,
      warnings: null,
      meta: {
        context: null,
        name: 'elasticsearch-js',
        request: {
          params: {
            method: 'GET',
            path: '/test/_search',
            body: '',
            querystring: 'q=foo%3Abar'
          },
          options: {},
          id: 1
        },
        connection: {
          id: 'http://localhost:9200'
        },
        attempts: 0,
        aborted: false
      }
    })
  })

  transport.request({
    method: 'GET',
    path: '/test/_search',
    querystring: {
      q: 'foo:bar'
    },
    body: ''
  }, (err, result) => {
    t.error(err)
  })
})

test('Should emit a request event once when a request is performed', t => {
  t.plan(4)

  const { transport, ee } = prepare()

  ee.once(events.REQUEST, (err, request) => {
    t.error(err)
    t.match(request, {
      body: null,
      statusCode: null,
      headers: null,
      warnings: null,
      meta: {
        context: null,
        name: 'elasticsearch-js',
        request: {
          params: {
            method: 'GET',
            path: '/test/_search',
            body: '',
            querystring: 'q=foo%3Abar'
          },
          options: {},
          id: 1
        },
        connection: {
          id: 'http://localhost:9200'
        },
        attempts: 0,
        aborted: false
      }
    })
  })

  transport.request({
    method: 'GET',
    path: '/test/_search',
    querystring: {
      q: 'foo:bar'
    },
    body: ''
  }, (err, result) => {
    t.error(err)
  })

  transport.request({
    method: 'GET',
    path: '/test/_search',
    querystring: {
      q: 'foo:bar'
    },
    body: ''
  }, (err, result) => {
    t.error(err)
  })
})

test('Should emit a response event in case of a successful response', t => {
  t.plan(3)

  const { transport, ee } = prepare()

  ee.on(events.RESPONSE, (err, request) => {
    t.error(err)
    t.match(request, {
      body: { hello: 'world' },
      statusCode: 200,
      headers: {
        'content-type': 'application/json;utf=8',
        connection: 'keep-alive'
      },
      warnings: null,
      meta: {
        context: null,
        name: 'elasticsearch-js',
        request: {
          params: {
            method: 'GET',
            path: '/test/_search',
            body: '',
            querystring: 'q=foo%3Abar'
          },
          options: {},
          id: 1
        },
        connection: {
          id: 'http://localhost:9200'
        },
        attempts: 0,
        aborted: false
      }
    })
  })

  transport.request({
    method: 'GET',
    path: '/test/_search',
    querystring: {
      q: 'foo:bar'
    },
    body: ''
  }, (err, result) => {
    t.error(err)
  })
})

test('Should emit a response event with the error set', t => {
  t.plan(3)

  const { transport, ee } = prepare(MockConnectionTimeout)

  ee.on(events.RESPONSE, (err, request) => {
    t.ok(err instanceof TimeoutError)
    t.match(request, {
      body: null,
      statusCode: null,
      headers: null,
      warnings: null,
      meta: {
        context: null,
        name: 'elasticsearch-js',
        request: {
          params: {
            method: 'GET',
            path: '/test/_search',
            body: '',
            querystring: 'q=foo%3Abar'
          },
          options: {
            requestTimeout: 500
          },
          id: 1
        },
        connection: {
          id: 'http://localhost:9200'
        },
        attempts: 0,
        aborted: false
      }
    })
  })

  transport.request({
    method: 'GET',
    path: '/test/_search',
    querystring: {
      q: 'foo:bar'
    },
    body: ''
  }, {
    maxRetries: 0,
    requestTimeout: 500
  }, (err, result) => {
    t.ok(err instanceof TimeoutError)
  })
})
