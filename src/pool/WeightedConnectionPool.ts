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

import { Connection, BaseConnection, ConnectionOptions } from '../connection'
import BaseConnectionPool, { BaseConnectionPoolOptions } from './BaseConnectionPool'
import { nodeFilterFn } from '../types'

const noFilter = (): boolean => true

export interface GetConnectionOptions {
  filter?: nodeFilterFn
}

export default class WeightedConnectionPool extends BaseConnectionPool {
  index: number
  maxWeight: number
  greatestCommonDivisor: number
  currentWeight: number

  constructor (opts: BaseConnectionPoolOptions) {
    super(opts)
    // index choosen last time
    this.index = -1
    // max weight of all nodes
    this.maxWeight = 0
    // greatest common divisor of all nodes weights
    this.greatestCommonDivisor = 0
    // current weight in scheduling
    this.currentWeight = 0
  }

  /**
   * Returns a connection, even if the connection might be dead.
   *
   * @param {object} options (filter)
   * @returns {object|null} connection
   */
  getConnection (opts: GetConnectionOptions = {}): Connection | null {
    const filter = opts.filter != null ? opts.filter : noFilter
    // we should be able to find the next node in 1 array scan,
    // if we don't, it means that we are in an infinite loop
    let counter = 0
    while (counter++ < this.size) {
      // 0 <= index < size
      this.index = (this.index + 1) % this.size
      if (this.index === 0) {
        this.currentWeight = this.currentWeight - this.greatestCommonDivisor
        if (this.currentWeight <= 0) {
          this.currentWeight = this.maxWeight
          /* istanbul ignore if */
          if (this.currentWeight === 0) {
            return null
          }
        }
      }
      const connection = this.connections[this.index]
      if (connection.weight >= this.currentWeight && filter(connection)) {
        return connection
      }
    }
    return null
  }

  /**
   * Set the weight of a connection to the maximum value.
   * If sniffing is not enabled and there is only
   * one node, this method is a noop.
   *
   * @param {object} connection
   */
  markAlive (connection: Connection): this {
    if (this.size === 1 || connection.status === BaseConnection.statuses.ALIVE) return this

    connection.status = BaseConnection.statuses.ALIVE
    connection.deadCount = 0
    connection.weight = Math.round(1000 / this.size)

    this.maxWeight = Math.max(...(this.connections.map(c => c.weight)))
    this.greatestCommonDivisor = this.connections.map(c => c.weight).reduce(getGreatestCommonDivisor, 0)

    return this
  }

  /**
   * Decreases the connection weight.
   * If sniffing is not enabled and there is only
   * one node, this method is a noop.
   *
   * @param {object} connection
   */
  markDead (connection: Connection): this {
    if (this.size === 1) return this

    connection.status = BaseConnection.statuses.DEAD
    connection.deadCount++
    connection.weight -= Math.round(Math.pow(Math.log2(connection.weight), connection.deadCount))

    /* istanbul ignore if */
    if (connection.weight <= 0) connection.weight = 1

    this.maxWeight = Math.max(...(this.connections.map(c => c.weight)))
    this.greatestCommonDivisor = this.connections.map(c => c.weight).reduce(getGreatestCommonDivisor, 0)

    return this
  }

  /**
   * Empties the connection pool.
   *
   * @returns {ConnectionPool}
   */
  async empty (): Promise<void> {
    await super.empty()
    this.maxWeight = 0
    this.greatestCommonDivisor = 0
    this.index = -1
    this.currentWeight = 0
  }

  /**
   * Update the ConnectionPool with new connections.
   *
   * @param {array} array of connections
   * @returns {ConnectionPool}
   */
  update (connections: Array<Connection | ConnectionOptions>): this {
    super.update(connections)

    this.connections.forEach(connection => {
      connection.weight = Math.round(1000 / this.size)
    })
    this.maxWeight = Math.max(...(this.connections.map(c => c.weight)))
    this.greatestCommonDivisor = this.connections.map(c => c.weight).reduce(getGreatestCommonDivisor, 0)
    this.index = -1
    this.currentWeight = 0

    return this
  }
}

function getGreatestCommonDivisor (a: number, b: number): number {
  if (b === 0) return a
  return getGreatestCommonDivisor(b, a % b)
}
