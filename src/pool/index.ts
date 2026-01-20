/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import BaseConnectionPool from './BaseConnectionPool.js'
import WeightedConnectionPool from './WeightedConnectionPool.js'
import ClusterConnectionPool from './ClusterConnectionPool.js'
import CloudConnectionPool from './CloudConnectionPool.js'

export type {
  ConnectionPoolOptions,
  GetConnectionOptions
} from './BaseConnectionPool.js'

export type {
  ResurrectEvent,
  ResurrectOptions
} from './ClusterConnectionPool.js'

export {
  BaseConnectionPool,
  WeightedConnectionPool,
  ClusterConnectionPool,
  CloudConnectionPool
}
