/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { writeFileSync } from 'node:fs'
import { run, bench, group } from 'mitata'
import {
  Transport,
  WeightedConnectionPool,
  ClusterConnectionPool,
  CloudConnectionPool,
  HttpConnection,
  UndiciConnection
} from '../../index.js'

group('Transport#constructor - UndiciConnection', () => {
  bench('WeightedConnectionPool', () => {
    const pool = new WeightedConnectionPool({ Connection: UndiciConnection })
    pool.addConnection('http://localhost:9200')
    new Transport({ connectionPool: pool })
  })
  .gc('inner')

  bench('ClusterConnectionPool', () => {
    const pool = new ClusterConnectionPool({ Connection: UndiciConnection })
    pool.addConnection('http://localhost:9200')
    new Transport({ connectionPool: pool })
  })
  .gc('inner')

  bench('CloudConnectionPool', () => {
    const pool = new CloudConnectionPool({ Connection: UndiciConnection })
    pool.addConnection('http://localhost:9200')
    new Transport({ connectionPool: pool })
  })
  .gc('inner')
})

group('Transport#constructor - HttpConnection', () => {
  bench('WeightedConnectionPool', () => {
    const pool = new WeightedConnectionPool({ Connection: HttpConnection })
    pool.addConnection('http://localhost:9200')
    new Transport({ connectionPool: pool })
  })
  .gc('inner')

  bench('ClusterConnectionPool', () => {
    const pool = new ClusterConnectionPool({ Connection: HttpConnection })
    pool.addConnection('http://localhost:9200')
    new Transport({ connectionPool: pool })
  })
  .gc('inner')

  bench('CloudConnectionPool', () => {
    const pool = new CloudConnectionPool({ Connection: HttpConnection })
    pool.addConnection('http://localhost:9200')
    new Transport({ connectionPool: pool })
  })
  .gc('inner')
})

const { layout, benchmarks } = await run()

const output = {}

for (const benchmark of benchmarks) {
  const { group, alias } = benchmark
  const groupName = layout[group].name

  output[groupName] = output[groupName] ?? {}
  const { min, max, p25, p50, p75, p99, p999, avg, heap, gc } = benchmark.runs[0].stats
  output[groupName][alias] = { min, max, p25, p50, p75, p99, p999, avg, heap, gc }
}

writeFileSync('benchmark.json', JSON.stringify(output), 'utf8')
