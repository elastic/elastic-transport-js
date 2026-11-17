/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import assert from 'node:assert/strict'
import * as hegel from '@hegeldev/hegel'
import * as gs from '@hegeldev/hegel/generators'
import { BaseConnection, BaseConnectionPool, ClusterConnectionPool, CloudConnectionPool, WeightedConnectionPool } from '../../index.js'
import { hostname, port, ipv4 } from './gen.mjs'

const all = () => true
const getOpts = { filter: all, now: Date.now(), requestId: 1, name: 'test', context: null }
const hostUrl = gs.tuples(hostname, port).map(([h, p]) => `http://${h}:${p}/`)
const hostUrls = gs.arrays(hostUrl, { minSize: 1, maxSize: 8, unique: true })

// state machine rules shared by every pool flavor
function poolRules () {
  const pick = (tc, pool) => {
    tc.assume(pool.size > 0)
    return tc.draw(gs.sampledFrom(pool.connections))
  }
  return {
    markDead: (tc, s) => { s.pool.markDead(pick(tc, s.pool)) },
    markAlive: (tc, s) => { s.pool.markAlive(pick(tc, s.pool)) },
    addConnection: (tc, s) => {
      const url = tc.draw(hostUrl)
      tc.assume(!s.pool.connections.some(c => c.id === url))
      s.pool.addConnection(url)
    },
    removeConnection: (tc, s) => { s.pool.removeConnection(pick(tc, s.pool)) },
    getConnection: (tc, s) => {
      const conn = s.pool.getConnection(getOpts)
      if (s.pool.size > 0) assert.ok(s.pool.connections.includes(conn), 'getConnection returned a foreign or null connection')
      else assert.equal(conn, null)
    }
  }
}

const commonInvariants = {
  sizeMatches: (_tc, s) => assert.equal(s.pool.size, s.pool.connections.length),
  uniqueIds: (_tc, s) => assert.equal(new Set(s.pool.connections.map(c => c.id)).size, s.pool.size)
}

test('ClusterConnectionPool state machine', async () => await hegel.test(tc => {
  const pool = new ClusterConnectionPool({
    Connection: BaseConnection,
    resurrectStrategy: 'none',
    useWeightedRoundRobin: tc.draw(gs.booleans())
  })
  pool.addConnection(tc.draw(hostUrls))
  hegel.stateful.run(tc, {
    rules: poolRules(),
    invariants: {
      ...commonInvariants,
      deadListIsUniqueSubset: (_tc, { pool }) => {
        assert.equal(new Set(pool.dead).size, pool.dead.length)
        for (const id of pool.dead) assert.ok(pool.connections.some(c => c.id === id), `stale dead id ${id}`)
      },
      deadListMatchesStatus: (_tc, { pool }) => {
        for (const c of pool.connections) assert.equal(pool.dead.includes(c.id), c.status === 'dead', `status mismatch for ${c.id}`)
      },
      deadListSortedByTimeout: (_tc, { pool }) => {
        const timeouts = pool.dead.map(id => pool.connections.find(c => c.id === id).resurrectTimeout)
        assert.deepEqual(timeouts, [...timeouts].sort((a, b) => a - b))
      },
      getConnectionPrefersAlive: (_tc, { pool }) => {
        const conn = pool.getConnection(getOpts)
        if (pool.connections.some(c => c.status === 'alive')) assert.equal(conn?.status, 'alive')
      }
    }
  }, { pool })
}))

test('ClusterConnectionPool round robin visits every alive node evenly', async () => await hegel.test(tc => {
  const pool = new ClusterConnectionPool({ Connection: BaseConnection, resurrectStrategy: 'none' })
  const urls = tc.draw(hostUrls)
  pool.addConnection(urls)
  const rounds = tc.draw(gs.integers({ minValue: 1, maxValue: 4 }))
  const counts = new Map()
  for (let i = 0; i < urls.length * rounds; i++) {
    const id = pool.getConnection(getOpts).id
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  assert.equal(counts.size, urls.length)
  for (const n of counts.values()) assert.equal(n, rounds)
}))

test('ClusterConnectionPool weighted round robin is proportional to weight', async () => await hegel.test(tc => {
  const pool = new ClusterConnectionPool({ Connection: BaseConnection, resurrectStrategy: 'none', useWeightedRoundRobin: true })
  pool.addConnection(tc.draw(hostUrls))
  for (const c of pool.connections) c.weight = tc.draw(gs.integers({ minValue: 1, maxValue: 5 }))
  const total = pool.connections.reduce((a, c) => a + c.weight, 0)
  const counts = new Map()
  for (let i = 0; i < total; i++) {
    const id = pool.getConnection(getOpts).id
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  for (const c of pool.connections) assert.equal(counts.get(c.id), c.weight, `connection ${c.id}`)
}))

test('ClusterConnectionPool markDead backs off exponentially with a cutoff', async () => await hegel.test(tc => {
  const pool = new ClusterConnectionPool({ Connection: BaseConnection })
  pool.addConnection(tc.draw(hostUrls))
  const conn = tc.draw(gs.sampledFrom(pool.connections))
  const times = tc.draw(gs.integers({ minValue: 1, maxValue: 10 }))
  for (let i = 0; i < times; i++) {
    const before = Date.now()
    pool.markDead(conn)
    const delay = conn.resurrectTimeout - before
    const expected = 60000 * 2 ** Math.min(i, 5)
    assert.ok(delay >= expected && delay <= expected + 1000, `delay ${delay} expected ~${expected}`)
  }
  assert.equal(conn.deadCount, times)
  pool.markAlive(conn)
  assert.equal(conn.deadCount, 0)
  assert.equal(pool.dead.includes(conn.id), false)
}))

test('ClusterConnectionPool optimistic resurrection revives the earliest dead node', async () => await hegel.test(tc => {
  const pool = new ClusterConnectionPool({ Connection: BaseConnection, resurrectStrategy: 'optimistic' })
  pool.addConnection(tc.draw(hostUrls))
  const dead = tc.draw(gs.subsequences(pool.connections))
  tc.assume(dead.length > 0)
  for (const c of dead) pool.markDead(c)
  const first = pool.dead[0]
  pool.resurrect({ now: Date.now() + 61 * 60 * 1000, requestId: 1, name: 'x', context: null })
  assert.equal(pool.connections.find(c => c.id === first).status, 'alive')
  assert.equal(pool.dead.includes(first), false)
}))

test('WeightedConnectionPool state machine', { todo: 'known bug: getConnection can return null with live connections' }, async () => await hegel.test(tc => {
  const pool = new WeightedConnectionPool({ Connection: BaseConnection })
  pool.addConnection(tc.draw(hostUrls))
  hegel.stateful.run(tc, {
    rules: poolRules(),
    invariants: {
      ...commonInvariants,
      weightsPositive: (_tc, { pool }) => {
        for (const c of pool.connections) assert.ok(c.weight >= 1, `weight ${c.weight} of ${c.id}`)
      },
      maxWeightIsMax: (_tc, { pool }) => {
        if (pool.size > 0) assert.equal(pool.maxWeight, Math.max(...pool.connections.map(c => c.weight)))
      },
      gcdDividesAll: (_tc, { pool }) => {
        for (const c of pool.connections) assert.equal(c.weight % pool.greatestCommonDivisor, 0)
      }
    }
  }, { pool })
}))

test('BaseConnectionPool update keeps exactly the given nodes', async () => await hegel.test(tc => {
  const pool = new BaseConnectionPool({ Connection: BaseConnection })
  pool.addConnection(tc.draw(hostUrls))
  const next = tc.draw(hostUrls).map(u => ({ url: new URL(u), id: u }))
  pool.update(next)
  assert.deepEqual(pool.connections.map(c => c.id), next.map(n => n.id))
  assert.equal(pool.size, next.length)
}))

test('BaseConnectionPool rejects duplicate connections', async () => await hegel.test(tc => {
  const pool = new BaseConnectionPool({ Connection: BaseConnection })
  const url = tc.draw(hostUrl)
  pool.addConnection(url)
  assert.throws(() => pool.addConnection(url))
}))

test('createConnection extracts credentials from the URL', { todo: 'known bug: literal % in URL credentials throws URIError' }, async () => await hegel.test(tc => {
  const pool = new BaseConnectionPool({ Connection: BaseConnection })
  const url = new URL(tc.draw(hostUrl))
  const username = tc.draw(gs.text({ minSize: 1, maxSize: 10 }))
  const password = tc.draw(gs.text({ minSize: 1, maxSize: 10 }))
  url.username = username
  url.password = password
  const conn = pool.createConnection(url.href)
  const expected = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
  assert.equal(conn.headers.authorization, expected)
}))

test('nodesToHost maps publish_address forms to URLs', async () => await hegel.test(tc => {
  const pool = new BaseConnectionPool({ Connection: BaseConnection })
  const protocol = tc.draw(gs.sampledFrom(['http:', 'https:']))
  const entries = tc.draw(gs.arrays(gs.tuples(
    gs.text({ minSize: 1, maxSize: 8 }),
    gs.optional(gs.tuples(gs.optional(hostname), gs.oneOf(ipv4, gs.just('[::1]')), port))
  ), { maxSize: 6 }))
  const nodes = {}
  const expected = []
  for (const [id, addr] of entries) {
    if (id in nodes) continue
    if (addr === null) {
      nodes[id] = {}
      continue
    }
    const [host, ip, p] = addr
    nodes[id] = { http: { publish_address: host != null ? `${host}/${ip}:${p}` : `${ip}:${p}` } }
    expected.push({ id, host: `${host ?? ip}:${p}` })
  }
  const hosts = pool.nodesToHost(nodes, protocol)
  // Object.keys reorders integer-like ids, so compare as sets
  const byId = new Map(hosts.map(h => [h.id, h.url]))
  assert.equal(hosts.length, expected.length)
  for (const { id, host } of expected) {
    assert.equal(byId.get(id).protocol, protocol)
    assert.equal(byId.get(id).host, new URL(`${protocol}//${host}`).host)
  }
}))

test('defaultNodeFilter excludes only master-only nodes', async () => await hegel.test(tc => {
  const roles = tc.draw(gs.record({ master: gs.booleans(), data: gs.booleans(), ingest: gs.booleans(), ml: gs.booleans() }))
  const pool = new ClusterConnectionPool({ Connection: BaseConnection, resurrectStrategy: 'none' })
  pool.addConnection({ url: new URL('http://localhost:9200'), id: 'a', roles })
  const masterOnly = roles.master && !roles.data && !roles.ingest && !roles.ml
  const conn = pool.getConnection({ ...getOpts, filter: undefined })
  assert.equal(conn === null, masterOnly)
}))

test('CloudConnectionPool always returns its single connection', async () => await hegel.test(tc => {
  const pool = new CloudConnectionPool({ Connection: BaseConnection })
  const host = tc.draw(gs.text({ alphabet: 'abc', minSize: 1, maxSize: 6 }))
  pool.addConnection(`http://${host}:9200`)
  assert.equal(pool.getConnection(getOpts), pool.connections[0])
}))
