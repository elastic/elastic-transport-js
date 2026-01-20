/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import BaseConnectionPool, {
  ConnectionPoolOptions,
  GetConnectionOptions
} from './BaseConnectionPool.js'
import { Connection, ConnectionOptions } from '../connection/index.js'

export default class CloudConnectionPool extends BaseConnectionPool {
  cloudConnection: Connection | null
  constructor (opts: ConnectionPoolOptions) {
    super(opts)
    this.cloudConnection = null
  }

  /**
   * Returns the only cloud connection.
   *
   * @returns {object} connection
   */
  getConnection (opts: GetConnectionOptions): Connection | null {
    return this.cloudConnection
  }

  /**
   * Empties the connection pool.
   *
   * @returns {ConnectionPool}
   */
  async empty (): Promise<void> {
    await super.empty()
    this.cloudConnection = null
  }

  /**
   * Update the ConnectionPool with new connections.
   *
   * @param {array} array of connections
   * @returns {ConnectionPool}
   */
  update (connections: Array<Connection | ConnectionOptions>): this {
    super.update(connections)
    this.cloudConnection = this.connections[0]
    return this
  }
}
