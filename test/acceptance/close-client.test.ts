/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import * as http from 'http'
import {
  HttpConnection,
  UndiciConnection,
  errors,
} from '../..'

import {
  TestClient,
  buildServer
} from '../utils'

function runWithConnection (name: string, Connection: typeof HttpConnection | typeof UndiciConnection): void {
  test(`Empty connection pool with ${name} connection type`, async t => {
    t.plan(2)

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

    const response = await client.request({ method: 'GET', path: '/' })
    t.same(response, { hello: 'world' })
    await client.close()
    try {
      await client.request({ method: 'GET', path: '/' })
    } catch (err: any) {
      t.ok(err instanceof errors.NoLivingConnectionsError)
    }
    server.stop()
  })

  test(`Empty connection pool with ${name} connection type won't kill in-flight requests`, async t => {
    t.plan(2)

    let client: TestClient | null = null
    let closePromise: Promise<void> | undefined = undefined

    function handler (req: http.IncomingMessage, res: http.ServerResponse) {
      const body = JSON.stringify({ hello: 'world' })
      res.setHeader('Content-Type', 'application/json;utf=8')
      res.setHeader('Content-Length', body.length + '')
      res.write('{"hello":')
      closePromise = client?.close()
      setTimeout(() => res.end('"world"}'), 100)
    }

    const [{ port }, server] = await buildServer(handler)
    client = new TestClient({
      node: `http://localhost:${port}`,
      Connection
    })

    const response = await client.request({ method: 'GET', path: '/' })
    t.same(response, { hello: 'world' })
    try {
      await client.request({ method: 'GET', path: '/' })
    } catch (err: any) {
      t.ok(err instanceof errors.NoLivingConnectionsError)
    }
    await closePromise
    server.stop()
  })

  test(`Empty connection pool with ${name} connection type and retries will fail the in-flight request`, async t => {
    t.plan(1)

    let client: TestClient | null = null
    let closePromise: Promise<void> | undefined = undefined

    function handler (req: http.IncomingMessage, res: http.ServerResponse) {
      const body = JSON.stringify({ error: true })
      res.setHeader('Content-Type', 'application/json;utf=8')
      res.setHeader('Content-Length', body.length + '')
      closePromise = client?.close()
      res.statusCode = 504
      res.end(body)
    }

    const [{ port }, server] = await buildServer(handler)
    client = new TestClient({
      node: `http://localhost:${port}`,
      Connection
    })

    try {
      await client.request({ method: 'GET', path: '/' })
      t.fail('Should throw')
    } catch (err: any) {
      t.ok(err instanceof errors.NoLivingConnectionsError)
    }
    await closePromise
    server.stop()
  })
}

runWithConnection('HttpConnection', HttpConnection)
runWithConnection('UndiciConnection', UndiciConnection)
