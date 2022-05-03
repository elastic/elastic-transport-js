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
import { URL } from 'url'
import * as http from 'http'
import FakeTimers from '@sinonjs/fake-timers'
import { buildCluster, TestClient } from '../utils'
import { events, errors } from '../../'

const { ConnectionError, ResponseError } = errors

/**
 * The aim of this test is to verify how the resurrect logic behaves
 * in a multi node situation.
 * The `buildCluster` utility can boot an arbitrary number
 * of nodes, that you can kill or spawn at your will.
 * The resurrect API can be tested with its callback
 * or by using the `resurrect` event (to handle automatically
 * triggered resurrections).
 */

test('Should execute the recurrect API with the ping strategy', async t => {
  t.plan(7)

  const clock = FakeTimers.install({ toFake: ['Date'] })

  const cluster = await buildCluster({ numberOfNodes: 2 })
  const client = new TestClient({
    nodes: [{
      url: new URL(cluster.nodes[Object.keys(cluster.nodes)[0]].url),
      id: 'node0'
    }, {
      url: new URL(cluster.nodes[Object.keys(cluster.nodes)[1]].url),
      id: 'node1'
    }],
    maxRetries: 0
  })

  client.diagnostic.on(events.RESURRECT, (err, meta) => {
    t.ok(err instanceof ConnectionError)
    t.equal(meta?.strategy, 'ping')
    t.notOk(meta?.isAlive)
    t.equal(meta?.connection.id, 'node0')
    t.equal(meta?.name, 'elasticsearch-js')
    t.same(meta?.request, { id: 2 })
  })

  await cluster.kill('node0')

  try {
    await client.request({ method: 'GET', path: '/' })
    t.fail('Should throw')
  } catch (err: any) {
    t.ok(err instanceof ConnectionError)
  }

  clock.tick(1000 * 61)
  await client.request({ method: 'GET', path: '/' })

  clock.uninstall()
  cluster.shutdown()
  await client.close()
})

test('Resurrect a node and handle 502/3/4 status code', { skip: 'investigate why this is failing' }, async t => {
  t.plan(13)

  let count = 0
  function handler (req: http.IncomingMessage, res: http.ServerResponse): void {
    res.statusCode = count++ < 2 ? 502 : 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ hello: 'world' }))
  }

  const clock = FakeTimers.install({ toFake: ['Date'] })

  const cluster = await buildCluster({ handler, numberOfNodes: 2 })
  await new Promise((resolve, reject) => setTimeout(resolve, 500))
  const client = new TestClient({
    nodes: [{
      url: new URL(cluster.nodes[Object.keys(cluster.nodes)[0]].url),
      id: 'node0'
    }, {
      url: new URL(cluster.nodes[Object.keys(cluster.nodes)[1]].url),
      id: 'node1'
    }],
    maxRetries: 0
  })

  let idCount = 2
  client.diagnostic.on(events.RESURRECT, (err, meta) => {
    t.error(err)
    t.equal(meta?.strategy, 'ping')
    t.equal(meta?.connection.id, 'node0')
    t.equal(meta?.name, 'elasticsearch-js')
    t.same(meta?.request, { id: idCount++ })
    if (count < 4) {
      t.notOk(meta?.isAlive)
    } else {
      t.ok(meta?.isAlive)
    }
  })

  try {
    await client.request({ method: 'GET', path: '/' })
    t.fail('Should throw')
  } catch (err: any) {
    t.ok(err instanceof ResponseError)
  }

  clock.tick(1000 * 61)
  await client.request({ method: 'GET', path: '/' })

  clock.tick(1000 * 10 * 60)
  await client.request({ method: 'GET', path: '/' })

  clock.uninstall()
  cluster.shutdown()
  await client.close()
})

test('Should execute the recurrect API with the optimistic strategy', async t => {
  t.plan(7)

  const clock = FakeTimers.install({ toFake: ['Date'] })

  const cluster = await buildCluster({ numberOfNodes: 2 })
  const client = new TestClient({
    nodes: [{
      url: new URL(cluster.nodes[Object.keys(cluster.nodes)[0]].url),
      id: 'node0'
    }, {
      url: new URL(cluster.nodes[Object.keys(cluster.nodes)[1]].url),
      id: 'node1'
    }],
    maxRetries: 0,
    resurrectStrategy: 'optimistic'
  })

  client.diagnostic.on(events.RESURRECT, (err, meta) => {
    t.error(err)
    t.equal(meta?.strategy, 'optimistic')
    t.ok(meta?.isAlive)
    t.equal(meta?.connection.id, 'node0')
    t.equal(meta?.name, 'elasticsearch-js')
    t.same(meta?.request, { id: 2 })
  })

  await cluster.kill('node0')

  try {
    await client.request({ method: 'GET', path: '/' })
    t.fail('Should throw')
  } catch (err: any) {
    t.ok(err instanceof ConnectionError)
  }

  clock.tick(1000 * 61)
  await client.request({ method: 'GET', path: '/' })

  clock.uninstall()
  cluster.shutdown()
  await client.close()
})
