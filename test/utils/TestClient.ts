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

import assert from 'assert'
import {
  Transport,
  HttpConnection,
  ClusterConnectionPool,
  CloudConnectionPool,
  Serializer,
  Diagnostic,
  TransportRequestParams,
  TransportRequestOptions,
  SniffOptions
} from '../..'

class SniffingTransport extends Transport {
  sniff (opts: SniffOptions): void {
    if (this.isSniffing === true) return
    this.isSniffing = true

    const request = {
      method: 'GET',
      path: this.sniffEndpoint ?? '/_nodes/_all/http'
    }

    this.request(request, { id: opts.requestId, meta: true })
      .then(result => {
        assert(isObject(result.body), 'The body should be an object')
        this.isSniffing = false
        const protocol = result.meta.connection?.url.protocol || /* istanbul ignore next */ 'http:'
        const hosts = this.connectionPool.nodesToHost(result.body.nodes, protocol)
        this.connectionPool.update(hosts)

        result.meta.sniff = { hosts, reason: opts.reason }
        this.diagnostic.emit('sniff', null, result)
      })
      .catch(err => {
        this.isSniffing = false
        err.meta.sniff = { hosts: [], reason: opts.reason }
        this.diagnostic.emit('sniff', err, null)
      })
  }
}

function isObject (obj: any): obj is Record<string, any> {
  return typeof obj === 'object'
}

export default class TestClient {
  diagnostic: Diagnostic
  name: string
  connectionPool: CloudConnectionPool | ClusterConnectionPool
  transport: SniffingTransport
  serializer: Serializer
  constructor (opts: any) {
    const options = Object.assign({}, {
      Connection: HttpConnection,
      Transport: SniffingTransport,
      Serializer,
      ConnectionPool: opts.cloud ? CloudConnectionPool : ClusterConnectionPool,
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
      generateRequestId: null,
      name: 'elasticsearch-js',
      auth: null,
      opaqueIdPrefix: null,
      context: null,
      proxy: null,
      enableMetaHeader: true
    }, opts)

    this.name = options.name
    this.diagnostic = new Diagnostic()
    this.serializer = new options.Serializer()
    this.connectionPool = new options.ConnectionPool({
      pingTimeout: options.pingTimeout,
      resurrectStrategy: options.resurrectStrategy,
      ssl: options.ssl,
      agent: options.agent,
      proxy: options.proxy,
      Connection: options.Connection,
      auth: options.auth,
      diagnostic: this.diagnostic,
      sniffEnabled: options.sniffInterval !== false ||
                    options.sniffOnStart !== false ||
                    options.sniffOnConnectionFault !== false
    })
    this.connectionPool.addConnection(options.node || options.nodes)
    this.transport = new options.Transport({
      diagnostic: this.diagnostic,
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

  request (params: TransportRequestParams, options?: TransportRequestOptions) {
    return this.transport.request(params, options)
  }
}
