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
import { URL } from 'url'
import * as http from 'http'
import { Agent } from 'http'
import buffer from 'buffer'
import { gzipSync, deflateSync } from 'zlib'
import { Readable } from 'stream'
import hpagent from 'hpagent'
import intoStream from 'into-stream'
import AbortController from 'node-abort-controller'
import { buildServer } from '../utils'
import { HttpConnection, errors, ConnectionOptions } from '../../'
import { ConfigurationError } from '../../lib/errors'

const {
  TimeoutError,
  RequestAbortedError,
  ConnectionError
} = errors

const options = {
  requestId: 42,
  name: 'test',
  context: null
}

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
  t.strictEqual(res.body, 'ok')
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
  t.strictEqual(res.body, 'ok')
  server.stop()
})

test('Basic (https with ssl agent)', async t => {
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
    ssl: { key, cert }
  })
  const res = await connection.request({
    path: '/hello',
    method: 'GET',
    headers: {
      'X-Custom-Test': 'true'
    }
  }, options)
  t.match(res.headers, { connection: /keep-alive/ })
  t.strictEqual(res.body, 'ok')
  server.stop()
})

test('Custom http agent', async t => {
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
      t.strictEqual(opts.url.toString(), new URL(`http://localhost:${port}`).toString())
      return agent
    }
  })
  t.strictEqual(connection.agent?.maxSockets, 42)

  const res = await connection.request({
    path: '/hello',
    method: 'GET',
    headers: {
      'X-Custom-Test': 'true'
    }
  }, options)
  t.match(res.headers, { connection: /keep-alive/ })
  t.strictEqual(res.body, 'ok')
  server.stop()
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
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`),
    agent: false
  })
  const res = await connection.request({
    path: '/hello',
    method: 'GET',
    headers: {
      'X-Custom-Test': 'true'
    }
  }, options)
  t.match(res.headers, { connection: /close/ })
  server.stop()
})

test('Timeout support / 1', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    setTimeout(() => res.end('ok'), 100)
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
  } catch (err) {
    t.true(err instanceof TimeoutError)
  }
  server.stop()
})

test('Timeout support / 2', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    setTimeout(() => res.end('ok'), 100)
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })

  try {
    await connection.request({
      path: '/hello',
      method: 'GET',
      timeout: 50
    }, options)
  } catch (err) {
    t.true(err instanceof TimeoutError)
  }
  server.stop()
})

test('Timeout support / 3', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    setTimeout(() => res.end('ok'), 100)
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`),
    timeout: 1000
  })

  try {
    await connection.request({
      path: '/hello',
      method: 'GET',
      timeout: 50
    }, options)
  } catch (err) {
    t.true(err instanceof TimeoutError)
  }
  server.stop()
})

test('Should concatenate the querystring', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.strictEqual(req.url, '/hello?hello=world&you_know=for%20search')
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
      t.strictEqual(payload, 'hello')
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
      t.strictEqual(payload, 'hello')
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
      t.strictEqual(payload, 'hello')
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

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    setTimeout(() => res.end('ok'), 100)
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
  t.strictEqual(res.body, 'ok')

  server.stop()
})

test('Url with auth', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.strictEqual(req.headers.authorization, 'Basic Zm9vOmJhcg==')
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
    t.strictEqual(req.url, '/hello?foo=bar&baz=faz')
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
  t.deepEqual(connection.headers, { 'x-foo': 'bar' })
  server.stop()
})

// // TODO: add a check that the response is not decompressed
// test('asStream set to true', t => {
//   t.plan(2)

//   function handler (req, res) {
//     res.end('ok')
//   }

//   buildServer(handler, ({ port }, server) => {
//     const connection = new Connection({
//       url: new URL(`http://localhost:${port}`)
//     })
//     connection.request({
//       path: '/hello',
//       method: 'GET',
//       asStream: true
//     }, (err, res) => {
//       t.error(err)

//       let payload = ''
//       res.setEncoding('utf8')
//       res.on('data', chunk => { payload += chunk })
//       res.on('error', err => t.fail(err))
//       res.on('end', () => {
//         t.strictEqual(payload, 'ok')
//         server.stop()
//       })
//     })
//   })
// })

test('Ipv6 support', t => {
  const connection = new HttpConnection({
    url: new URL('http://[::1]:9200')
  })
  t.strictEqual(connection.buildRequestObject({ method: 'GET', path: '/' }).hostname, '::1')
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
  } catch (err) {
    t.strictEqual(
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

    t.strictEqual(
      connection.buildRequestObject({ method: 'GET', path: '/' }).port,
      undefined
    )

    t.end()
  })

  t.test('https 443', t => {
    const connection = new HttpConnection({
      url: new URL('https://localhost:443')
    })

    t.strictEqual(
      connection.buildRequestObject({ method: 'GET', path: '/' }).port,
      undefined
    )

    t.end()
  })

  t.end()
})

test('Abort a request syncronously', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.fail('The server should not be contacted')
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`),
    headers: { 'x-foo': 'bar' }
  })

  const controller = new AbortController()
  connection.request({
    path: '/hello',
    method: 'GET',
    abortController: controller
  }, options).catch(err => {
    t.ok(err instanceof RequestAbortedError)
    server.stop()
  })

  controller.abort()
  await connection.close()
})

test('Abort a request asyncronously', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
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
      method: 'GET',
      abortController: controller
    }, options)
  } catch (err) {
    t.ok(err instanceof RequestAbortedError)
  }

  await connection.close()
  server.stop()
})

test('Should correctly resolve request path / 1', t => {
  t.plan(1)

  const connection = new HttpConnection({
    url: new URL('http://localhost:80/test')
  })

  t.strictEqual(
    connection.buildRequestObject({
      method: 'GET',
      path: 'hello'
    }).path,
    '/test/hello'
  )
})

test('Should correctly resolve request path / 2', t => {
  t.plan(1)

  const connection = new HttpConnection({
    url: new URL('http://localhost:80/test/')
  })

  t.strictEqual(
    connection.buildRequestObject({
      method: 'GET',
      path: 'hello'
    }).path,
    '/test/hello'
  )
})

test('Proxy agent (http)', t => {
  t.plan(1)

  const connection = new HttpConnection({
    url: new URL('http://localhost:9200'),
    proxy: 'http://localhost:8080'
  })

  t.true(connection.agent instanceof hpagent.HttpProxyAgent)
})

test('Proxy agent (https)', t => {
  t.plan(1)

  const connection = new HttpConnection({
    url: new URL('https://localhost:9200'),
    proxy: 'http://localhost:8080'
  })

  t.true(connection.agent instanceof hpagent.HttpsProxyAgent)
})

test('Abort with a slow body', async t => {
  t.plan(1)

  const controller = new AbortController()
  const connection = new HttpConnection({
    url: new URL('https://localhost:9200'),
    proxy: 'http://localhost:8080'
  })

  const slowBody = new Readable({
    read (size: number) {
      setTimeout(() => {
        this.push('{"size":1, "query":{"match_all":{}}}')
        this.push(null) // EOF
      }, 1000).unref()
    }
  })

  setImmediate(() => controller.abort())
  try {
    await connection.request({
      method: 'GET',
      path: '/',
      // @ts-ignore
      body: slowBody,
      abortController: controller
    }, options)
  } catch (err) {
    t.ok(err instanceof RequestAbortedError)
  }
})

// The nodejs http agent will try to wait for the whole
// body to arrive before closing the request, so this
// test might take some time.
test('Bad content length', async t => {
  t.plan(2)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
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
  } catch (err) {
    t.ok(err instanceof ConnectionError)
    t.is(err.message, 'Response aborted while reading the body')
  }
  server.stop()
})

test('Socket destryed while reading the body', async t => {
  t.plan(2)

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
  const connection = new HttpConnection({
    url: new URL(`http://localhost:${port}`)
  })
  try {
    await connection.request({
      path: '/hello',
      method: 'GET'
    }, options)
  } catch (err) {
    t.ok(err instanceof ConnectionError)
    t.is(err.message, 'Response aborted while reading the body')
  }
  server.stop()
})

test('Content length too big (buffer)', async t => {
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
  } catch (err) {
    t.ok(err instanceof RequestAbortedError)
    t.is(err.message, `The content length (${buffer.constants.MAX_LENGTH + 10}) is bigger than the maximum allowed buffer (${buffer.constants.MAX_LENGTH})`)
  }
})

test('Content length too big (string)', async t => {
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
  } catch (err) {
    t.ok(err instanceof RequestAbortedError)
    t.is(err.message, `The content length (${buffer.constants.MAX_STRING_LENGTH + 10}) is bigger than the maximum allowed string (${buffer.constants.MAX_STRING_LENGTH})`)
  }
})

test('Compressed responsed should return a buffer as body (gzip)', async t => {
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
  t.true(res.body instanceof Buffer)
  server.stop()
})

test('Compressed responsed should return a buffer as body (deflate)', async t => {
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
  t.true(res.body instanceof Buffer)
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
  } catch (err) {
    t.true(err instanceof ConnectionError)
  }
})

test('Throw if detects undici agent options', async t => {
  t.plan(1)

  try {
    new HttpConnection({
      url: new URL('http://localhost:9200'),
      agent: {
        connections: 42
      }
    })
  } catch (err) {
    t.true(err instanceof ConfigurationError)
  }
})
