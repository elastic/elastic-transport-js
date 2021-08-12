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

import { URL } from 'url'
import { ConnectionOptions as TlsConnectionOptions } from 'tls'
import Debug from 'debug'
import Diagnostic from '../Diagnostic'
import { kCaFingerprint } from '../symbols'
import {
  Connection,
  ConnectionOptions,
  BaseConnection
} from '../connection'
import {
  HttpAgentOptions,
  UndiciAgentOptions,
  agentFn,
  ApiKeyAuth,
  BasicAuth,
  BearerAuth,
  nodeFilterFn,
  nodeSelectorFn
} from '../types'
import { ConfigurationError } from '../errors'

const debug = Debug('elasticsearch')

type AddConnectionOptions = string | ConnectionOptions
export interface ConnectionPoolOptions {
  ssl?: TlsConnectionOptions
  agent?: HttpAgentOptions | UndiciAgentOptions | agentFn | false
  proxy?: string | URL
  auth?: BasicAuth | ApiKeyAuth | BearerAuth
  diagnostic?: Diagnostic
  Connection: typeof BaseConnection
  pingTimeout?: number
  resurrectStrategy?: 'none' | 'ping' | 'optimistic'
  caFingerprint?: string
}

export interface GetConnectionOptions {
  filter?: nodeFilterFn
  selector?: nodeSelectorFn
  now: number
  requestId: string | number
  name: string | symbol
  context: any
}

export default class BaseConnectionPool {
  connections: Connection[]
  size: number
  Connection: typeof BaseConnection
  diagnostic: Diagnostic
  auth?: BasicAuth | ApiKeyAuth | BearerAuth
  _agent?: HttpAgentOptions | UndiciAgentOptions | agentFn | false
  _proxy?: string | URL
  _ssl?: TlsConnectionOptions
  [kCaFingerprint]?: string

  constructor (opts: ConnectionPoolOptions) {
    // list of nodes and weights
    this.connections = []
    // how many nodes we have in our scheduler
    this.size = this.connections.length
    this.Connection = opts.Connection
    this.diagnostic = opts.diagnostic ?? new Diagnostic()
    this.auth = opts.auth
    this._ssl = opts.ssl
    this._agent = opts.agent
    this._proxy = opts.proxy
    this[kCaFingerprint] = opts.caFingerprint
  }

  markAlive (connection: Connection): this {
    connection.status = BaseConnection.statuses.ALIVE
    return this
  }

  markDead (connection: Connection): this {
    connection.status = BaseConnection.statuses.DEAD
    return this
  }

  getConnection (opts: GetConnectionOptions): Connection | null {
    throw new ConfigurationError('The getConnection method should be implemented by extended classes')
  }

  /**
   * Creates a new connection instance.
   */
  createConnection (opts: string | ConnectionOptions): Connection {
    if (typeof opts === 'string') {
      opts = this.urlToHost(opts)
    }

    if (this.auth != null) {
      opts.auth = this.auth
    } else if (opts.url.username !== '' && opts.url.password !== '') {
      opts.auth = {
        username: decodeURIComponent(opts.url.username),
        password: decodeURIComponent(opts.url.password)
      }
    }

    /* istanbul ignore else */
    if (opts.ssl == null) opts.ssl = this._ssl
    /* istanbul ignore else */
    if (opts.agent == null) opts.agent = this._agent
    /* istanbul ignore else */
    if (opts.proxy == null) opts.proxy = this._proxy
    /* istanbul ignore else */
    if (opts.diagnostic == null) opts.diagnostic = this.diagnostic
    /* istanbul ignore else */
    if (opts.caFingerprint == null) opts.caFingerprint = this[kCaFingerprint]

    const connection = new this.Connection(opts)

    for (const conn of this.connections) {
      if (conn.id === connection.id) {
        throw new Error(`Connection with id '${connection.id}' is already present`)
      }
    }

    return connection
  }

  /**
   * Adds a new connection to the pool.
   *
   * @param {object|string} host
   * @returns {ConnectionPool}
   */
  addConnection (connection: AddConnectionOptions | AddConnectionOptions[]): this {
    if (Array.isArray(connection)) {
      const connections: Connection[] = []
      for (const conn of connection) {
        connections.push(this.createConnection(conn))
      }
      return this.update([...this.connections, ...connections])
    } else {
      return this.update([...this.connections, this.createConnection(connection)])
    }
  }

  /**
   * Removes a new connection to the pool.
   *
   * @param {object} connection
   * @returns {ConnectionPool}
   */
  removeConnection (connection: Connection): this {
    debug('Removing connection', connection)
    return this.update(this.connections.filter(c => c.id !== connection.id))
  }

  /**
   * Empties the connection pool.
   *
   * @returns {ConnectionPool}
   */
  async empty (): Promise<void> {
    debug('Emptying the connection pool')
    for (const connection of this.connections) {
      await connection.close()
    }
    this.connections = []
    this.size = this.connections.length
  }

  /**
   * Update the ConnectionPool with new connections.
   *
   * @param {array} array of connections
   * @returns {ConnectionPool}
   */
  update (nodes: Array<Connection | ConnectionOptions>): this {
    debug('Updating the connection pool')
    const newConnections = []
    const oldConnections = []

    for (const node of nodes) {
      // if we already have a given connection in the pool
      // we mark it as alive and we do not close the connection
      // to avoid socket issues
      const connectionById = this.connections.find(c => c.id === node.id)
      const connectionByUrl = this.connections.find(c => c.id === node.url.href)
      if (connectionById != null) {
        debug(`The connection with id '${node.id as string}' is already present`)
        this.markAlive(connectionById)
        newConnections.push(connectionById)
      // in case the user has passed a single url (or an array of urls),
      // the connection id will be the full href; to avoid closing valid connections
      // because are not present in the pool, we check also the node url,
      // and if is already present we update its id with the ES provided one.
      } else if (connectionByUrl != null) {
        connectionByUrl.id = node.id as string
        this.markAlive(connectionByUrl)
        newConnections.push(connectionByUrl)
      } else {
        newConnections.push(this.createConnection(node as ConnectionOptions))
      }
    }

    const ids = nodes.map(c => c.id)
    // remove all the dead connections and old connections
    for (const connection of this.connections) {
      if (!ids.includes(connection.id)) {
        oldConnections.push(connection)
      }
    }

    // close old connections
    for (const connection of oldConnections) {
      connection.close().catch(/* istanbul ignore next */() => {})
    }

    this.connections = newConnections
    this.size = this.connections.length

    return this
  }

  /**
   * Transforms the nodes objects to a host object.
   *
   * @param {object} nodes
   * @returns {array} hosts
   */
  nodesToHost (nodes: Record<string, any>, protocol: string): ConnectionOptions[] {
    const ids = Object.keys(nodes)
    const hosts = []

    for (let i = 0, len = ids.length; i < len; i++) {
      const node = nodes[ids[i]]
      // If there is no protocol in
      // the `publish_address` new URL will throw
      // the publish_address can have two forms:
      //   - ip:port
      //   - hostname/ip:port
      // if we encounter the second case, we should
      // use the hostname instead of the ip
      let address = node.http.publish_address as string
      const parts = address.split('/')
      // the url is in the form of hostname/ip:port
      if (parts.length > 1) {
        const hostname = parts[0]
        const port = (parts[1].match(/((?::))(?:[0-9]+)$/g) as string[])[0].slice(1)
        address = `${hostname}:${port}`
      }

      address = address.slice(0, 4) === 'http'
        /* istanbul ignore next */
        ? address
        : `${protocol}//${address}`

      hosts.push({
        url: new URL(address),
        id: ids[i]
      })
    }

    return hosts
  }

  /**
   * Transforms an url string to a host object
   *
   * @param {string} url
   * @returns {object} host
   */
  urlToHost (url: string): ConnectionOptions {
    return {
      url: new URL(url)
    }
  }
}
