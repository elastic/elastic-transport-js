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
import FakeTimers from '@sinonjs/fake-timers'
import { generateRequestId } from '../../lib/Transport'
import { TransportRequestParams, TransportRequestOptions, events, Connection } from '../../'
import { TestClient, connection } from '../utils'

const  { MockConnection, MockConnectionSniff } = connection

test('Request id', t => {
  t.test('Default generateRequestId', t => {
    t.type(generateRequestId, 'function')

    const genReqId = generateRequestId()
    t.type(genReqId, 'function')

    for (let i = 1; i <= 10; i++) {
      t.strictEqual(genReqId({ method: 'GET', path: '/' }, {}), i)
    }

    t.end()
  })

  t.test('Custom generateRequestId', t => {
    t.plan(7)

    const options = { context: { winter: 'is coming' } }

    const client = new TestClient({
      node: 'http://localhost:9200',
      Connection: MockConnection,
      generateRequestId: function (params: TransportRequestParams, opts: TransportRequestOptions) {
        // @ts-expect-error
        t.match(params, { method: 'GET', path: '/' })
        // @ts-expect-error
        t.match(opts, options)
        return 'custom-id'
      }
    })

    client.diagnostic.on(events.REQUEST, (err, event) => {
      t.error(err)
      t.strictEqual(event?.meta.request.id, 'custom-id')
    })

    client.diagnostic.on(events.RESPONSE, (err, event) => {
      t.error(err)
      t.strictEqual(event?.meta.request.id, 'custom-id')
    })

    client.request({ method: 'GET', path: '/' }, options)
      .then(() => t.pass('ok'))
      .catch(err => t.fail(err))
  })

  t.test('Custom request id in method options', t => {
    t.plan(5)

    const client = new TestClient({
      node: 'http://localhost:9200',
      Connection: MockConnection
    })

    client.diagnostic.on(events.REQUEST, (err, event) => {
      t.error(err)
      t.strictEqual(event?.meta.request.id, 'custom-id')
    })

    client.diagnostic.on(events.RESPONSE, (err, event) => {
      t.error(err)
      t.strictEqual(event?.meta.request.id, 'custom-id')
    })

    client.request({ method: 'GET', path: '/' }, { id: 'custom-id' })
      .then(() => t.pass('ok'))
      .catch(err => t.fail(err))
  })

  t.test('Sniff and correlation id', t => {
    t.test('sniffOnStart - should autogenerate the id', t => {
      t.plan(2)

      const client = new TestClient({
        node: 'http://localhost:9200',
        Connection: MockConnectionSniff,
        sniffOnStart: true
      })

      client.diagnostic.on(events.SNIFF, (err, event) => {
        t.error(err)
        t.strictEqual(event?.meta.request.id, 1)
      })
    })

    t.test('sniffOnConnectionFault - should reuse the request id', t => {
      t.plan(6)

      const client = new TestClient({
        nodes: ['http://localhost:9200', 'http://localhost:9201'],
        Connection: MockConnectionSniff,
        sniffOnConnectionFault: true,
        maxRetries: 0
      })

      client.diagnostic.on(events.REQUEST, (e, event) => {
        t.strictEqual(event?.meta.request.id, 'custom')
      })

      client.diagnostic.on(events.RESPONSE, (e, event) => {
        t.strictEqual(event?.meta.request.id, 'custom')
      })

      client.diagnostic.on(events.SNIFF, (e, event) => {
        t.strictEqual(event?.meta.request.id, 'custom')
      })

      client.request({ method: 'GET', path: '/500' }, { id: 'custom', headers: { timeout: 'true' } })
        .then(() => t.fail('should fail'))
        .catch(err => t.ok(err))
    })

    t.end()
  })

  t.test('Resurrect should use the same request id of the request that starts it', t => {
    t.plan(3)

    const clock = FakeTimers.install({ toFake: ['Date'] })
    const client = new TestClient({
      node: 'http://localhost:9200',
      Connection: MockConnection,
      maxRetries: 0
    })

    client.diagnostic.on(events.RESURRECT, (err, meta) => {
      t.error(err)
      t.strictEqual(meta?.request.id, 'custom')
      clock.uninstall()
    })

    const conn = client.connectionPool.getConnection({
      now: 0,
      requestId: 'other',
      name: 'test',
      context: null
    }) as Connection
    client.connectionPool.markDead(conn)
    clock.tick(1000 * 61)

    client.request({ method: 'GET', path: '/' }, { id: 'custom' })
      .then(() => t.pass('ok'))
      .catch(err => t.fail(err))
  })

  t.end()
})

test('Request context', t => {
  t.test('no value', t => {
    t.plan(5)

    const client = new TestClient({
      node: 'http://localhost:9200',
      Connection: MockConnection
    })

    client.diagnostic.on(events.REQUEST, (err, event) => {
      t.error(err)
      t.strictEqual(event?.meta.context, null)
    })

    client.diagnostic.on(events.RESPONSE, (err, event) => {
      t.error(err)
      t.strictEqual(event?.meta.context, null)
    })

    client.request({ method: 'GET', path: '/' })
      .then(() => t.pass('ok'))
      .catch(err => t.fail(err))
  })

  t.test('custom value', t => {
    t.plan(5)

    const client = new TestClient({
      node: 'http://localhost:9200',
      Connection: MockConnection
    })

    client.diagnostic.on(events.REQUEST, (err, event) => {
      t.error(err)
      t.deepEqual(event?.meta.context, { winter: 'is coming' })
    })

    client.diagnostic.on(events.RESPONSE, (err, event) => {
      t.error(err)
      t.deepEqual(event?.meta.context, { winter: 'is coming' })
    })

    client.request({ method: 'GET', path: '/' }, { context: { winter: 'is coming' } })
      .then(() => t.pass('ok'))
      .catch(err => t.fail(err))
  })

  t.test('global value', t => {
    t.plan(5)

    const client = new TestClient({
      node: 'http://localhost:9200',
      Connection: MockConnection,
      context: { winter: 'is coming' }
    })

    client.diagnostic.on(events.REQUEST, (err, event) => {
      t.error(err)
      t.deepEqual(event?.meta.context, { winter: 'is coming' })
    })

    client.diagnostic.on(events.RESPONSE, (err, event) => {
      t.error(err)
      t.deepEqual(event?.meta.context, { winter: 'is coming' })
    })

    client.request({ method: 'GET', path: '/' })
      .then(() => t.pass('ok'))
      .catch(err => t.fail(err))
  })

  t.test('override global', t => {
    t.plan(5)

    const client = new TestClient({
      node: 'http://localhost:9200',
      Connection: MockConnection,
      context: { winter: 'is coming' }
    })

    client.diagnostic.on(events.REQUEST, (err, event) => {
      t.error(err)
      t.deepEqual(event?.meta.context, { winter: 'has come' })
    })

    client.diagnostic.on(events.RESPONSE, (err, event) => {
      t.error(err)
      t.deepEqual(event?.meta.context, { winter: 'has come' })
    })

    client.request({ method: 'GET', path: '/' }, { context: { winter: 'has come' } })
      .then(() => t.pass('ok'))
      .catch(err => t.fail(err))
  })

  t.end()
})

test('Client name', t => {
  t.test('Property of the client instance', t => {
    const client = new TestClient({
      node: 'http://localhost:9200',
      name: 'cluster'
    })
    t.strictEqual(client.name, 'cluster')
    t.end()
  })

  t.test('Is present in the event metadata (as string)', t => {
    t.plan(5)
    const client = new TestClient({
      node: 'http://localhost:9200',
      Connection: MockConnection,
      name: 'cluster'
    })

    client.diagnostic.on(events.REQUEST, (err, event) => {
      t.error(err)
      t.strictEqual(event?.meta.name, 'cluster')
    })

    client.diagnostic.on(events.RESPONSE, (err, event) => {
      t.error(err)
      t.strictEqual(event?.meta.name, 'cluster')
    })

    client.request({ method: 'GET', path: '/' }, { meta: true })
      .then(({ meta }) => t.strictEqual(meta.name, 'cluster'))
      .catch(err => t.fail(err))
  })

  t.test('Is present in the event metadata (as symbol)', t => {
    t.plan(5)
    const symbol = Symbol('cluster')
    const client = new TestClient({
      node: 'http://localhost:9200',
      Connection: MockConnection,
      name: symbol
    })

    client.diagnostic.on(events.REQUEST, (err, event) => {
      t.error(err)
      t.strictEqual(event?.meta.name, symbol)
    })

    client.diagnostic.on(events.RESPONSE, (err, event) => {
      t.error(err)
      t.strictEqual(event?.meta.name, symbol)
    })

    client.request({ method: 'GET', path: '/' }, { meta: true })
      .then(({ meta }) => t.strictEqual(meta.name, symbol))
      .catch(err => t.fail(err))
  })

  t.test('Sniff and client name', t => {
    t.test('sniffOnStart', t => {
      t.plan(2)

      const client = new TestClient({
        node: 'http://localhost:9200',
        Connection: MockConnectionSniff,
        sniffOnStart: true
      })

      client.diagnostic.on(events.SNIFF, (err, event) => {
        t.error(err)
        t.strictEqual(event?.meta.name, 'elasticsearch-js')
      })
    })

    t.test('sniffOnConnectionFault', t => {
      t.plan(6)

      const client = new TestClient({
        nodes: ['http://localhost:9200', 'http://localhost:9201'],
        Connection: MockConnectionSniff,
        sniffOnConnectionFault: true,
        maxRetries: 0
      })

      client.diagnostic.on(events.REQUEST, (e, event) => {
        t.strictEqual(event?.meta.name, 'elasticsearch-js')
      })

      client.diagnostic.on(events.RESPONSE, (e, event) => {
        t.strictEqual(event?.meta.name, 'elasticsearch-js')
      })

      client.diagnostic.on(events.SNIFF, (e, event) => {
        t.strictEqual(event?.meta.name, 'elasticsearch-js')
      })

      client.request({ method: 'GET', path: '/500' }, { id: 'custom', headers: { timeout: 'true' } })
        .then(() => t.fail('should fail'))
        .catch(err => t.ok(err))
    })

    t.end()
  })

  t.test('Resurrect should have the client name configured', t => {
    t.plan(3)

    const clock = FakeTimers.install({ toFake: ['Date'] })
    const client = new TestClient({
      node: 'http://localhost:9200',
      Connection: MockConnection,
      sniffOnConnectionFault: true,
      maxRetries: 0
    })

    const conn = client.connectionPool.getConnection({
      now: 0,
      requestId: 'other',
      name: 'test',
      context: null
    }) as Connection
    client.connectionPool.markDead(conn)
    clock.tick(1000 * 61)

    client.diagnostic.on(events.RESURRECT, (err, event) => {
      t.error(err)
      t.strictEqual(event?.name, 'elasticsearch-js')
      clock.uninstall()
    })

    client.request({ method: 'GET', path: '/' }, { id: 'custom' })
      .then(() => t.pass('ok'))
      .catch(err => t.fail(err))
  })

  t.end()
})
