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
import {
  ClusterConnectionPool,
  ConnectionRequestParams,
  HttpConnection,
  BaseConnection,
  Connection,
  errors,
  events
} from '../../'
import { connection } from '../utils'
const { TimeoutError } = errors
const {
  MockConnection,
  MockConnectionTimeout,
  buildMockConnection
} = connection

test('markDead', t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection })
  const href = 'http://localhost:9200/'
  pool.addConnection(href)
  const connection = pool.connections.find(c => c.id === href) as Connection
  pool.markDead(connection)
  t.strictEqual(connection.deadCount, 1)
  t.true(connection.resurrectTimeout > 0)
  t.deepEqual(pool.dead, [href])
  t.end()
})

test('markDead should sort the dead queue by deadTimeout', t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection })
  const href1 = 'http://localhost:9200/1'
  const href2 = 'http://localhost:9200/2'
  pool.addConnection(href1)
  pool.addConnection(href2)
  pool.markDead(pool.connections[1])
  setTimeout(() => {
    pool.markDead(pool.connections[0])
    t.deepEqual(pool.dead, [href2, href1])
    t.end()
  }, 10)
})

test('markDead should ignore connections that no longer exists', t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection })
  pool.addConnection('http://localhost:9200/')
  const conn = pool.createConnection('http://localhost:9201')
  pool.markDead(conn)
  t.deepEqual(pool.dead, [])
  t.end()
})

test('markAlive', t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection })
  const href = 'http://localhost:9200/'
  pool.addConnection(href)
  const connection = pool.connections.find(c => c.id === href) as Connection
  pool.markDead(connection)
  pool.markAlive(connection)
  t.strictEqual(connection.deadCount, 0)
  t.strictEqual(connection.resurrectTimeout, 0)
  t.strictEqual(connection.status, BaseConnection.statuses.ALIVE)
  t.deepEqual(pool.dead, [])
  t.end()
})

test('resurrect', t => {
  t.test('ping strategy', t => {
    t.test('alive', t => {
      t.plan(6)
      const pool = new ClusterConnectionPool({
        resurrectStrategy: 'ping',
        Connection: MockConnection
      })
      const href = 'http://localhost:9200/'
      pool.addConnection(href)
      pool.markDead(pool.connections[0])
      const opts = {
        now: Date.now() + 1000 * 60 * 3,
        requestId: 1,
        name: 'elasticsearch-js',
        context: null
      }
      pool.diagnostic.on(events.RESURRECT, (err, meta) => {
        t.error(err)
        t.deepEqual(meta, {
          strategy: 'ping',
          name: opts.name,
          request: { id: opts.requestId },
          isAlive: true,
          connection: pool.connections[0]
        })
        t.strictEqual(pool.connections[0].deadCount, 0)
        t.strictEqual(pool.connections[0].resurrectTimeout, 0)
        t.strictEqual(pool.connections[0].status, BaseConnection.statuses.ALIVE)
        t.deepEqual(pool.dead, [])
      })
      pool.resurrect(opts)
    })

    t.test('dead', t => {
      t.plan(6)
      const pool = new ClusterConnectionPool({
        resurrectStrategy: 'ping',
        Connection: MockConnectionTimeout
      })
      const href = 'http://localhost:9200/'
      pool.addConnection(href)
      pool.markDead(pool.connections[0])
      const opts = {
        now: Date.now() + 1000 * 60 * 3,
        requestId: 1,
        name: 'elasticsearch-js',
        context: null
      }
      pool.diagnostic.on(events.RESURRECT, (err, meta) => {
        t.true(err instanceof TimeoutError)
        t.deepEqual(meta, {
          strategy: 'ping',
          name: 'elasticsearch-js',
          request: { id: 1 },
          isAlive: false,
          connection: pool.connections[0]
        })
        t.strictEqual(pool.connections[0].deadCount, 2)
        t.true(pool.connections[0].resurrectTimeout > 0)
        t.strictEqual(pool.connections[0].status, BaseConnection.statuses.DEAD)
        t.deepEqual(pool.dead, [href])
      })
      pool.resurrect(opts)
    })

    t.test('still dead', t => {
      t.plan(6)
      const Conn = buildMockConnection({
        onRequest(opts: ConnectionRequestParams): { body: any, statusCode: number } {
          return {
            body: { error: true },
            statusCode: 502
          }
        }
      })
      const pool = new ClusterConnectionPool({
        resurrectStrategy: 'ping',
        Connection: Conn
      })
      const href = 'http://localhost:9200/'
      pool.addConnection(href)
      pool.markDead(pool.connections[0])
      const opts = {
        now: Date.now() + 1000 * 60 * 3,
        requestId: 1,
        name: 'elasticsearch-js',
        context: null
      }
      pool.diagnostic.on(events.RESURRECT, (err, meta) => {
        t.error(err)
        t.deepEqual(meta, {
          strategy: 'ping',
          name: opts.name,
          request: { id: opts.requestId },
          isAlive: false,
          connection: pool.connections[0]
        })
        t.strictEqual(pool.connections[0].deadCount, 2)
        t.true(pool.connections[0].resurrectTimeout > 0)
        t.strictEqual(pool.connections[0].status, BaseConnection.statuses.DEAD)
        t.deepEqual(pool.dead, [href])
      })
      pool.resurrect(opts)
    })

    t.end()
  })

  t.test('optimistic strategy', t => {
    t.plan(6)
    const pool = new ClusterConnectionPool({
      resurrectStrategy: 'optimistic',
      Connection: HttpConnection
    })
    const href = 'http://localhost:9200/'
    pool.addConnection(href)
    pool.markDead(pool.connections[0])
    const opts = {
      now: Date.now() + 1000 * 60 * 3,
      requestId: 1,
      name: 'elasticsearch-js',
      context: null
    }
    pool.diagnostic.on(events.RESURRECT, (err, meta) => {
      t.error(err)
      t.deepEqual(meta, {
        strategy: 'optimistic',
        name: opts.name,
        request: { id: opts.requestId },
        isAlive: true,
        connection: pool.connections[0]
      })
      t.strictEqual(pool.connections[0].deadCount, 1)
      t.true(pool.connections[0].resurrectTimeout > 0)
      t.strictEqual(pool.connections[0].status, BaseConnection.statuses.ALIVE)
      t.deepEqual(pool.dead, [])
    })
    pool.resurrect(opts)
  })

  t.test('none strategy', t => {
    t.plan(4)
    const pool = new ClusterConnectionPool({
      resurrectStrategy: 'none',
      Connection: HttpConnection
    })
    const href = 'http://localhost:9200/'
    pool.addConnection(href)
    pool.markDead(pool.connections[0])
    const opts = {
      now: Date.now() + 1000 * 60 * 3,
      requestId: 1,
      name: 'elasticsearch-js',
      context: null
    }
    pool.diagnostic.on(events.RESURRECT, (e, meta) => {
      t.fail('should not be called')
    })
    pool.resurrect(opts)
    t.strictEqual(pool.connections[0].deadCount, 1)
    t.true(pool.connections[0].resurrectTimeout > 0)
    t.strictEqual(pool.connections[0].status, BaseConnection.statuses.DEAD)
    t.deepEqual(pool.dead, [href])
  })

  t.test('nothing to resurrect yet', t => {
    t.plan(4)
    const pool = new ClusterConnectionPool({
      resurrectStrategy: 'ping',
      Connection: HttpConnection,
      pingTimeout: 100
    })
    const href = 'http://localhost:9200/'
    pool.addConnection(href)
    pool.markDead(pool.connections[0])
    const opts = {
      now: Date.now() - 1000 * 60 * 3,
      requestId: 1,
      name: 'elasticsearch-js',
      context: null
    }
    pool.diagnostic.on(events.RESURRECT, (e, meta) => {
      t.fail('should not be called')
    })
    pool.resurrect(opts)
    t.strictEqual(pool.connections[0].deadCount, 1)
    t.true(pool.connections[0].resurrectTimeout > 0)
    t.strictEqual(pool.connections[0].status, BaseConnection.statuses.DEAD)
    t.deepEqual(pool.dead, [href])
  })

  t.end()
})

test('getConnection', t => {
  const opts = {
    now: Date.now() + 1000 * 60 * 3,
    requestId: 1,
    name: 'elasticsearch-js',
    context: null
  }

  t.test('Should return a connection', t => {
    const pool = new ClusterConnectionPool({ Connection: HttpConnection })
    const href = 'http://localhost:9200/'
    pool.addConnection(href)
    t.ok(pool.getConnection(opts) instanceof HttpConnection)
    t.end()
  })

  t.test('filter option', t => {
    const pool = new ClusterConnectionPool({ Connection: HttpConnection })
    const href1 = 'http://localhost:9200/'
    const href2 = 'http://localhost:9200/other'
    pool.addConnection([href1, href2])

    const filter = (node: Connection): boolean => node.id === href1
    t.strictEqual(pool.getConnection({ ...opts, filter })?.id, href1)
    t.end()
  })

  t.test('filter should get Connection objects', t => {
    t.plan(2)
    const pool = new ClusterConnectionPool({ Connection: HttpConnection })
    const href1 = 'http://localhost:9200/'
    const href2 = 'http://localhost:9200/other'
    pool.addConnection([href1, href2])

    const filter = (node: Connection): boolean => {
      t.ok(node instanceof HttpConnection)
      return true
    }
    pool.getConnection({ ...opts, filter })
  })

  t.test('filter should get alive connections', t => {
    t.plan(2)
    const pool = new ClusterConnectionPool({ Connection: HttpConnection })
    const href1 = 'http://localhost:9200/'
    const href2 = 'http://localhost:9200/other'
    pool.addConnection(href1)
    pool.addConnection([href2, `${href2}/stuff`])
    pool.markDead(pool.connections[0])

    const filter = (node: Connection): boolean => {
      t.strictEqual(node.status, BaseConnection.statuses.ALIVE)
      return true
    }
    pool.getConnection({ ...opts, filter })
  })

  t.test('filter all connections', t => {
    t.plan(1)
    const pool = new ClusterConnectionPool({ Connection: HttpConnection })
    const href1 = 'http://localhost:9200/'
    const href2 = 'http://localhost:9200/other'
    pool.addConnection(href1)
    pool.addConnection(href2)

    const filter = (node: Connection): boolean => {
      return false
    }
    t.strictEqual(pool.getConnection({ ...opts, filter }), null)
  })

  t.test('selector', t => {
    t.plan(2)
    const pool = new ClusterConnectionPool({ Connection: HttpConnection })
    const href1 = 'http://localhost:9200/'
    const href2 = 'http://localhost:9200/other'
    pool.addConnection(href1)
    pool.addConnection(href2)

    const selector = (nodes: Connection[]): Connection => {
      t.strictEqual(nodes.length, 2)
      return nodes[0]
    }
    t.strictEqual(pool.getConnection({ ...opts, selector })?.id, href1)
  })

  t.test('If all connections are marked as dead, getConnection should return a dead connection', t => {
    const pool = new ClusterConnectionPool({ Connection: HttpConnection })
    const href1 = 'http://localhost:9200/'
    const href2 = 'http://localhost:9200/other'
    pool.addConnection(href1)
    pool.addConnection(href2)
    pool.markDead(pool.connections[0])
    pool.markDead(pool.connections[1])
    const conn = pool.getConnection(opts)
    t.ok(conn instanceof HttpConnection)
    t.is(conn?.status, BaseConnection.statuses.DEAD)
    t.end()
  })

  t.end()
})

test('empty should reset dead list', async t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection })
  const href = 'http://localhost:9200/'
  pool.addConnection(href)
  pool.markDead(pool.connections[0])
  t.deepEqual(pool.dead, [href])
  await pool.empty()
  t.deepEqual(pool.dead, [])
})

