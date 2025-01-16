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

import { setTimeout } from 'node:timers/promises'
import { URL } from 'node:url'
import * as http from 'node:http'
import { Agent } from 'node:http'
import buffer from 'node:buffer'
import { gzipSync, deflateSync } from 'node:zlib'
import { Readable } from 'node:stream'
import net from "node:net";
import { test } from 'tap'
import hpagent from 'hpagent'
import intoStream from 'into-stream'
import { AbortController as LegacyAbortController } from 'node-abort-controller'
import FakeTimers from '@sinonjs/fake-timers'
import { buildServer } from '../utils'
import { HttpConnection, errors, ConnectionOptions } from '../../'

const {
  TimeoutError,
  RequestAbortedError,
  ConnectionError,
  ConfigurationError
} = errors

const options = {
  requestId: 42,
  name: 'test',
  context: null
}

const nodeKeepAliveByDefault = Number(process.versions.node.split('.')[0]) >= 19

test('Basic (http)', async t => {
  t.plan(3)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.match(req.headers, {
      'x-custom-test': /true/,
      connection: /keep-alive/
    })
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })
  const res = await connection.request({
    path: '/hello',
    method: 'GET',
    headers: {
      'X-Custom-Test': 'true'
    }
  }, options)
  t.match(res.headers, { connection: /keep-alive/ })
  t.equal(res.body, 'ok')
  server.stop()
})

test('Basic (https)', async t => {
  t.plan(3)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.match(req.headers, {
      'x-custom-test': /true/,
      connection: /keep-alive/
    })
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler, { secure: true })
  const connection = new HttpConnection({
    url: new URL(`https://localhost:${port}`)
  })
  const res = await connection.request({
    path: '/hello',
    method: 'GET',
    headers: {
      'X-Custom-Test': 'true'
    }
  }, options)
  t.match(res.headers, { connection: /keep-alive/ })
  t.equal(res.body, 'ok')
  server.stop()
})

test('Basic (https with tls agent)', async t => {
  t.plan(3)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.match(req.headers, {
      'x-custom-test': /true/,
      connection: /keep-alive/
    })
    res.end('ok')
  }

  const [{ port, key, cert }, server] = await buildServer(handler, { secure: true })
  const connection = new HttpConnection({
    url: new URL(`https://localhost:${port}`),
    tls: { key, cert }
  })
  const res = await connection.request({
    path: '/hello',
    method: 'GET',
    headers: {
      'X-Custom-Test': 'true'
    }
  }, options)
  t.match(res.headers, { connection: /keep-alive/ })
  t.equal(res.body, 'ok')
  server.stop()
})

test('Agent support', t => {
  t.test('Custom http agent', async t => {
    t.plan(5)

    function handler (req: http.IncomingMessage, res: http.ServerResponse) {
      t.match(req.headers, {
        'x-custom-test': /true/,
        connection: /keep-alive/
      })
      res.end('ok')
    }

    const [{ port }, server] = await buildServer(handler)
    const agent = new Agent({
      keepAlive: true,
      keepAliveMsecs: 1000,
      maxSockets: 42,
      maxFreeSockets: 256
    })
    const connection = new HttpConnection({
      url: new URL(`http://localhost:${port}`),
      agent: opts => {
        t.equal(opts.url.toString(), new URL(`http://localhost:${port}`).toString())
        return agent
      }
    })
    t.equal(connection.agent?.maxSockets, 42)

    const res = await connection.request({
      path: '/hello',
      method: 'GET',
      headers: {
        'X-Custom-Test': 'true'
      }
    }, options)
    t.match(res.headers, { connection: /keep-alive/ })
    t.equal(res.body, 'ok')
    server.stop()
  })

  t.test('Proxy agent (http)', t => {
    t.plan(1)

    const connection = new HttpConnection({
      url: new URL('http://localhost:9200'),
      proxy: 'http://localhost:8080'
    })

    t.ok(connection.agent instanceof hpagent.HttpProxyAgent)
  })

  t.test('Proxy agent (https)', t => {
    t.plan(1)

    const connection = new HttpConnection({
      url: new URL('https://localhost:9200'),
      proxy: 'http://localhost:8080'
    })

    t.ok(connection.agent instanceof hpagent.HttpsProxyAgent)
  })

  t.test('Throw if detects undici agent options', async t => {
    t.plan(1)

    try {
      new HttpConnection({
        url: new URL('http://localhost:9200'),
        agent: {
          connections: 42
        }
      })
    } catch (err: any) {
      t.ok(err instanceof ConfigurationError, `Not a ConfigurationError: ${err}`)
    }
  })

  t.end()
})

test('Disable keep alive', async t => {
  t.plan(2)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.match(req.headers, {
      'x-custom-test': /true/,
      connection: /close/
    })
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler)
  const agent = nodeKeepAliveByDefault
    ? new http.Agent({ keepAlive: false })
    : false
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`),
    agent
  })
  const res = await connection.request({
    path: '/hello',
    method: 'GET',
    headers: {
      'X-Custom-Test': 'true'
    }
  }, options)
  t.match(res.headers, { connection: /close/ })
  if (agent) {
    agent.destroy()
  }
  server.stop()
})

test('Timeout support', t => {
  t.test('Timeout support / 1', async t => {
    t.plan(1)

    const clock = FakeTimers.install({ toFake: ['setTimeout'] })
    t.teardown(() => clock.uninstall())

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      setTimeout(100).then(() => res.end('ok'))
      clock.tick(50)
    }

    const [{ port }, server] = await buildServer(handler)
    const connection = new HttpConnection({
      url: new URL(`http://localhost:${port}`),
      timeout: 50
    })

    try {
      await connection.request({
        path: '/hello',
        method: 'GET'
      }, options)
    } catch (err: any) {
      t.ok(err instanceof TimeoutError, `Not a TimeoutError: ${err}`)
    }
    server.stop()
  })

  t.test('Timeout support / 2', async t => {
    t.plan(1)

    const clock = FakeTimers.install({ toFake: ['setTimeout'] })
    t.teardown(() => clock.uninstall())

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      setTimeout(100).then(() => res.end('ok'))
      clock.tick(50)
    }

    const [{ port }, server] = await buildServer(handler)
    const connection = new HttpConnection({
      url: new URL(`http://localhost:${port}`)
    })

    try {
      await connection.request({
        path: '/hello',
        method: 'GET'
      }, {
          timeout: 50,
          ...options
        })
    } catch (err: any) {
      t.ok(err instanceof TimeoutError, `Not a TimeoutError: ${err}`)
    }
    server.stop()
  })

  t.test('Timeout support / 3', async t => {
    t.plan(1)

    const clock = FakeTimers.install({ toFake: ['setTimeout'] })
    t.teardown(() => clock.uninstall())

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      setTimeout(100).then(() => res.end('ok'))
      clock.tick(50)
    }

    const [{ port }, server] = await buildServer(handler)
    const connection = new HttpConnection({
      url: new URL(`http://localhost:${port}`),
      timeout: 1000
    })

    try {
      await connection.request({
        path: '/hello',
        method: 'GET'
      }, {
          timeout: 50,
          ...options
        })
    } catch (err: any) {
      t.ok(err instanceof TimeoutError, `Not a TimeoutError: ${err}`)
    }
    server.stop()
  })

  t.test('No default timeout', async t => {
    t.plan(2)

    const clock = FakeTimers.install({ toFake: ['setTimeout'] })
    t.teardown(() => clock.uninstall())

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      setTimeout(1000 * 60 * 60).then(() => res.end('ok'))
      clock.tick(1000 * 60 * 60)
    }

    const [{ port }, server] = await buildServer(handler)
    const connection = new HttpConnection({
      url: new URL(`http://localhost:${port}`)
    })

    try {
      const res = await connection.request({
        path: '/hello',
        method: 'GET'
      }, options)
      t.equal(res.body, 'ok')
      t.ok('Request did not time out')
    } catch (err: any) {
      t.fail('No error should be thrown', err.message)
    }
    server.stop()
  })

  t.end()
})

test('Should concatenate the querystring', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.equal(req.url, '/hello?hello=world&you_know=for%20search')
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })

  await connection.request({
    path: '/hello',
    method: 'GET',
    querystring: 'hello=world&you_know=for%20search'
  }, options)
  server.stop()
})

test('Body request', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    let payload = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { payload += chunk })
    req.on('error', t.fail)
    req.on('end', () => {
      t.equal(payload, 'hello')
      res.end('ok')
    })
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })

  await connection.request({
    path: '/hello',
    method: 'POST',
    body: 'hello'
  }, options)
  server.stop()
})

test('Send body as buffer', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    let payload = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { payload += chunk })
    req.on('error', t.fail)
    req.on('end', () => {
      t.equal(payload, 'hello')
      res.end('ok')
    })
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })

  await connection.request({
    path: '/hello',
    method: 'POST',
    body: Buffer.from('hello')
  }, options)
  server.stop()
})

test('Send body as stream', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    let payload = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { payload += chunk })
    req.on('error', t.fail)
    req.on('end', () => {
      t.equal(payload, 'hello')
      res.end('ok')
    })
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })

  await connection.request({
    path: '/hello',
    method: 'POST',
    // @ts-ignore
    body: intoStream('hello')
  }, options)
  server.stop()
})

test('Should not close a connection if there are open requests', async t => {
  t.plan(1)

  const clock = FakeTimers.install({ toFake: ['setTimeout'] })
  t.teardown(() => clock.uninstall())

  function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    setTimeout(100).then(() => res.end('ok'))
    clock.tick(100)
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })

  setImmediate(() => connection.close())
  const res = await connection.request({
    path: '/hello',
    method: 'GET'
  }, options)
  t.equal(res.body, 'ok')

  server.stop()
})

test('Url with auth', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.equal(req.headers.authorization, 'Basic Zm9vOmJhcg==')
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`),
    auth: { username: 'foo', password: 'bar' }
  })

  await connection.request({
    path: '/hello',
    method: 'GET'
  }, options)

  server.stop()
})

test('Url with querystring', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.equal(req.url, '/hello?foo=bar&baz=faz')
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}?foo=bar`)
  })

  await connection.request({
    path: '/hello',
    method: 'GET',
    querystring: 'baz=faz'
  }, options)

  server.stop()
})

test('Custom headers for connection', async t => {
  t.plan(2)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.match(req.headers, {
      'x-custom-test': /true/,
      'x-foo': /bar/
    })
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`),
    headers: { 'x-foo': 'bar' }
  })

  await connection.request({
    path: '/hello',
    method: 'GET',
    headers: {
      'X-Custom-Test': 'true'
    }
  }, options)

  // should not update the default
  t.same(connection.headers, { 'x-foo': 'bar' })
  server.stop()
})

test('Ipv6 support', t => {
  const connection = new HttpConnection({
    url: new URL('http://[::1]:9200')
  })
  t.equal(connection.buildRequestObject({ method: 'GET', path: '/' }, options).hostname, '::1')
  t.end()
})

// https://github.com/nodejs/node/commit/b961d9fd83
test('Should disallow two-byte characters in URL path', async t => {
  t.plan(1)

  const connection = new HttpConnection({
    url: new URL('http://localhost:9200')
  })
  try {
    await connection.request({
      path: '/thisisinvalid\uffe2',
      method: 'GET'
    }, options)
  } catch (err: any) {
    t.equal(
      err.message,
      'ERR_UNESCAPED_CHARACTERS: /thisisinvalid\uffe2'
    )
  }
})

// https://github.com/elastic/elasticsearch-js/issues/843
test('Port handling', t => {
  t.test('http 80', t => {
    const connection = new HttpConnection({
      url: new URL('http://localhost:80')
    })

    t.equal(
      connection.buildRequestObject({ method: 'GET', path: '/' }, options).port,
      undefined
    )

    t.end()
  })

  t.test('https 443', t => {
    const connection = new HttpConnection({
      url: new URL('https://localhost:443')
    })

    t.equal(
      connection.buildRequestObject({ method: 'GET', path: '/' }, options).port,
      undefined
    )

    t.end()
  })

  t.end()
})

test('Abort request', t => {
  t.test('Abort a request syncronously', async t => {
    t.plan(1)

    function handler (_req: http.IncomingMessage, _res: http.ServerResponse) {
      t.fail('The server should not be contacted')
    }

    const [{ port }, server] = await buildServer(handler)
    const connection = new HttpConnection({
      url: new URL(`http://localhost:${port}`),
      headers: { 'x-foo': 'bar' }
    })

    const controller = new AbortController()
    connection.request(
      { path: '/hello', method: 'GET' },
      { signal: controller.signal, ...options })
      .catch(err => {
        t.ok(err instanceof RequestAbortedError, `Not a RequestAbortedError: ${err}`)
        server.stop()
      })

    controller.abort()
    await connection.close()
  })

  t.test('Abort a request asyncronously', async t => {
    t.plan(1)

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      // might be called or not
      res.end('ok')
    }

    const [{ port }, server] = await buildServer(handler)
    const connection = new HttpConnection({
      url: new URL(`http://localhost:${port}`),
      headers: { 'x-foo': 'bar' }
    })

    const controller = new AbortController()
    setImmediate(() => controller.abort())
    try {
      await connection.request({
        path: '/hello',
        method: 'GET'
      }, {
        signal: controller.signal,
        ...options
      })
    } catch (err: any) {
      t.ok(err instanceof RequestAbortedError, `Not a RequestAbortedError: ${err}`)
    }

    await connection.close()
    server.stop()
  })

  t.test('Abort with a slow body', async t => {
    t.plan(1)

    const clock = FakeTimers.install({ toFake: ['setTimeout'] })
    t.teardown(() => clock.uninstall())

    const controller = new AbortController()
    const connection = new HttpConnection({
      url: new URL('https://localhost:9200'),
    })

    const slowBody = new Readable({
      read (_size: number) {
        setTimeout(1000, { ref: false }).then(() => {
          this.push('{"size":1, "query":{"match_all":{}}}')
          this.push(null) // EOF
        })
        clock.tick(1000)
      }
    })

    setImmediate(() => controller.abort())
    try {
      await connection.request({
        method: 'GET',
        path: '/',
        // @ts-ignore
        body: slowBody
      }, {
        signal: controller.signal,
        ...options
      })
    } catch (err: any) {
      t.ok(err instanceof RequestAbortedError, `Not a RequestAbortedError: ${err}`)
    }
  })

  t.test('Cleanup abort listener', async t => {
    t.plan(2)

    // uses legacy node-abort-controller polyfill package because the global
    // AbortController's signal does not let expose an `eventEmitter` property for
    // us to inspect, but the legacy package does!
    const controller = new LegacyAbortController()

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      // @ts-expect-error
      t.equal(controller.signal.eventEmitter.listeners('abort').length, 1)
      res.end('ok')
    }

    const [{ port }, server] = await buildServer(handler)
    const connection = new HttpConnection({
      url: new URL(`http://localhost:${port}`)
    })

    await connection.request({
      path: '/hello',
      method: 'GET',
    }, {
      ...options,
      signal: controller.signal as AbortSignal
    })
    // @ts-expect-error
    t.equal(controller.signal.eventEmitter.listeners('abort').length, 0)
    server.stop()
  })

  t.end()
})

test('Should correctly resolve request path / 1', t => {
  t.plan(1)

  const connection = new HttpConnection({
    url: new URL('http://localhost:80/test')
  })

  t.equal(
    connection.buildRequestObject({
      method: 'GET',
      path: 'hello'
    }, options).path,
    '/test/hello'
  )
})

test('Should correctly resolve request path / 2', t => {
  t.plan(1)

  const connection = new HttpConnection({
    url: new URL('http://localhost:80/test/')
  })

  t.equal(
    connection.buildRequestObject({
      method: 'GET',
      path: 'hello'
    }, options).path,
    '/test/hello'
  )
})

test('Content length', t => {
  // The nodejs http agent will try to wait for the whole
  // body to arrive before closing the request, so this
  // test might take some time.
  t.test('Bad content length', async t => {
    t.plan(2)

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      const body = JSON.stringify({ hello: 'world' })
      res.setHeader('Content-Type', 'application/json;utf=8')
      res.setHeader('Content-Length', body.length + '')
      res.end(body.slice(0, -5))
    }

    const [{ port }, server] = await buildServer(handler)
    const connection = new HttpConnection({
      url: new URL(`http://localhost:${port}`)
    })
    try {
      await connection.request({
        path: '/hello',
        method: 'GET'
      }, options)
    } catch (err: any) {
      t.ok(err instanceof ConnectionError, `Not a ConnectionError: ${err}`)
      t.equal(err.message, 'Response aborted while reading the body')
    }
    server.stop()
  })

  t.test('Content length too big (buffer)', async t => {
    t.plan(3)

    class MyConnection extends HttpConnection {
      constructor (opts: ConnectionOptions) {
        super(opts)
        // @ts-expect-error
        this.makeRequest = () => {
          const stream = intoStream(JSON.stringify({ hello: 'world' }))
          // @ts-expect-error
          stream.statusCode = 200
          // @ts-expect-error
          stream.headers = {
            'content-type': 'application/json;utf=8',
            'content-encoding': 'gzip',
            'content-length': buffer.constants.MAX_LENGTH + 10,
            connection: 'keep-alive',
            date: new Date().toISOString()
          }
          stream.on('close', () => t.pass('Stream destroyed'))
          return {
            abort () {},
            removeListener () {},
            setNoDelay () {},
            end () {},
            on (event: string, cb: () => void) {
              if (event === 'response') {
                process.nextTick(cb, stream)
              }
            }
          }
        }
      }
    }

    const connection = new MyConnection({
      url: new URL('http://localhost:9200')
    })

    try {
      await connection.request({
        method: 'GET',
        path: '/'
      }, options)
    } catch (err: any) {
      t.ok(err instanceof RequestAbortedError, `Not a RequestAbortedError: ${err}`)
      t.equal(err.message, `The content length (${buffer.constants.MAX_LENGTH + 10}) is bigger than the maximum allowed buffer (${buffer.constants.MAX_LENGTH})`)
    }
  })

  t.test('Content length too big (string)', async t => {
    t.plan(3)

    class MyConnection extends HttpConnection {
      constructor (opts: ConnectionOptions) {
        super(opts)
        // @ts-expect-error
        this.makeRequest = () => {
          const stream = intoStream(JSON.stringify({ hello: 'world' }))
          // @ts-expect-error
          stream.statusCode = 200
          // @ts-expect-error
          stream.headers = {
            'content-type': 'application/json;utf=8',
            'content-encoding': 'gzip',
            'content-length': buffer.constants.MAX_STRING_LENGTH + 10,
            connection: 'keep-alive',
            date: new Date().toISOString()
          }
          stream.on('close', () => t.pass('Stream destroyed'))
          return {
            abort () {},
            removeListener () {},
            setNoDelay () {},
            end () {},
            on (event: string, cb: () => void) {
              if (event === 'response') {
                process.nextTick(cb, stream)
              }
            }
          }
        }
      }
    }

    const connection = new MyConnection({
      url: new URL('http://localhost:9200')
    })

    try {
      await connection.request({
        method: 'GET',
        path: '/'
      }, options)
    } catch (err: any) {
      t.ok(err instanceof RequestAbortedError, `Not a RequestAbortedError: ${err}`)
      t.equal(err.message, `The content length (${buffer.constants.MAX_STRING_LENGTH + 10}) is bigger than the maximum allowed string (${buffer.constants.MAX_STRING_LENGTH})`)
    }
  })

  t.test('Content length too big custom option (buffer)', async t => {
    t.plan(3)

    class MyConnection extends HttpConnection {
      constructor (opts: ConnectionOptions) {
        super(opts)
        // @ts-expect-error
        this.makeRequest = () => {
          const stream = intoStream(JSON.stringify({ hello: 'world' }))
          // @ts-expect-error
          stream.statusCode = 200
          // @ts-expect-error
          stream.headers = {
            'content-type': 'application/json;utf=8',
            'content-encoding': 'gzip',
            'content-length': 1100,
            connection: 'keep-alive',
            date: new Date().toISOString()
          }
          stream.on('close', () => t.pass('Stream destroyed'))
          return {
            abort () {},
            removeListener () {},
            setNoDelay () {},
            end () {},
            on (event: string, cb: () => void) {
              if (event === 'response') {
                process.nextTick(cb, stream)
              }
            }
          }
        }
      }
    }

    const connection = new MyConnection({
      url: new URL('http://localhost:9200')
    })

    try {
      await connection.request({
        method: 'GET',
        path: '/'
      }, { ...options, maxCompressedResponseSize: 1000 })
    } catch (err: any) {
      t.ok(err instanceof RequestAbortedError, `Not a RequestAbortedError: ${err}`)
      t.equal(err.message, 'The content length (1100) is bigger than the maximum allowed buffer (1000)')
    }
  })

  t.test('Content length too big custom option (string)', async t => {
    t.plan(3)

    class MyConnection extends HttpConnection {
      constructor (opts: ConnectionOptions) {
        super(opts)
        // @ts-expect-error
        this.makeRequest = () => {
          const stream = intoStream(JSON.stringify({ hello: 'world' }))
          // @ts-expect-error
          stream.statusCode = 200
          // @ts-expect-error
          stream.headers = {
            'content-type': 'application/json;utf=8',
            'content-encoding': 'gzip',
            'content-length': 1100,
            connection: 'keep-alive',
            date: new Date().toISOString()
          }
          stream.on('close', () => t.pass('Stream destroyed'))
          return {
            abort () {},
            removeListener () {},
            setNoDelay () {},
            end () {},
            on (event: string, cb: () => void) {
              if (event === 'response') {
                process.nextTick(cb, stream)
              }
            }
          }
        }
      }
    }

    const connection = new MyConnection({
      url: new URL('http://localhost:9200')
    })

    try {
      await connection.request({
        method: 'GET',
        path: '/'
      }, { ...options, maxResponseSize: 1000 })
    } catch (err: any) {
      t.ok(err instanceof RequestAbortedError, `Not a RequestAbortedError: ${err}`)
      t.equal(err.message, 'The content length (1100) is bigger than the maximum allowed string (1000)')
    }
  })

  t.end()
})

test('Socket destroyed while reading the body', async t => {
  t.plan(2)

  const clock = FakeTimers.install({ toFake: ['setTimeout'] })
  t.teardown(() => clock.uninstall())

  async function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    const body = JSON.stringify({ hello: 'world' })
    res.setHeader('Content-Type', 'application/json;utf=8')
    res.setHeader('Content-Length', body.length + '')
    res.write(body.slice(0, -5))
    setTimeout(500).then(() => res.socket?.destroy())
    clock.tick(500)
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })
  try {
    await connection.request({
      path: '/hello',
      method: 'GET'
    }, options)
  } catch (err: any) {
    t.ok(err instanceof ConnectionError, `Not a ConnectionError: ${err}`)
    t.equal(err.message, 'Response aborted while reading the body')
  }
  server.stop()
})

test('Compressed response should return a buffer as body (gzip)', async t => {
  t.plan(2)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.match(req.headers, {
      'accept-encoding': /gzip,deflate/
    })

    const body = gzipSync(JSON.stringify({ hello: 'world' }))
    res.setHeader('Content-Type', 'application/json;utf=8')
    res.setHeader('Content-Encoding', 'gzip')
    res.setHeader('Content-Length', Buffer.byteLength(body))
    res.end(body)
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })
  const res = await connection.request({
    path: '/hello',
    method: 'GET',
    headers: {
      'accept-encoding': 'gzip,deflate'
    }
  }, options)
  t.ok(res.body instanceof Buffer)
  server.stop()
})

test('Compressed response should return a buffer as body (deflate)', async t => {
  t.plan(2)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.match(req.headers, {
      'accept-encoding': /gzip,deflate/
    })

    const body = deflateSync(JSON.stringify({ hello: 'world' }))
    res.setHeader('Content-Type', 'application/json;utf=8')
    res.setHeader('Content-Encoding', 'deflate')
    res.setHeader('Content-Length', Buffer.byteLength(body))
    res.end(body)
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })
  const res = await connection.request({
    path: '/hello',
    method: 'GET',
    headers: {
      'accept-encoding': 'gzip,deflate'
    }
  }, options)
  t.ok(res.body instanceof Buffer)
  server.stop()
})

test('Body too big custom option (string)', async t => {
  t.plan(2)

  function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, {
      'content-type': 'application/json;utf=8',
      'transfer-encoding': 'chunked'
    })
    res.write('{"hello":')
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })

  try {
    await connection.request({
      method: 'GET',
      path: '/'
    }, { ...options, maxResponseSize: 1 })
    t.fail('Should throw')
  } catch (err: any) {
    t.ok(err instanceof RequestAbortedError, `Not a RequestAbortedError: ${err}`)
    t.equal(err.message, 'The content length (9) is bigger than the maximum allowed string (1)')
  }

  server.stop()
})

test('Body too big custom option (buffer)', async t => {
  t.plan(2)

  function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, {
      'content-type': 'application/json;utf=8',
      'content-encoding': 'gzip',
      'transfer-encoding': 'chunked'
    })
    res.write(gzipSync('{"hello":'))
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })

  try {
    await connection.request({
      method: 'GET',
      path: '/'
    }, { ...options, maxCompressedResponseSize: 1 })
    t.fail('Should throw')
  } catch (err: any) {
    t.ok(err instanceof RequestAbortedError, `Not a RequestAbortedError ${err}`)
    t.equal(err.message, 'The content length (29) is bigger than the maximum allowed buffer (1)')
  }

  server.stop()
})

test('Connection error', async t => {
  t.plan(1)

  const connection = new HttpConnection({
    url: new URL('http://foo.bar')
  })

  try {
    await connection.request({
      path: '/',
      method: 'GET'
    }, options)
  } catch (err: any) {
    t.ok(err instanceof ConnectionError, `Not a ConnectionError: ${err}`)
  }
})

test('Support mapbox vector tile', async t => {
  t.plan(1)

  const mvtContent = 'GoMCCgRtZXRhEikSFAAAAQACAQMBBAAFAgYDBwAIBAkAGAMiDwkAgEAagEAAAP8//z8ADxoOX3NoYXJkcy5mYWlsZWQaD19zaGFyZHMuc2tpcHBlZBoSX3NoYXJkcy5zdWNjZXNzZnVsGg1fc2hhcmRzLnRvdGFsGhlhZ2dyZWdhdGlvbnMuX2NvdW50LmNvdW50GhdhZ2dyZWdhdGlvbnMuX2NvdW50LnN1bRoTaGl0cy50b3RhbC5yZWxhdGlvbhoQaGl0cy50b3RhbC52YWx1ZRoJdGltZWRfb3V0GgR0b29rIgIwACICMAIiCRkAAAAAAAAAACIECgJlcSICOAAogCB4Ag=='

  function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    res.setHeader('Content-Type', 'application/vnd.mapbox-vector-tile')
    res.end(Buffer.from(mvtContent, 'base64'))
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })
  const res = await connection.request({
    path: '/_mvt',
    method: 'GET',
  }, options)
  t.equal(res.body.toString('base64'), Buffer.from(mvtContent, 'base64').toString('base64'))
  server.stop()
})

test('Support Apache Arrow', async t => {
  t.plan(1)

  const binaryContent = '/////zABAAAQAAAAAAAKAA4ABgANAAgACgAAAAAABAAQAAAAAAEKAAwAAAAIAAQACgAAAAgAAAAIAAAAAAAAAAIAAAB8AAAABAAAAJ7///8UAAAARAAAAEQAAAAAAAoBRAAAAAEAAAAEAAAAjP///wgAAAAQAAAABAAAAGRhdGUAAAAADAAAAGVsYXN0aWM6dHlwZQAAAAAAAAAAgv///wAAAQAEAAAAZGF0ZQAAEgAYABQAEwASAAwAAAAIAAQAEgAAABQAAABMAAAAVAAAAAAAAwFUAAAAAQAAAAwAAAAIAAwACAAEAAgAAAAIAAAAEAAAAAYAAABkb3VibGUAAAwAAABlbGFzdGljOnR5cGUAAAAAAAAAAAAABgAIAAYABgAAAAAAAgAGAAAAYW1vdW50AAAAAAAA/////7gAAAAUAAAAAAAAAAwAFgAOABUAEAAEAAwAAABgAAAAAAAAAAAABAAQAAAAAAMKABgADAAIAAQACgAAABQAAABYAAAABQAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAQAAAAAAAAAIAAAAAAAAACgAAAAAAAAAMAAAAAAAAAABAAAAAAAAADgAAAAAAAAAKAAAAAAAAAAAAAAAAgAAAAUAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAHwAAAAAAAAAAAACgmZkTQAAAAGBmZiBAAAAAAAAAL0AAAADAzMwjQAAAAMDMzCtAHwAAAAAAAADV6yywkgEAANWPBquSAQAA1TPgpZIBAADV17mgkgEAANV7k5uSAQAA/////wAAAAA='

  function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    res.setHeader('Content-Type', 'application/vnd.apache.arrow.stream')
    res.end(Buffer.from(binaryContent, 'base64'))
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })
  const res = await connection.request({
    path: '/_query',
    method: 'POST',
  }, options)
  t.equal(res.body.toString('base64'), Buffer.from(binaryContent, 'base64').toString('base64'))
  server.stop()
})

test('CA fingerprint check', t => {
  t.test('Check server fingerprint (success)', async t => {
    t.plan(1)

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      res.end('ok')
    }

    const [{ port, caFingerprint }, server] = await buildServer(handler, { secure: true })
    const connection = new HttpConnection({
      url: new URL(`https://localhost:${port}`),
      caFingerprint
    })
    const res = await connection.request({
      path: '/hello',
      method: 'GET'
    }, options)
    t.equal(res.body, 'ok')
    server.stop()
  })

  t.test('Check server fingerprint (different formats)', async t => {
    t.plan(1)

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      res.end('ok')
    }

    const [{ port, caFingerprint }, server] = await buildServer(handler, { secure: true })

    let newCaFingerprint = caFingerprint.toLowerCase().replace(/:/g, '')

    const connection = new HttpConnection({
      url: new URL(`https://localhost:${port}`),
      caFingerprint: newCaFingerprint,
    })
    const res = await connection.request({
      path: '/hello',
      method: 'GET'
    }, options)
    t.equal(res.body, 'ok')
    server.stop()
  })

  t.test('Check server fingerprint (failure)', async t => {
    t.plan(2)

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      res.end('ok')
    }

    const [{ port }, server] = await buildServer(handler, { secure: true })
    const connection = new HttpConnection({
      url: new URL(`https://localhost:${port}`),
      caFingerprint: 'FO:OB:AR'
    })
    try {
      await connection.request({
        path: '/hello',
        method: 'GET'
      }, options)
      t.fail('Should throw')
    } catch (err: any) {
      t.ok(err instanceof ConnectionError, `Not a ConnectionError: ${err}`)
      t.equal(err.message, 'Server certificate CA fingerprint does not match the value configured in caFingerprint')
    }
    server.stop()
  })

  t.end()
})

test('Should show local/remote socket address in case of ECONNRESET', async t => {
  t.plan(2)

  function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    res.destroy()
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })
  try {
    await connection.request({
      path: '/hello',
      method: 'GET'
    }, options)
    t.fail('should throw')
  } catch (err: any) {
    t.ok(err instanceof ConnectionError, `Not a ConnectionError: ${err}`)
    if (err.message.includes('::1')) {
      t.match(err.message, /socket\shang\sup\s-\sLocal:\s::1:\d+,\sRemote:\s::1:\d+/)
    } else {
      t.match(err.message, /socket\shang\sup\s-\sLocal:\s127.0.0.1:\d+,\sRemote:\s127.0.0.1:\d+/)
    }
  }
  server.stop()
})

test('Should decrease the request count if a request never sent', async t => {
  t.plan(2)

  const connection = new HttpConnection({
    url: new URL('http://localhost:9200')
  })
  try {
    await connection.request({
      path: '/hello',
      method: 'GET',
      headers: {
        // bad header for node.js core http.request
        'X-Custom-Test': undefined
      }
    }, options)
    t.fail('Should throw')
  } catch (err: any) {
    t.ok(err)
  }
  t.equal(connection._openRequests, 0)
})

test('as stream', async t => {
  t.plan(2)

  function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })
  const res = await connection.request({
    path: '/',
    method: 'GET'
  }, {
    asStream: true,
    requestId: 42,
    name: 'test',
    context: null
  })
  t.ok(res.body instanceof Readable)
  res.body.setEncoding('utf8')
  let payload = ''
  for await (const chunk of res.body) {
    payload += chunk
  }
  t.equal(payload, 'ok')
  server.stop()
})

test('Handles malformed HTML responses (HEAD response with body)', async t => {
  t.plan(2)

  // Creating a custom TCP server because `http.createServer` handles
  // the method accordingly and skips sending the body if the request is HEAD
  function createTcpServer() {
    const server = net.createServer();
    server.on('connection', (socket) => {
      socket.write(`HTTP/1.1 200 OK\r\n`)
      socket.write(`Content-Type: text/html\r\n`)
      socket.write(`Content-Length: 155\r\n`)
      socket.write(`\r\n`)
      socket.write(`<!DOCTYPE html>
<html>
<head>
 <meta charset="UTF-8">
</head>
<body>
<h1>Hi there</h1>
<p>This is a bad implementation of an HTTP server</p></body>
</html>`)

      socket.end()
    })
    return new Promise<{port: number, server: net.Server}>((resolve) => server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port
      resolve({port, server})
    }));
  }

  const {port, server} = await createTcpServer()
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })

  const res = await connection.request({
    path: '/hello',
    method: 'HEAD',
    headers: {
      'X-Custom-Test': 'true'
    }
  }, options)
  t.match(res.headers, { 'content-length': 155 })
  t.equal(res.body, '')
  server.close()
})
