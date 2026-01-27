/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
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
    t.equal(req.url, '/_cluster/health')
    res.setHeader('content-type', 'application/json')
    res.setHeader('x-elastic-product', 'Elasticsearch')
    res.end(JSON.stringify({ hello: 'world' }))
  })

  const client = new TestClient({
    node: `http://${(server.address() as AddressInfo).address}:${(server.address() as AddressInfo).port}`,
    proxy: `http://${(proxy.address() as AddressInfo).address}:${(proxy.address() as AddressInfo).port}`
  })

  const response = await client.request({ path: '/_cluster/health', method: 'GET' })
  t.same(response, { hello: 'world' })

  server.close()
  proxy.close()
})

test('http-https proxy support', async t => {
  const server = await createSecureServer()
  const proxy = await createProxy()
  server.on('request', (req, res) => {
    t.equal(req.url, '/_cluster/health')
    res.setHeader('content-type', 'application/json')
    res.setHeader('x-elastic-product', 'Elasticsearch')
    res.end(JSON.stringify({ hello: 'world' }))
  })

  const client = new TestClient({
    node: `https://localhost:${(server.address() as AddressInfo).port}`,
    proxy: `http://${(proxy.address() as AddressInfo).address}:${(proxy.address() as AddressInfo).port}`
  })

  const response = await client.request({ path: '/_cluster/health', method: 'GET' })
  t.same(response, { hello: 'world' })

  server.close()
  proxy.close()
})

test('https-http proxy support', async t => {
  const server = await createServer()
  const proxy = await createSecureProxy()
  server.on('request', (req, res) => {
    t.equal(req.url, '/_cluster/health')
    res.setHeader('content-type', 'application/json')
    res.setHeader('x-elastic-product', 'Elasticsearch')
    res.end(JSON.stringify({ hello: 'world' }))
  })

  const client = new TestClient({
    node: `http://${(server.address() as AddressInfo).address}:${(server.address() as AddressInfo).port}`,
    proxy: `https://localhost:${(proxy.address() as AddressInfo).port}`
  })

  const response = await client.request({ path: '/_cluster/health', method: 'GET' })
  t.same(response, { hello: 'world' })

  server.close()
  proxy.close()
})

test('https-https proxy support', async t => {
  const server = await createSecureServer()
  const proxy = await createSecureProxy()
  server.on('request', (req, res) => {
    t.equal(req.url, '/_cluster/health')
    res.setHeader('content-type', 'application/json')
    res.setHeader('x-elastic-product', 'Elasticsearch')
    res.end(JSON.stringify({ hello: 'world' }))
  })

  const client = new TestClient({
    node: `https://localhost:${(server.address() as AddressInfo).port}`,
    proxy: `https://localhost:${(proxy.address() as AddressInfo).port}`
  })

  const response = await client.request({ path: '/_cluster/health', method: 'GET' })
  t.same(response, { hello: 'world' })

  server.close()
  proxy.close()
})

test('http basic authentication', async t => {
  const server = await createServer()
  const proxy = await createProxy()
  server.on('request', (req, res) => {
    t.equal(req.url, '/_cluster/health')
    res.setHeader('content-type', 'application/json')
    res.setHeader('x-elastic-product', 'Elasticsearch')
    res.end(JSON.stringify({ hello: 'world' }))
  })

  proxy.authenticate = (req) => req.headers['proxy-authorization'] === `Basic ${Buffer.from('hello:world').toString('base64')}`

  const client = new TestClient({
    node: `http://${(server.address() as AddressInfo).address}:${(server.address() as AddressInfo).port}`,
    proxy: `http://hello:world@${(proxy.address() as AddressInfo).address}:${(proxy.address() as AddressInfo).port}`
  })

  const response = await client.request({ path: '/_cluster/health', method: 'GET' })
  t.same(response, { hello: 'world' })

  server.close()
  proxy.close()
})

test('https basic authentication', async t => {
  const server = await createSecureServer()
  const proxy = await createProxy()
  server.on('request', (req, res) => {
    t.equal(req.url, '/_cluster/health')
    res.setHeader('content-type', 'application/json')
    res.setHeader('x-elastic-product', 'Elasticsearch')
    res.end(JSON.stringify({ hello: 'world' }))
  })

  proxy.authenticate = (req) => req.headers['proxy-authorization'] === `Basic ${Buffer.from('hello:world').toString('base64')}`

  const client = new TestClient({
    node: `https://localhost:${(server.address() as AddressInfo).port}`,
    proxy: `http://hello:world@${(proxy.address() as AddressInfo).address}:${(proxy.address() as AddressInfo).port}`
  })

  const response = await client.request({ path: '/_cluster/health', method: 'GET' })
  t.same(response, { hello: 'world' })

  server.close()
  proxy.close()
})
