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
}

runWithConnection('HttpConnection', HttpConnection)
runWithConnection('UndiciConnection', UndiciConnection)
