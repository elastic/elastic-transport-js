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

// We are using self-signed certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

import { test } from 'tap'
import { AddressInfo } from 'net'
import {
  TestClient,
  buildProxy
} from '../utils'

const {
  createProxy,
  createSecureProxy,
  createServer,
  createSecureServer
} = buildProxy

test('http-http proxy support', async t => {
  const server = await createServer()
  const proxy = await createProxy()
  server.on('request', (req, res) => {
    t.strictEqual(req.url, '/_cluster/health')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ hello: 'world' }))
  })

  const client = new TestClient({
    node: `http://${(server.address() as AddressInfo).address}:${(server.address() as AddressInfo).port}`,
    proxy: `http://${(proxy.address() as AddressInfo).address}:${(proxy.address() as AddressInfo).port}`
  })

  const response = await client.request({ path: '/_cluster/health', method: 'GET' })
  t.deepEqual(response, { hello: 'world' })

  server.close()
  proxy.close()
})

test('http-https proxy support', async t => {
  const server = await createSecureServer()
  const proxy = await createProxy()
  server.on('request', (req, res) => {
    t.strictEqual(req.url, '/_cluster/health')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ hello: 'world' }))
  })

  const client = new TestClient({
    node: `https://${(server.address() as AddressInfo).address}:${(server.address() as AddressInfo).port}`,
    proxy: `http://${(proxy.address() as AddressInfo).address}:${(proxy.address() as AddressInfo).port}`
  })

  const response = await client.request({ path: '/_cluster/health', method: 'GET' })
  t.deepEqual(response, { hello: 'world' })

  server.close()
  proxy.close()
})

test('https-http proxy support', async t => {
  const server = await createServer()
  const proxy = await createSecureProxy()
  server.on('request', (req, res) => {
    t.strictEqual(req.url, '/_cluster/health')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ hello: 'world' }))
  })

  const client = new TestClient({
    node: `http://${(server.address() as AddressInfo).address}:${(server.address() as AddressInfo).port}`,
    proxy: `https://${(proxy.address() as AddressInfo).address}:${(proxy.address() as AddressInfo).port}`
  })

  const response = await client.request({ path: '/_cluster/health', method: 'GET' })
  t.deepEqual(response, { hello: 'world' })

  server.close()
  proxy.close()
})

test('https-https proxy support', async t => {
  const server = await createSecureServer()
  const proxy = await createSecureProxy()
  server.on('request', (req, res) => {
    t.strictEqual(req.url, '/_cluster/health')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ hello: 'world' }))
  })

  const client = new TestClient({
    node: `https://${(server.address() as AddressInfo).address}:${(server.address() as AddressInfo).port}`,
    proxy: `https://${(proxy.address() as AddressInfo).address}:${(proxy.address() as AddressInfo).port}`
  })

  const response = await client.request({ path: '/_cluster/health', method: 'GET' })
  t.deepEqual(response, { hello: 'world' })

  server.close()
  proxy.close()
})

test('http basic authentication', async t => {
  const server = await createServer()
  const proxy = await createProxy()
  server.on('request', (req, res) => {
    t.strictEqual(req.url, '/_cluster/health')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ hello: 'world' }))
  })

  proxy.authenticate = function (req, fn): void {
    fn(null, req.headers['proxy-authorization'] === `Basic ${Buffer.from('hello:world').toString('base64')}`)
  }

  const client = new TestClient({
    node: `http://${(server.address() as AddressInfo).address}:${(server.address() as AddressInfo).port}`,
    proxy: `http://hello:world@${(proxy.address() as AddressInfo).address}:${(proxy.address() as AddressInfo).port}`
  })

  const response = await client.request({ path: '/_cluster/health', method: 'GET' })
  t.deepEqual(response, { hello: 'world' })

  server.close()
  proxy.close()
})

test('https basic authentication', async t => {
  const server = await createSecureServer()
  const proxy = await createProxy()
  server.on('request', (req, res) => {
    t.strictEqual(req.url, '/_cluster/health')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ hello: 'world' }))
  })

  proxy.authenticate = function (req, fn): void {
    fn(null, req.headers['proxy-authorization'] === `Basic ${Buffer.from('hello:world').toString('base64')}`)
  }

  const client = new TestClient({
    node: `https://${(server.address() as AddressInfo).address}:${(server.address() as AddressInfo).port}`,
    proxy: `http://hello:world@${(proxy.address() as AddressInfo).address}:${(proxy.address() as AddressInfo).port}`
  })

  const response = await client.request({ path: '/_cluster/health', method: 'GET' })
  t.deepEqual(response, { hello: 'world' })

  server.close()
  proxy.close()
})
