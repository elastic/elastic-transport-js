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

import BaseConnectionPool, { BaseConnectionPoolOptions } from './BaseConnectionPool'
import { Connection, HttpConnectionOptions } from '../connection'

export default class CloudConnectionPool extends BaseConnectionPool {
  cloudConnection: Connection | null
  constructor (opts: BaseConnectionPoolOptions) {
    super(opts)
    this.cloudConnection = null
  }

  /**
   * Returns the only cloud connection.
   *
   * @returns {object} connection
   */
  getConnection (): Connection | null {
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
  update (connections: Array<Connection | HttpConnectionOptions>): this {
    super.update(connections)
    this.cloudConnection = this.connections[0]
    return this
  }
}
