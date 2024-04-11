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
import buffer from 'buffer'
import { gzipSync, deflateSync } from 'zlib'
import { Readable } from 'stream'
import intoStream from 'into-stream'
import { buildServer } from '../utils'
import { UndiciConnection, errors, ConnectionOptions } from '../../'

const {
  ConfigurationError,
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
  const connection = new UndiciConnection({
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
  const connection = new UndiciConnection({
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
  const connection = new UndiciConnection({
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

test('Timeout support / 1', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    setTimeout(() => res.end('ok'), 100)
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`),
    timeout: 50
  })

  try {
    await connection.request({
      path: '/hello',
      method: 'GET'
    }, options)
  } catch (err: any) {
    t.ok(err instanceof TimeoutError)
  }
  server.stop()
})

test('Timeout support / 2', async t => {
  t.plan(2)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, { 'content-type': 'text/plain' })
    setTimeout(() => res.end('ok'), 100)
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`),
    timeout: 50
  })
  try {
    await connection.request({
      path: '/hello',
      method: 'GET'
    }, options)
  } catch (err: any) {
    t.ok(err instanceof TimeoutError)
    t.equal(err.message, 'Request timed out')
  }
  server.stop()
})

test('Timeout support / 3', async t => {
  t.plan(2)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    setTimeout(() => res.end('ok'), 100)
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`),
    timeout: 200
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
    t.ok(err instanceof TimeoutError)
    t.equal(err.message, 'Request timed out')
  }
  server.stop()
})

test('Timeout support / 4', async t => {
  t.plan(2)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    setTimeout(() => res.end('ok'), 100)
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`),
    timeout: 200
  })
  const abortController = new AbortController()
  try {
    await connection.request({
      path: '/hello',
      method: 'GET',
    }, {
      signal: abortController.signal,
      timeout: 50,
      ...options
    })
    t.fail('Timeout was not reached')
  } catch (err: any) {
    t.ok(err instanceof TimeoutError)
    t.equal(err.message, 'Request timed out')
  }
  server.stop()
})

test('Timeout support / 5', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`)
  })
  const res = await connection.request({
    path: '/hello',
    method: 'GET',
  }, {
    timeout: 50,
    ...options
  })
  t.equal(res.body, 'ok')
  server.stop()
})

test('Should concatenate the querystring', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.equal(req.url, '/hello?hello=world&you_know=for%20search')
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
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
  const connection = new UndiciConnection({
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
  const connection = new UndiciConnection({
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
  const connection = new UndiciConnection({
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
  const connection = new UndiciConnection({
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
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`),
    auth: { username: 'foo', password: 'bar' }
  })

  await connection.request({
    path: '/hello',
    method: 'GET'
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
  const connection = new UndiciConnection({
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

// // https://github.com/nodejs/node/commit/b961d9fd83
test('Should disallow two-byte characters in URL path', async t => {
  t.plan(1)

  const connection = new UndiciConnection({
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

test('Abort a request syncronously', async t => {
  t.plan(2)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.fail('The server should not be contacted')
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`),
    headers: { 'x-foo': 'bar' }
  })

  const controller = new AbortController()
  connection.request({
    path: '/hello',
    method: 'GET',
  }, {
    signal: controller.signal,
    ...options
  }).catch(err => {
    t.ok(err instanceof RequestAbortedError)
    t.ok(controller.signal.aborted, 'Signal should be aborted')
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
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`),
    headers: { 'x-foo': 'bar' }
  })

  const controller = new AbortController()
  setImmediate(() => controller.abort())
  try {
    await connection.request({
      path: '/hello',
      method: 'GET',
    }, {
      signal: controller.signal,
      ...options
    })
  } catch (err: any) {
    t.ok(err instanceof RequestAbortedError)
  }

  await connection.close()
  server.stop()
})

test('Abort with a slow body', async t => {
  t.plan(1)

  const controller = new AbortController()
  function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    res.end('ok')
  }
  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`)
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
    }, {
      signal: controller.signal,
      ...options
    })
  } catch (err: any) {
    t.ok(err instanceof RequestAbortedError)
  }
  server.stop()
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
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`)
  })
  try {
    await connection.request({
      path: '/hello',
      method: 'GET'
    }, options)
  } catch (err: any) {
    t.ok(err instanceof ConnectionError)
    t.equal(err.message, 'other side closed')
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
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`)
  })
  try {
    await connection.request({
      path: '/hello',
      method: 'GET'
    }, options)
  } catch (err: any) {
    t.ok(err instanceof ConnectionError)
    t.equal(err.message, 'other side closed')
  }
  server.stop()
})

test('Content length too big (buffer)', async t => {
  t.plan(2)

  class MyConnection extends UndiciConnection {
    constructor (opts: ConnectionOptions) {
      super(opts)
      this.pool = {
        // @ts-expect-error
        request () {
          const stream = intoStream(JSON.stringify({ hello: 'world' }))
          const statusCode = 200
          const headers = {
            'content-type': 'application/json;utf=8',
            'content-encoding': 'gzip',
            'content-length': buffer.constants.MAX_LENGTH + 10,
            connection: 'keep-alive',
            date: new Date().toISOString()
          }
          return { body: stream, statusCode, headers }
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
    t.ok(err instanceof RequestAbortedError)
    t.equal(err.message, `The content length (${buffer.constants.MAX_LENGTH + 10}) is bigger than the maximum allowed buffer (${buffer.constants.MAX_LENGTH})`)
  }
})

test('Content length too big (string)', async t => {
  t.plan(2)

  class MyConnection extends UndiciConnection {
    constructor (opts: ConnectionOptions) {
      super(opts)
      this.pool = {
        // @ts-expect-error
        request () {
          const stream = intoStream(JSON.stringify({ hello: 'world' }))
          const statusCode = 200
          const headers = {
            'content-type': 'application/json;utf=8',
            'content-encoding': 'gzip',
            'content-length': buffer.constants.MAX_STRING_LENGTH + 10,
            connection: 'keep-alive',
            date: new Date().toISOString()
          }
          return { body: stream, statusCode, headers }
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
    t.ok(err instanceof RequestAbortedError)
    t.equal(err.message, `The content length (${buffer.constants.MAX_STRING_LENGTH + 10}) is bigger than the maximum allowed string (${buffer.constants.MAX_STRING_LENGTH})`)
  }
})

test('Content length too big custom option (buffer)', async t => {
  t.plan(2)

  class MyConnection extends UndiciConnection {
    constructor (opts: ConnectionOptions) {
      super(opts)
      this.pool = {
        // @ts-expect-error
        request () {
          const stream = intoStream(JSON.stringify({ hello: 'world' }))
          const statusCode = 200
          const headers = {
            'content-type': 'application/json;utf=8',
            'content-encoding': 'gzip',
            'content-length': 1100,
            connection: 'keep-alive',
            date: new Date().toISOString()
          }
          return { body: stream, statusCode, headers }
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
    t.ok(err instanceof RequestAbortedError)
    t.equal(err.message, 'The content length (1100) is bigger than the maximum allowed buffer (1000)')
  }
})

test('Content length too big custom option (string)', async t => {
  t.plan(2)

  class MyConnection extends UndiciConnection {
    constructor (opts: ConnectionOptions) {
      super(opts)
      this.pool = {
        // @ts-expect-error
        request () {
          const stream = intoStream(JSON.stringify({ hello: 'world' }))
          const statusCode = 200
          const headers = {
            'content-type': 'application/json;utf=8',
            'content-encoding': 'gzip',
            'content-length': 1100,
            connection: 'keep-alive',
            date: new Date().toISOString()
          }
          return { body: stream, statusCode, headers }
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
    t.ok(err instanceof RequestAbortedError)
    t.equal(err.message, 'The content length (1100) is bigger than the maximum allowed string (1000)')
  }
})

test('Body too big custom option (string)', async t => {
  t.plan(2)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, {
      'content-type': 'application/json;utf=8',
      'transfer-encoding': 'chunked'
    })
    res.write('{"hello":')
    setTimeout(() => res.write('"world"}'), 500)
    setTimeout(() => res.end(), 1000)
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`)
  })

  try {
    await connection.request({
      method: 'GET',
      path: '/'
    }, { ...options, maxResponseSize: 1 })
    t.fail('Shold throw')
  } catch (err: any) {
    t.ok(err instanceof RequestAbortedError)
    t.equal(err.message, 'The content length (9) is bigger than the maximum allowed string (1)')
  }

  server.stop()
})

test('Body too big custom option (buffer)', async t => {
  t.plan(2)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, {
      'content-type': 'application/json;utf=8',
      'content-encoding': 'gzip',
      'transfer-encoding': 'chunked'
    })
    res.write(gzipSync('{"hello":'))
    setTimeout(() => res.write(gzipSync('"world"}')), 500)
    setTimeout(() => res.end(), 1000)
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`)
  })

  try {
    await connection.request({
      method: 'GET',
      path: '/'
    }, { ...options, maxCompressedResponseSize: 1 })
    t.fail('Shold throw')
  } catch (err: any) {
    t.ok(err instanceof RequestAbortedError)
    t.equal(err.message, 'The content length (29) is bigger than the maximum allowed buffer (1)')
  }

  server.stop()
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
  const connection = new UndiciConnection({
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
  const connection = new UndiciConnection({
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

test('Connection error', async t => {
  t.plan(1)

  const connection = new UndiciConnection({
    url: new URL('http://foo.bar')
  })

  try {
    await connection.request({
      path: '/',
      method: 'GET'
    }, options)
  } catch (err: any) {
    t.ok(err instanceof ConnectionError)
  }
})

test('Throw if detects http agent options', async t => {
  t.plan(3)

  try {
    new UndiciConnection({
      url: new URL('http://localhost:9200'),
      agent: {
        keepAlive: false
      }
    })
  } catch (err: any) {
    t.ok(err instanceof ConfigurationError)
  }

  try {
    new UndiciConnection({
      url: new URL('http://localhost:9200'),
      agent: () => new http.Agent()
    })
  } catch (err: any) {
    t.ok(err instanceof ConfigurationError)
  }

  try {
    new UndiciConnection({
      url: new URL('http://localhost:9200'),
      agent: false
    })
  } catch (err: any) {
    t.ok(err instanceof ConfigurationError)
  }
})

test('Throw if detects proxy option', async t => {
  t.plan(1)

  try {
    new UndiciConnection({
      url: new URL('http://localhost:9200'),
      proxy: new URL('http://localhost:9201')
    })
  } catch (err: any) {
    t.ok(err instanceof ConfigurationError)
  }
})

test('Support mapbox vector tile', async t => {
  t.plan(1)

  const mvtContent = 'GoMCCgRtZXRhEikSFAAAAQACAQMBBAAFAgYDBwAIBAkAGAMiDwkAgEAagEAAAP8//z8ADxoOX3NoYXJkcy5mYWlsZWQaD19zaGFyZHMuc2tpcHBlZBoSX3NoYXJkcy5zdWNjZXNzZnVsGg1fc2hhcmRzLnRvdGFsGhlhZ2dyZWdhdGlvbnMuX2NvdW50LmNvdW50GhdhZ2dyZWdhdGlvbnMuX2NvdW50LnN1bRoTaGl0cy50b3RhbC5yZWxhdGlvbhoQaGl0cy50b3RhbC52YWx1ZRoJdGltZWRfb3V0GgR0b29rIgIwACICMAIiCRkAAAAAAAAAACIECgJlcSICOAAogCB4Ag=='

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    res.setHeader('Content-Type', 'application/vnd.mapbox-vector-tile')
    res.end(Buffer.from(mvtContent, 'base64'))
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`)
  })
  const res = await connection.request({
    path: '/_mvt',
    method: 'GET',
  }, options)
  t.equal(res.body.toString('base64'), Buffer.from(mvtContent, 'base64').toString('base64'))
  server.stop()
})

test('Check server fingerprint (success)', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    res.end('ok')
  }

  const [{ port, caFingerprint }, server] = await buildServer(handler, { secure: true })
  const connection = new UndiciConnection({
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

test('Check server fingerprint (failure)', async t => {
  t.plan(2)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler, { secure: true })
  const connection = new UndiciConnection({
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
    t.ok(err instanceof ConnectionError)
    t.equal(err.message, 'Server certificate CA fingerprint does not match the value configured in caFingerprint')
  }
  server.stop()
})

test('Should show local/remote socket addres in case of ECONNRESET', async t => {
  t.plan(2)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    res.destroy()
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`)
  })
  try {
    await connection.request({
      path: '/hello',
      method: 'GET'
    }, options)
    t.fail('should throw')
  } catch (err: any) {
    t.ok(err instanceof ConnectionError)
    if (err.message.includes('::1')) {
      t.match(err.message, /other\sside\sclosed\s-\sLocal:\s::1:\d+,\sRemote:\s::1:\d+/)
    } else {
      t.match(err.message, /other\sside\sclosed\s-\sLocal:\s127.0.0.1:\d+,\sRemote:\s127.0.0.1:\d+/)
    }
  }
  server.stop()
})

test('Path without intial slash', async t => {
  t.plan(2)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    t.equal(req.url, '/hello')
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`)
  })
  const res = await connection.request({
    path: 'hello',
    method: 'GET'
  }, options)
  t.equal(res.body, 'ok')
  server.stop()
})

test('Should increase number of max event listeners', async t => {
  t.plan(1)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler, { secure: true })
  const connection = new UndiciConnection({
    url: new URL(`https://localhost:${port}`),
    maxEventListeners: 100,
  })
  const res = await connection.request({
    path: '/hello',
    method: 'GET'
  }, options)
  t.equal(res.body, 'ok')
  server.stop()
})

test('as stream', async t => {
  t.plan(2)

  function handler (req: http.IncomingMessage, res: http.ServerResponse) {
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
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
