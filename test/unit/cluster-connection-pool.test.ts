/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import {
  ClusterConnectionPool,
  ConnectionRequestParams,
  HttpConnection,
  BaseConnection,
  Connection,
  errors,
  events,
  ConnectionOptions
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
  t.equal(connection.deadCount, 1)
  t.ok(connection.resurrectTimeout > 0)
  t.same(pool.dead, [href])
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
    t.same(pool.dead, [href2, href1])
    t.end()
  }, 10)
})

test('markDead should ignore connections that no longer exists', t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection })
  pool.addConnection('http://localhost:9200/')
  const conn = pool.createConnection('http://localhost:9201')
  pool.markDead(conn)
  t.same(pool.dead, [])
  t.end()
})

test('markAlive', t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection })
  const href = 'http://localhost:9200/'
  pool.addConnection(href)
  const connection = pool.connections.find(c => c.id === href) as Connection
  pool.markDead(connection)
  pool.markAlive(connection)
  t.equal(connection.deadCount, 0)
  t.equal(connection.resurrectTimeout, 0)
  t.equal(connection.status, BaseConnection.statuses.ALIVE)
  t.same(pool.dead, [])
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
        t.same(meta, {
          strategy: 'ping',
          name: opts.name,
          request: { id: opts.requestId },
          isAlive: true,
          connection: pool.connections[0]
        })
        t.equal(pool.connections[0].deadCount, 0)
        t.equal(pool.connections[0].resurrectTimeout, 0)
        t.equal(pool.connections[0].status, BaseConnection.statuses.ALIVE)
        t.same(pool.dead, [])
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
        t.ok(err instanceof TimeoutError)
        t.same(meta, {
          strategy: 'ping',
          name: 'elasticsearch-js',
          request: { id: 1 },
          isAlive: false,
          connection: pool.connections[0]
        })
        t.equal(pool.connections[0].deadCount, 2)
        t.ok(pool.connections[0].resurrectTimeout > 0)
        t.equal(pool.connections[0].status, BaseConnection.statuses.DEAD)
        t.same(pool.dead, [href])
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
        t.same(meta, {
          strategy: 'ping',
          name: opts.name,
          request: { id: opts.requestId },
          isAlive: false,
          connection: pool.connections[0]
        })
        t.equal(pool.connections[0].deadCount, 2)
        t.ok(pool.connections[0].resurrectTimeout > 0)
        t.equal(pool.connections[0].status, BaseConnection.statuses.DEAD)
        t.same(pool.dead, [href])
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
      t.same(meta, {
        strategy: 'optimistic',
        name: opts.name,
        request: { id: opts.requestId },
        isAlive: true,
        connection: pool.connections[0]
      })
      t.equal(pool.connections[0].deadCount, 1)
      t.ok(pool.connections[0].resurrectTimeout > 0)
      t.equal(pool.connections[0].status, BaseConnection.statuses.ALIVE)
      t.same(pool.dead, [])
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
    t.equal(pool.connections[0].deadCount, 1)
    t.ok(pool.connections[0].resurrectTimeout > 0)
    t.equal(pool.connections[0].status, BaseConnection.statuses.DEAD)
    t.same(pool.dead, [href])
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
    t.equal(pool.connections[0].deadCount, 1)
    t.ok(pool.connections[0].resurrectTimeout > 0)
    t.equal(pool.connections[0].status, BaseConnection.statuses.DEAD)
    t.same(pool.dead, [href])
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

  t.test('default node filter', t => {
    const node1 = {
      url: new URL('https://node1:9200/'),
      roles: { master: true, data: false, ingest: false, ml: false }
    }
    const node2 = {
      url: new URL('https://node2:9200/'),
      roles: { master: true, data: true, ingest: false, ml: false }
    }
    const node3 = {
      url: new URL('https://node3:9200/'),
      roles: { master: true, data: false, ingest: true, ml: false }
    }
    const node4 = {
      url: new URL('https://node4:9200/'),
      roles: { master: true, data: false, ingest: false, ml: true }
    }

    const pool1 = new ClusterConnectionPool({ Connection: HttpConnection })
    pool1.addConnection([node1, node2])
    const conn1 = pool1.getConnection(opts)
    t.equal(conn1?.url.hostname, 'node2')

    const pool2 = new ClusterConnectionPool({ Connection: HttpConnection })
    pool2.addConnection([node1, node3])
    const conn2 = pool2.getConnection(opts)
    t.equal(conn2?.url.hostname, 'node3')

    const pool3 = new ClusterConnectionPool({ Connection: HttpConnection })
    pool3.addConnection([node1, node4])
    const conn3 = pool3.getConnection(opts)
    t.equal(conn3?.url.hostname, 'node4')

    t.end()
  })

  t.test('filter option', t => {
    const pool = new ClusterConnectionPool({ Connection: HttpConnection })
    const href1 = 'http://localhost:9200/'
    const href2 = 'http://localhost:9200/other'
    pool.addConnection([href1, href2])

    const filter = (node: Connection): boolean => node.id === href1
    t.equal(pool.getConnection({ ...opts, filter })?.id, href1)
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
      t.equal(node.status, BaseConnection.statuses.ALIVE)
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
    t.equal(pool.getConnection({ ...opts, filter }), null)
  })

  t.test('selector', t => {
    t.plan(2)
    const pool = new ClusterConnectionPool({ Connection: HttpConnection })
    const href1 = 'http://localhost:9200/'
    const href2 = 'http://localhost:9200/other'
    pool.addConnection(href1)
    pool.addConnection(href2)

    const selector = (nodes: Connection[]): Connection => {
      t.equal(nodes.length, 2)
      return nodes[0]
    }
    t.equal(pool.getConnection({ ...opts, selector })?.id, href1)
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
    t.equal(conn?.status, BaseConnection.statuses.DEAD)
    t.end()
  })

  t.end()
})

test('empty should reset dead list', async t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection })
  const href = 'http://localhost:9200/'
  pool.addConnection(href)
  pool.markDead(pool.connections[0])
  t.same(pool.dead, [href])
  await pool.empty()
  t.same(pool.dead, [])
})

test('round-robin selector', t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection })
  const connections = [
    { id: 'node-1', url: { href: 'http://localhost:9200' } },
    { id: 'node-2', url: { href: 'http://localhost:9201' } },
    { id: 'node-3', url: { href: 'http://localhost:9202' } }
  ]

  const results = []
  for (let i = 0; i < 9; i++) {
    const selected = pool.roundRobinSelector(connections)
    results.push(selected.id)
  }

  const expected = ['node-1', 'node-2', 'node-3', 'node-1', 'node-2', 'node-3', 'node-1', 'node-2', 'node-3']
  t.same(results, expected)
  t.end()
})

test('round-robin selector with empty connections', t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection })
  const selected = pool.roundRobinSelector([])
  t.equal(selected, null)
  t.end()
})

test('weighted round-robin selector', t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection, useWeightedRoundRobin: true })
  const connections = [
    { id: 'node-1', url: { href: 'http://localhost:9200' }, weight: 1 },
    { id: 'node-2', url: { href: 'http://localhost:9201' }, weight: 2 },
    { id: 'node-3', url: { href: 'http://localhost:9202' }, weight: 3 }
  ]

  const results = []
  for (let i = 0; i < 12; i++) {
    const selected = pool.weightedRoundRobinSelector(connections)
    results.push(selected.id)
  }

  const counts = { 'node-1': 0, 'node-2': 0, 'node-3': 0 }
  results.forEach(id => { counts[id]++ })

  t.equal(counts['node-1'], 2)
  t.equal(counts['node-2'], 4)
  t.equal(counts['node-3'], 6)
  t.end()
})

test('weighted round-robin selector with no weights', t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection, useWeightedRoundRobin: true })
  const connections = [
    { id: 'node-1', url: { href: 'http://localhost:9200' } },
    { id: 'node-2', url: { href: 'http://localhost:9201' } }
  ]

  const results = []
  for (let i = 0; i < 4; i++) {
    const selected = pool.weightedRoundRobinSelector(connections)
    results.push(selected.id)
  }

  const expected = ['node-1', 'node-2', 'node-1', 'node-2']
  t.same(results, expected)
  t.end()
})

test('weighted round-robin selector with empty connections', t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection, useWeightedRoundRobin: true })
  const selected = pool.weightedRoundRobinSelector([])
  t.equal(selected, null)
  t.end()
})

test('getConnection uses round-robin by default', t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection })
  pool.addConnection('http://localhost:9200')
  pool.addConnection('http://localhost:9201')
  pool.addConnection('http://localhost:9202')

  const results: string[] = []
  for (let i = 0; i < 6; i++) {
    const connection = pool.getConnection({
      now: Date.now(),
      requestId: `test-${i}`,
      name: 'test',
      context: {}
    })
    if (connection?.id) results.push(connection.id)
  }

  const expected = ['http://localhost:9200/', 'http://localhost:9201/', 'http://localhost:9202/', 'http://localhost:9200/', 'http://localhost:9201/', 'http://localhost:9202/']
  t.same(results, expected)
  t.end()
})

test('getConnection uses weighted round-robin when enabled', t => {
  const pool = new ClusterConnectionPool({ 
    Connection: HttpConnection, 
    useWeightedRoundRobin: true 
  })
  pool.addConnection('http://localhost:9200')
  pool.addConnection('http://localhost:9201')
  pool.addConnection('http://localhost:9202')

  pool.connections[0].weight = 1
  pool.connections[1].weight = 2
  pool.connections[2].weight = 3

  const results: string[] = []
  for (let i = 0; i < 12; i++) {
    const connection = pool.getConnection({
      now: Date.now(),
      requestId: `test-${i}`,
      name: 'test',
      context: {}
    })
    if (connection?.id) results.push(connection.id)
  }

  const counts: Record<string, number> = { 'http://localhost:9200/': 0, 'http://localhost:9201/': 0, 'http://localhost:9202/': 0 }
  results.forEach(id => { counts[id]++ })

  t.equal(counts['http://localhost:9200/'], 2)
  t.equal(counts['http://localhost:9201/'], 4)
  t.equal(counts['http://localhost:9202/'], 6)
  t.end()
})


test('round-robin continues after pool empty and re-add', async t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection })
  pool.addConnection('http://localhost:9200')
  pool.addConnection('http://localhost:9201')
  pool.addConnection('http://localhost:9202')

  pool.getConnection({
    now: Date.now(),
    requestId: 'test-1',
    name: 'test',
    context: {}
  })

  await pool.empty()
  
  pool.addConnection('http://localhost:9200')
  pool.addConnection('http://localhost:9201')
  
  const conn2 = pool.getConnection({
    now: Date.now(),
    requestId: 'test-2',
    name: 'test',
    context: {}
  })

  t.equal(conn2?.id, 'http://localhost:9200/')
  t.end()
})

test('round-robin resets after pool update', t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection })
  pool.addConnection('http://localhost:9200')
  pool.addConnection('http://localhost:9201')
  pool.addConnection('http://localhost:9202')

  pool.getConnection({ now: Date.now(), requestId: 'test-1', name: 'test', context: {} })
  pool.getConnection({ now: Date.now(), requestId: 'test-2', name: 'test', context: {} })

  const results1: string[] = []
  for (let i = 0; i < 3; i++) {
    const conn = pool.getConnection({ now: Date.now(), requestId: `test-${i}`, name: 'test', context: {} })
    if (conn?.id) results1.push(conn.id)
  }

  pool.empty()
  pool.addConnection('http://localhost:9203')
  pool.addConnection('http://localhost:9204')

  const conn = pool.getConnection({
    now: Date.now(),
    requestId: 'test-final',
    name: 'test',
    context: {}
  })

  t.equal(conn?.id, 'http://localhost:9203/')
  t.end()
})

test('custom selector overrides default round-robin', t => {
  const pool = new ClusterConnectionPool({ Connection: HttpConnection })
  pool.addConnection('http://localhost:9200')
  pool.addConnection('http://localhost:9201')
  pool.addConnection('http://localhost:9202')

  const customSelector = (connections: Connection[]) => connections[connections.length - 1]

  const connection = pool.getConnection({
    now: Date.now(),
    requestId: 'test-1',
    name: 'test',
    context: {},
    selector: customSelector
  })

  t.equal(connection?.id, 'http://localhost:9202/')
  t.end()
})

