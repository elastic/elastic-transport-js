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
    const connectionPool = new WeightedConnectionPool({ Connection: UndiciConnection })
    connectionPool.addConnection('http://localhost:9200')
    new Transport({ connectionPool })
  })
  .gc('inner')

  bench('ClusterConnectionPool', () => {
    const connectionPool = new ClusterConnectionPool({ Connection: UndiciConnection })
    connectionPool.addConnection('http://localhost:9200')
    new Transport({ connectionPool })
  })
  .gc('inner')

  bench('CloudConnectionPool', () => {
    const connectionPool = new CloudConnectionPool({ Connection: UndiciConnection })
    connectionPool.addConnection('http://localhost:9200')
    new Transport({ connectionPool })
  })
  .gc('inner')
})

group('Transport#constructor - HttpConnection', () => {
  bench('WeightedConnectionPool', () => {
    const connectionPool = new WeightedConnectionPool({ Connection: HttpConnection })
    connectionPool.addConnection('http://localhost:9200')
    new Transport({ connectionPool })
  })
  .gc('inner')

  bench('ClusterConnectionPool', () => {
    const connectionPool = new ClusterConnectionPool({ Connection: HttpConnection })
    connectionPool.addConnection('http://localhost:9200')
    new Transport({ connectionPool })
  })
  .gc('inner')

  bench('CloudConnectionPool', () => {
    const connectionPool = new CloudConnectionPool({ Connection: HttpConnection })
    connectionPool.addConnection('http://localhost:9200')
    new Transport({ connectionPool })
  })
  .gc('inner')
})

const { layout, benchmarks } = await run()

const output = {}

for (const benchmark of benchmarks) {
  const { group, alias } = benchmark
  const groupName = layout[group].name

  output[groupName] = output[groupName] ?? {}
  const { p75, p99, avg } = benchmark.runs[0].stats
  output[groupName][alias] = { p75, p99, avg }
}

writeFileSync('benchmark.json', JSON.stringify(output), 'utf8')
