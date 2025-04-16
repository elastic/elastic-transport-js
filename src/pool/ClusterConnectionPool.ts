/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import BaseConnectionPool, {
  ConnectionPoolOptions,
  GetConnectionOptions,
  defaultNodeFilter
} from './BaseConnectionPool'
import assert from 'node:assert'
import Debug from 'debug'
import { Connection, BaseConnection, ConnectionOptions } from '../connection'
import { nodeFilterFn } from '../types'

const debug = Debug('elasticsearch')

export interface ResurrectOptions {
  now: number
  requestId: string | number
  name: string | symbol
  context: any
}

export interface ResurrectEvent {
  strategy: string
  name: string | symbol
  request: { id: string }
  isAlive: boolean
  connection: Connection
}

export default class ClusterConnectionPool extends BaseConnectionPool {
  dead: string[]
  resurrectTimeout: number
  resurrectTimeoutCutoff: number
  pingTimeout: number
  resurrectStrategy: number

  static resurrectStrategies = {
    none: 0,
    ping: 1,
    optimistic: 2
  }

  constructor (opts: ConnectionPoolOptions) {
    super(opts)

    this.dead = []
    // the resurrect timeout is 60s
    this.resurrectTimeout = 1000 * 60
    // number of consecutive failures after which
    // the timeout doesn't increase
    this.resurrectTimeoutCutoff = 5
    this.pingTimeout = opts.pingTimeout ?? 3000

    const resurrectStrategy = opts.resurrectStrategy ?? 'ping'
    this.resurrectStrategy = ClusterConnectionPool.resurrectStrategies[resurrectStrategy]
    assert(
      this.resurrectStrategy != null,
      `Invalid resurrection strategy: '${resurrectStrategy}'`
    )
  }

  /**
   * Marks a connection as 'alive'.
   * If needed removes the connection from the dead list
   * and then resets the `deadCount`.
   *
   * @param {object} connection
   */
  markAlive (connection: Connection): this {
    const { id } = connection
    debug(`Marking as 'alive' connection '${id}'`)
    const index = this.dead.indexOf(id)
    if (index > -1) this.dead.splice(index, 1)
    connection.status = BaseConnection.statuses.ALIVE
    connection.deadCount = 0
    connection.resurrectTimeout = 0
    return this
  }

  /**
   * Marks a connection as 'dead'.
   * If needed adds the connection to the dead list
   * and then increments the `deadCount`.
   *
   * @param {object} connection
   */
  markDead (connection: Connection): this {
    const { id } = connection
    debug(`Marking as 'dead' connection '${id}'`)
    if (!this.dead.includes(id)) {
      // It might happen that `markDead` is called jsut after
      // a pool update, and in such case we will add to the dead
      // list a node that no longer exist. The following check verify
      // that the connection is still part of the pool before
      // marking it as dead.
      for (let i = 0; i < this.size; i++) {
        if (this.connections[i].id === id) {
          this.dead.push(id)
          break
        }
      }
    }
    connection.status = BaseConnection.statuses.DEAD
    connection.deadCount++
    // resurrectTimeout formula:
    // `resurrectTimeout * 2 ** min(deadCount - 1, resurrectTimeoutCutoff)`
    connection.resurrectTimeout = Date.now() + this.resurrectTimeout * Math.pow(
      2, Math.min(connection.deadCount - 1, this.resurrectTimeoutCutoff)
    )

    // sort the dead list in ascending order
    // based on the resurrectTimeout
    this.dead.sort((a, b) => {
      const conn1 = this.connections.find(c => c.id === a) as Connection
      const conn2 = this.connections.find(c => c.id === b) as Connection
      return conn1.resurrectTimeout - conn2.resurrectTimeout
    })

    return this
  }

  /**
   * If enabled, tries to resurrect a connection with the given
   * resurrect strategy ('ping', 'optimistic', 'none').
   *
   * @param {object} { now, requestId }
   */
  resurrect (opts: ResurrectOptions): void {
    if (this.resurrectStrategy === 0 || this.dead.length === 0) {
      debug('Nothing to resurrect')
      return
    }

    // the dead list is sorted in ascending order based on the timeout
    // so the first element will always be the one with the smaller timeout
    const connection = this.connections.find(c => c.id === this.dead[0]) as Connection
    if (opts.now < connection.resurrectTimeout) {
      debug('Nothing to resurrect')
      return
    }

    const { id } = connection

    // ping strategy
    if (this.resurrectStrategy === 1) {
      connection.request(
        { method: 'HEAD', path: '/' },
        { timeout: this.pingTimeout, requestId: opts.requestId, name: opts.name, context: opts.context }
      )
        .then(({ statusCode }) => {
          let isAlive = true
          if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
            debug(`Resurrect: connection '${id}' is still dead`)
            this.markDead(connection)
            isAlive = false
          } else {
            debug(`Resurrect: connection '${id}' is now alive`)
            this.markAlive(connection)
          }
          this.diagnostic.emit('resurrect', null, {
            strategy: 'ping',
            name: opts.name,
            request: { id: opts.requestId },
            isAlive,
            connection
          })
        })
        .catch((err: Error) => {
          this.markDead(connection)
          this.diagnostic.emit('resurrect', err, {
            strategy: 'ping',
            name: opts.name,
            request: { id: opts.requestId },
            isAlive: false,
            connection
          })
        })
    // optimistic strategy
    } else {
      debug(`Resurrect: optimistic resurrection for connection '${id}'`)
      this.dead.splice(this.dead.indexOf(id), 1)
      connection.status = BaseConnection.statuses.ALIVE
      this.diagnostic.emit('resurrect', null, {
        strategy: 'optimistic',
        name: opts.name,
        request: { id: opts.requestId },
        isAlive: true,
        connection
      })
    }
  }

  /**
   * Returns an alive connection if present,
   * otherwise returns a dead connection.
   * By default it filters the `master` only nodes.
   * It uses the selector to choose which
   * connection return.
   *
   * @param {object} options (filter and selector)
   * @returns {object|null} connection
   */
  getConnection (opts: GetConnectionOptions): Connection | null {
    const filter: nodeFilterFn = opts.filter != null ? opts.filter : defaultNodeFilter
    const selector = opts.selector != null ? opts.selector : (c: Connection[]) => c[0]

    this.resurrect({
      now: opts.now,
      requestId: opts.requestId,
      name: opts.name,
      context: opts.context
    })

    const noAliveConnections = this.size === this.dead.length

    // TODO: can we cache this?
    const connections = []
    for (let i = 0; i < this.size; i++) {
      const connection = this.connections[i]
      if (noAliveConnections || connection.status === BaseConnection.statuses.ALIVE) {
        if (filter(connection)) {
          connections.push(connection)
        }
      }
    }

    if (connections.length === 0) return null

    return selector(connections)
  }

  /**
   * Empties the connection pool.
   *
   * @returns {ConnectionPool}
   */
  async empty (): Promise<void> {
    await super.empty()
    this.dead = []
  }

  /**
   * Update the ConnectionPool with new connections.
   *
   * @param {array} array of connections
   * @returns {ConnectionPool}
   */
  update (connections: Array<Connection | ConnectionOptions>): this {
    super.update(connections)
    this.dead = []
    return this
  }
}
