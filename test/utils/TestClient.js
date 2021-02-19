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

'use strict'

const { EventEmitter } = require('events')
const {
  Transport,
  Connection,
  ConnectionPool,
  CloudConnectionPool,
  Serializer
} = require('../../index')

const kEventEmitter = Symbol('elasticsearchjs-event-emitter')
const noop = () => {}

class SniffingTransport extends Transport {
  sniff (opts, callback = noop) {
    if (this._isSniffing === true) return
    this._isSniffing = true

    if (typeof opts === 'function') {
      callback = opts
      opts = { reason: Transport.sniffReasons.DEFAULT }
    }

    const { reason } = opts

    const request = {
      method: 'GET',
      path: this.sniffEndpoint
    }

    this.request(request, { id: opts.requestId }, (err, result) => {
      this._isSniffing = false
      if (this._sniffEnabled === true) {
        this._nextSniff = Date.now() + this.sniffInterval
      }

      if (err != null) {
        result.meta.sniff = { hosts: [], reason }
        this.emit('sniff', err, result)
        return callback(err)
      }

      const protocol = result.meta.connection.url.protocol || /* istanbul ignore next */ 'http:'
      const hosts = this.connectionPool.nodesToHost(result.body.nodes, protocol)
      this.connectionPool.update(hosts)

      result.meta.sniff = { hosts, reason }
      this.emit('sniff', null, result)
      callback(null, hosts)
    })
  }
}

class TestClient {
  constructor (opts = {}) {
    const options = Object.assign({}, {
      Connection,
      Transport: SniffingTransport,
      Serializer,
      ConnectionPool: opts.cloud ? CloudConnectionPool : ConnectionPool,
      maxRetries: 3,
      requestTimeout: 30000,
      pingTimeout: 3000,
      sniffInterval: false,
      sniffOnStart: false,
      sniffEndpoint: '_nodes/_all/http',
      sniffOnConnectionFault: false,
      resurrectStrategy: 'ping',
      suggestCompression: false,
      compression: false,
      ssl: null,
      agent: null,
      headers: {},
      nodeFilter: null,
      nodeSelector: 'round-robin',
      generateRequestId: null,
      name: 'elasticsearch-js',
      auth: null,
      opaqueIdPrefix: null,
      context: null,
      proxy: null,
      enableMetaHeader: true
    }, opts)

    this.name = options.name
    this[kEventEmitter] = new EventEmitter()
    this.serializer = new options.Serializer()
    this.connectionPool = new options.ConnectionPool({
      pingTimeout: options.pingTimeout,
      resurrectStrategy: options.resurrectStrategy,
      ssl: options.ssl,
      agent: options.agent,
      proxy: options.proxy,
      Connection: options.Connection,
      auth: options.auth,
      emit: this[kEventEmitter].emit.bind(this[kEventEmitter]),
      sniffEnabled: options.sniffInterval !== false ||
                    options.sniffOnStart !== false ||
                    options.sniffOnConnectionFault !== false
    })
    this.connectionPool.addConnection(options.node || options.nodes)
    this.transport = new options.Transport({
      emit: this[kEventEmitter].emit.bind(this[kEventEmitter]),
      connectionPool: this.connectionPool,
      serializer: this.serializer,
      maxRetries: options.maxRetries,
      requestTimeout: options.requestTimeout,
      sniffInterval: options.sniffInterval,
      sniffOnStart: options.sniffOnStart,
      sniffOnConnectionFault: options.sniffOnConnectionFault,
      sniffEndpoint: options.sniffEndpoint,
      suggestCompression: options.suggestCompression,
      compression: options.compression,
      headers: options.headers,
      nodeFilter: options.nodeFilter,
      nodeSelector: options.nodeSelector,
      generateRequestId: options.generateRequestId,
      name: options.name,
      opaqueIdPrefix: options.opaqueIdPrefix,
      context: options.context
    })
  }

  get emit () {
    return this[kEventEmitter].emit.bind(this[kEventEmitter])
  }

  get on () {
    return this[kEventEmitter].on.bind(this[kEventEmitter])
  }

  get once () {
    return this[kEventEmitter].once.bind(this[kEventEmitter])
  }

  get off () {
    return this[kEventEmitter].off.bind(this[kEventEmitter])
  }

  request (params, options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }
    if (typeof params === 'object' && params !== null && Object.keys(params).length === 0) {
      params = { method: 'GET', path: '/', querystring: null, body: null }
    }
    if (typeof params === 'function' || params == null) {
      callback = params
      params = { method: 'GET', path: '/', querystring: null, body: null }
      options = {}
    }
    params = params || { method: 'GET', path: '/', querystring: null, body: null }
    return this.transport.request(params, options, callback)
  }
}

module.exports = TestClient
