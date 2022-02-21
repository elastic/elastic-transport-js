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

import { test } from 'tap'
import * as http from 'http'
import AbortController from 'node-abort-controller'
import {
  HttpConnection,
  UndiciConnection,
  errors,
  events
} from '../..'

import {
  TestClient,
  buildServer
} from '../utils'

const {
  TimeoutError,
  ConnectionError,
  ResponseError,
  RequestAbortedError,
  SerializationError,
  DeserializationError
} = errors

function runWithConnection (name: string, Connection: typeof HttpConnection | typeof UndiciConnection): void {
  test(`${name} connection type`, t => {
    t.test('No errors', async t => {
      t.plan(9)

      function handler (req: http.IncomingMessage, res: http.ServerResponse) {
        const body = JSON.stringify({ hello: 'world' })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.setHeader('Content-Length', body.length + '')
        res.end(body)
      }

      const [{ port }, server] = await buildServer(handler)
      const client = new TestClient({
        node: `http://localhost:${port}`,
        Connection
      })

      const order = [
        events.SERIALIZATION,
        events.REQUEST,
        events.DESERIALIZATION,
        events.RESPONSE
      ]

      client.diagnostic.on(events.SERIALIZATION, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.SERIALIZATION)
      })

      client.diagnostic.on(events.REQUEST, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.REQUEST)
      })

      client.diagnostic.on(events.DESERIALIZATION, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.DESERIALIZATION)
      })

      client.diagnostic.on(events.RESPONSE, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.RESPONSE)
      })

      await client.request({ method: 'GET', path: '/' })
      t.equal(order.length, 0)
      server.stop()
      await client.close()
    })

    t.test('Connection error', async t => {
      t.plan(10)

      const client = new TestClient({
        node: 'http://foo.bar',
        Connection,
        maxRetries: 1
      })

      const order = [
        events.SERIALIZATION,
        events.REQUEST,
        events.REQUEST,
        events.RESPONSE
      ]

      client.diagnostic.on(events.SERIALIZATION, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.SERIALIZATION)
      })

      client.diagnostic.on(events.REQUEST, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.REQUEST)
      })

      client.diagnostic.on(events.DESERIALIZATION, (_err, request) => {
        t.fail('Should not be called')
      })

      client.diagnostic.on(events.RESPONSE, (err, request) => {
        t.ok(err instanceof ConnectionError)
        t.equal(order.shift(), events.RESPONSE)
      })

      try {
        await client.request({ method: 'GET', path: '/' })
      } catch (err: any) {
        t.ok(err instanceof ConnectionError)
        t.equal(order.length, 0)
      }
      await client.close()
    })

    t.test('TimeoutError error', async t => {
      t.plan(10)

      function handler (req: http.IncomingMessage, res: http.ServerResponse) {
        const body = JSON.stringify({ hello: 'world' })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.setHeader('Content-Length', body.length + '')
        setTimeout(() => {
          res.end(body)
        }, 100)
      }

      const [{ port }, server] = await buildServer(handler)
      const client = new TestClient({
        node: `http://localhost:${port}`,
        Connection,
        maxRetries: 1,
        requestTimeout: 50
      })

      const order = [
        events.SERIALIZATION,
        events.REQUEST,
        events.REQUEST,
        events.RESPONSE
      ]

      client.diagnostic.on(events.SERIALIZATION, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.SERIALIZATION)
      })

      client.diagnostic.on(events.REQUEST, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.REQUEST)
      })

      client.diagnostic.on(events.DESERIALIZATION, (_err, request) => {
        t.fail('Should not be called')
      })

      client.diagnostic.on(events.RESPONSE, (err, request) => {
        t.ok(err instanceof TimeoutError)
        t.equal(order.shift(), events.RESPONSE)
      })

      try {
        await client.request({ method: 'GET', path: '/' })
      } catch (err: any) {
        t.ok(err instanceof TimeoutError)
        t.equal(order.length, 0)
      }
      server.close()
      await client.close()
    })

    t.test('RequestAbortedError error', async t => {
      t.plan(8)

      function handler (req: http.IncomingMessage, res: http.ServerResponse) {
        const body = JSON.stringify({ hello: 'world' })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.setHeader('Content-Length', body.length + '')
        setTimeout(() => {
          res.end(body)
        }, 100)
      }

      const [{ port }, server] = await buildServer(handler)
      const client = new TestClient({
        node: `http://localhost:${port}`,
        Connection,
        maxRetries: 1,
        requestTimeout: 50
      })

      const order = [
        events.SERIALIZATION,
        events.REQUEST,
        events.RESPONSE
      ]

      client.diagnostic.on(events.SERIALIZATION, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.SERIALIZATION)
      })

      client.diagnostic.on(events.REQUEST, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.REQUEST)
      })

      client.diagnostic.on(events.DESERIALIZATION, (_err, request) => {
        t.fail('Should not be called')
      })

      client.diagnostic.on(events.RESPONSE, (err, request) => {
        t.ok(err instanceof RequestAbortedError)
        t.equal(order.shift(), events.RESPONSE)
      })

      const abortController = new AbortController()
      setImmediate(() => abortController.abort())
      try {
        await client.request({ method: 'GET', path: '/' }, { signal: abortController.signal })
      } catch (err: any) {
        t.ok(err instanceof RequestAbortedError)
        t.equal(order.length, 0)
      }
      server.stop()
      await client.close()
    })

    t.test('ResponseError error (no retry)', async t => {
      t.plan(10)

      function handler (req: http.IncomingMessage, res: http.ServerResponse) {
        const body = JSON.stringify({ hello: 'world' })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.setHeader('Content-Length', body.length + '')
        res.statusCode = 400
        res.end(body)
      }

      const [{ port }, server] = await buildServer(handler)
      const client = new TestClient({
        node: `http://localhost:${port}`,
        Connection,
        maxRetries: 1
      })

      const order = [
        events.SERIALIZATION,
        events.REQUEST,
        events.DESERIALIZATION,
        events.RESPONSE
      ]

      client.diagnostic.on(events.SERIALIZATION, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.SERIALIZATION)
      })

      client.diagnostic.on(events.REQUEST, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.REQUEST)
      })

      client.diagnostic.on(events.DESERIALIZATION, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.DESERIALIZATION)
      })

      client.diagnostic.on(events.RESPONSE, (err, request) => {
        t.ok(err instanceof ResponseError)
        t.equal(order.shift(), events.RESPONSE)
      })

      try {
        await client.request({ method: 'GET', path: '/' })
      } catch (err: any) {
        t.ok(err instanceof ResponseError)
        t.equal(order.length, 0)
      }
      server.stop()
      await client.close()
    })

    t.test('ResponseError error (with retry)', async t => {
      t.plan(14)

      function handler (req: http.IncomingMessage, res: http.ServerResponse) {
        const body = JSON.stringify({ hello: 'world' })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.setHeader('Content-Length', body.length + '')
        res.statusCode = 504
        res.end(body)
      }

      const [{ port }, server] = await buildServer(handler)
      const client = new TestClient({
        node: `http://localhost:${port}`,
        Connection,
        maxRetries: 1
      })

      const order = [
        events.SERIALIZATION,
        events.REQUEST,
        events.DESERIALIZATION,
        events.REQUEST,
        events.DESERIALIZATION,
        events.RESPONSE
      ]

      client.diagnostic.on(events.SERIALIZATION, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.SERIALIZATION)
      })

      client.diagnostic.on(events.REQUEST, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.REQUEST)
      })

      client.diagnostic.on(events.DESERIALIZATION, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.DESERIALIZATION)
      })

      client.diagnostic.on(events.RESPONSE, (err, request) => {
        t.ok(err instanceof ResponseError)
        t.equal(order.shift(), events.RESPONSE)
      })

      try {
        await client.request({ method: 'GET', path: '/' })
      } catch (err: any) {
        t.ok(err instanceof ResponseError)
        t.equal(order.length, 0)
      }
      server.stop()
      await client.close()
    })

    t.test('Serialization Error', async t => {
      t.plan(6)

      function handler (req: http.IncomingMessage, res: http.ServerResponse) {
        const body = JSON.stringify({ hello: 'world' })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.setHeader('Content-Length', body.length + '')
        res.end(body)
      }

      const [{ port }, server] = await buildServer(handler)
      const client = new TestClient({
        node: `http://localhost:${port}`,
        Connection
      })

      const order = [
        events.SERIALIZATION,
        events.REQUEST
      ]

      client.diagnostic.on(events.SERIALIZATION, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.SERIALIZATION)
      })

      client.diagnostic.on(events.REQUEST, (err, request) => {
        t.ok(err instanceof SerializationError)
        t.equal(order.shift(), events.REQUEST)
      })

      client.diagnostic.on(events.DESERIALIZATION, (_err, request) => {
        t.fail('Should not be called')
      })

      client.diagnostic.on(events.RESPONSE, (_err, request) => {
        t.fail('Should not be called')
      })

      const body = {}
      // @ts-expect-error
      body.o = body
      try {
        await client.request({ method: 'POST', path: '/', body })
      } catch (err: any) {
        t.ok(err instanceof SerializationError)
        t.equal(order.length, 0)
      }
      server.stop()
      await client.close()
    })

    t.test('Deserialization Error', async t => {
      t.plan(10)

      function handler (req: http.IncomingMessage, res: http.ServerResponse) {
        const body = '{"hello":"wor'
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.setHeader('Content-Length', body.length + '')
        res.end(body)
      }

      const [{ port }, server] = await buildServer(handler)
      const client = new TestClient({
        node: `http://localhost:${port}`,
        Connection
      })

      const order = [
        events.SERIALIZATION,
        events.REQUEST,
        events.DESERIALIZATION,
        events.RESPONSE
      ]

      client.diagnostic.on(events.SERIALIZATION, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.SERIALIZATION)
      })

      client.diagnostic.on(events.REQUEST, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.REQUEST)
      })

      client.diagnostic.on(events.DESERIALIZATION, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.DESERIALIZATION)
      })

      client.diagnostic.on(events.RESPONSE, (err, request) => {
        t.ok(err instanceof DeserializationError)
        t.equal(order.shift(), events.RESPONSE)
      })

      try {
        await client.request({ method: 'GET', path: '/' })
      } catch (err: any) {
        t.ok(err instanceof DeserializationError)
        t.equal(order.length, 0)
      }
      server.stop()
      await client.close()
    })

    t.test('Socket destroyed while reading the body', async t => {
      t.plan(14)

      function handler (req: http.IncomingMessage, res: http.ServerResponse) {
        const body = JSON.stringify({ hello: 'world' })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.setHeader('Content-Length', body.length + '')
        res.write(body.slice(0, -5))
        setTimeout(() => {
          res.socket?.destroy()
        }, 500)
      }

      const [{ port }, server] = await buildServer(handler)
      const client = new TestClient({
        node: `http://localhost:${port}`,
        Connection,
        maxRetries: 1
      })

      const order = [
        events.SERIALIZATION,
        events.REQUEST,
        events.DESERIALIZATION,
        events.REQUEST,
        events.DESERIALIZATION,
        events.RESPONSE
      ]

      client.diagnostic.on(events.SERIALIZATION, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.SERIALIZATION)
      })

      client.diagnostic.on(events.REQUEST, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.REQUEST)
      })

      client.diagnostic.on(events.DESERIALIZATION, (err, request) => {
        t.error(err)
        t.equal(order.shift(), events.DESERIALIZATION)
      })

      client.diagnostic.on(events.RESPONSE, (err, request) => {
        t.ok(err instanceof ConnectionError)
        t.equal(order.shift(), events.RESPONSE)
      })

      try {
        await client.request({ method: 'GET', path: '/' })
      } catch (err: any) {
        t.ok(err instanceof ConnectionError)
        t.equal(order.length, 0)
      }
      server.stop()
      await client.close()
    })

    t.end()
  })
}

runWithConnection('HttpConnection', HttpConnection)
runWithConnection('UndiciConnection', UndiciConnection)
