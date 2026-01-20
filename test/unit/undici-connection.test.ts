/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { setTimeout } from 'node:timers/promises'
import { URL } from 'node:url'
import * as http from 'node:http'
import buffer from 'node:buffer'
import { gzipSync, deflateSync } from 'node:zlib'
import { Readable } from 'node:stream'
import { Agent } from 'undici'
import { test } from 'tap'
import intoStream from 'into-stream'
import FakeTimers from '@sinonjs/fake-timers'
import { buildServer } from '../utils'
import { UndiciConnection, errors, ConnectionOptions, ConnectionRequestResponse } from '../../'

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

test('Timeout support', t => {
  t.test('Timeout support / 1', async t => {
    t.plan(1)

    async function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      await setTimeout(1000)
      res.end('ok')
    }

    const [{ port }, server] = await buildServer(handler)
    const connection = new UndiciConnection({
      url: new URL(`http://localhost:${port}`),
      timeout: 600
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

  t.test('Timeout support / 2', async t => {
    t.plan(2)

    const clock = FakeTimers.install({ toFake: ['setTimeout'] })
    t.teardown(() => clock.uninstall())

    async function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      res.writeHead(200, { 'content-type': 'text/plain' })
      await setTimeout(1000)
      res.end('ok')
    }

    const [{ port }, server] = await buildServer(handler)
    const connection = new UndiciConnection({
      url: new URL(`http://localhost:${port}`),
      timeout: 600
    })
    try {
      const res = connection.request({
        path: '/hello',
        method: 'GET'
      }, options)
      clock.tick(600)
      await res
    } catch (err: any) {
      t.ok(err instanceof TimeoutError)
      t.equal(err.message, 'Request timed out')
    }
    server.stop()
  })

  t.test('Timeout support / 3', async t => {
    t.plan(2)
    const clock = FakeTimers.install({ toFake: ['setTimeout'] })
    t.teardown(() => clock.uninstall())

    async function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      await setTimeout(1000)
      res.end('ok')
    }

    const [{ port }, server] = await buildServer(handler)
    const connection = new UndiciConnection({
      url: new URL(`http://localhost:${port}`),
      timeout: 600
    })
    try {
      const res = connection.request({
        path: '/hello',
        method: 'GET'
      }, {
        timeout: 600,
        ...options
      })
      clock.tick(600)
      await res
    } catch (err: any) {
      t.ok(err instanceof TimeoutError)
      t.equal(err.message, 'Request timed out')
    }
    server.stop()
  })

  t.test('Timeout support / 4', async t => {
    t.plan(2)
    const clock = FakeTimers.install({ toFake: ['setTimeout'] })
    t.teardown(() => clock.uninstall())

    async function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      await setTimeout(1000)
      res.end('ok')
    }

    const [{ port }, server] = await buildServer(handler)
    const connection = new UndiciConnection({
      url: new URL(`http://localhost:${port}`),
      timeout: 2000
    })
    const abortController = new AbortController()
    try {
      const res = connection.request({
        path: '/hello',
        method: 'GET',
      }, {
        signal: abortController.signal,
        timeout: 50,
        ...options
      })
      clock.tick(1000)
      await res
      t.fail('Timeout was not reached')
    } catch (err: any) {
      t.ok(err instanceof TimeoutError)
      t.equal(err.message, 'Request timed out')
    }
    server.stop()
  })

  t.test('Timeout support / 5', async t => {
    t.plan(1)

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
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

  t.test('No default timeout', async t => {
    t.plan(2)

    const clock = FakeTimers.install({ toFake: ['setTimeout'] })
    t.teardown(() => clock.uninstall())

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      setTimeout(1000 * 60 * 60).then(() => res.end('ok'))
      clock.tick(1000 * 60 * 60)
    }

    const [{ port }, server] = await buildServer(handler)
    const connection = new UndiciConnection({
      url: new URL(`http://localhost:${port}`)
    })

    const res = await connection.request({
      path: '/hello',
      method: 'GET'
    }, options)
    t.equal(res.body, 'ok')
    t.ok('Request did not time out')
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

  async function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    await setTimeout(100)
    res.end('ok')
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

test('Abort request', t => {
  t.test('Abort a request syncronously', async t => {
    t.plan(2)

    function handler (_req: http.IncomingMessage, _res: http.ServerResponse) {
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

  t.test('Abort a request asyncronously', async t => {
    t.plan(1)

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
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

  t.test('Abort with a slow body', async t => {
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
      async read (_size: number) {
        await setTimeout(1000, { ref: false })
        this.push(null) // EOF
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

  t.end()
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

  t.test('Content length too big (buffer)', async t => {
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

  t.test('Content length too big (string)', async t => {
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

  t.test('Content length too big custom option (buffer)', async t => {
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

  t.test('Content length too big custom option (string)', async t => {
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

  t.end()
})

test('Socket destroyed while reading the body', async t => {
  t.plan(2)

  async function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    const body = JSON.stringify({ hello: 'world' })
    res.setHeader('Content-Type', 'application/json;utf=8')
    res.setHeader('Content-Length', body.length + '')
    res.write(body.slice(0, -5))
    await setTimeout(500)
    res.socket?.destroy()
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

test('Body too big custom option (string)', async t => {
  t.plan(2)

  async function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, {
      'content-type': 'application/json;utf=8',
      'transfer-encoding': 'chunked'
    })
    res.write('{"hello":')
    await setTimeout(500)
    res.write('"world"}')
    await setTimeout(1000)
    res.end()
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
    t.fail('Should throw')
  } catch (err: any) {
    t.ok(err instanceof RequestAbortedError)
    t.equal(err.message, 'The content length (9) is bigger than the maximum allowed string (1)')
  }

  server.stop()
})

test('Body too big custom option (buffer)', async t => {
  t.plan(2)

  async function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, {
      'content-type': 'application/json;utf=8',
      'content-encoding': 'gzip',
      'transfer-encoding': 'chunked'
    })
    res.write(gzipSync('{"hello":'))
    await setTimeout(500)
    res.write(gzipSync('"world"}'))
    await setTimeout(1000)
    res.end()
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
    t.fail('Should throw')
  } catch (err: any) {
    t.ok(err instanceof RequestAbortedError)
    t.equal(err.message, 'The content length (29) is bigger than the maximum allowed buffer (1)')
  }

  server.stop()
})

test('UTF-8 multi-byte characters not corrupted in chunked response', async t => {
  t.plan(3)

  // Test with emoji (🚀 - 4 bytes: F0 9F 9A 80) and Georgian text (გამარჯობა - 3-byte chars)
  // We'll split the emoji bytes across chunks to test corruption prevention
  const text = 'Hello 🚀 World'
  const georgianText = 'გამარჯობა'
  const fullText = `${text} ${georgianText}`
  const fullTextBuffer = Buffer.from(fullText, 'utf8')

  // Find the emoji position in the buffer (after "Hello ")
  // "Hello 🚀" = "Hello " (6 bytes) + 🚀 (4 bytes)
  const emojiStart = Buffer.from('Hello ', 'utf8').length

  async function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, {
      'content-type': 'application/json;charset=utf-8',
      'transfer-encoding': 'chunked'
    })

    // Split the emoji across chunks to force byte-boundary split
    // Send: chunk1 = "Hello " + first 2 bytes of emoji
    //       chunk2 = last 2 bytes of emoji + " World" + Georgian text
    res.write(Buffer.from(Uint8Array.prototype.slice.call(fullTextBuffer, 0, emojiStart + 2))) // First chunk: up to middle of emoji
    await setTimeout(100)
    res.write(Buffer.from(Uint8Array.prototype.slice.call(fullTextBuffer, emojiStart + 2))) // Second chunk: rest of emoji + rest of text
    await setTimeout(100)
    res.end()
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`)
  })

  const res = await connection.request({
    method: 'GET',
    path: '/'
  }, options)

  // Verify the response is a string (not Buffer)
  t.equal(typeof res.body, 'string')
  t.notOk(res.body instanceof Buffer)
  // Verify the text is correctly decoded without corruption
  t.equal(res.body, fullText)

  server.stop()
})

test('UTF-8 multi-byte characters with Georgian text split across chunks', async t => {
  t.plan(2)

  // Georgian text "გამარჯობა" contains 3-byte UTF-8 characters
  // We'll split a Georgian character across chunks
  const georgianText = 'გამარჯობა'
  const georgianBuffer = Buffer.from(georgianText, 'utf8')

  // First Georgian char 'გ' is 3 bytes: E1 83 92
  // Split it: first 2 bytes in chunk1, last byte + rest in chunk2
  async function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, {
      'content-type': 'text/plain;charset=utf-8',
      'transfer-encoding': 'chunked'
    })

    // Split first Georgian character across chunks
    res.write(Buffer.from(Uint8Array.prototype.slice.call(georgianBuffer, 0, 2))) // First 2 bytes of 'გ'
    await setTimeout(100)
    res.write(Buffer.from(Uint8Array.prototype.slice.call(georgianBuffer, 2))) // Last byte of 'გ' + rest of text
    await setTimeout(100)
    res.end()
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
    url: new URL(`http://localhost:${port}`)
  })

  const res = await connection.request({
    method: 'GET',
    path: '/'
  }, options)

  // Verify the Georgian text is correctly decoded without corruption
  t.equal(typeof res.body, 'string')
  t.equal(res.body, georgianText)

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
  t.plan(2)

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

  function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
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

test('Support Apache Arrow', async t => {
  t.plan(1)

  const binaryContent = '/////zABAAAQAAAAAAAKAA4ABgANAAgACgAAAAAABAAQAAAAAAEKAAwAAAAIAAQACgAAAAgAAAAIAAAAAAAAAAIAAAB8AAAABAAAAJ7///8UAAAARAAAAEQAAAAAAAoBRAAAAAEAAAAEAAAAjP///wgAAAAQAAAABAAAAGRhdGUAAAAADAAAAGVsYXN0aWM6dHlwZQAAAAAAAAAAgv///wAAAQAEAAAAZGF0ZQAAEgAYABQAEwASAAwAAAAIAAQAEgAAABQAAABMAAAAVAAAAAAAAwFUAAAAAQAAAAwAAAAIAAwACAAEAAgAAAAIAAAAEAAAAAYAAABkb3VibGUAAAwAAABlbGFzdGljOnR5cGUAAAAAAAAAAAAABgAIAAYABgAAAAAAAgAGAAAAYW1vdW50AAAAAAAA/////7gAAAAUAAAAAAAAAAwAFgAOABUAEAAEAAwAAABgAAAAAAAAAAAABAAQAAAAAAMKABgADAAIAAQACgAAABQAAABYAAAABQAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAQAAAAAAAAAIAAAAAAAAACgAAAAAAAAAMAAAAAAAAAABAAAAAAAAADgAAAAAAAAAKAAAAAAAAAAAAAAAAgAAAAUAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAHwAAAAAAAAAAAACgmZkTQAAAAGBmZiBAAAAAAAAAL0AAAADAzMwjQAAAAMDMzCtAHwAAAAAAAADV6yywkgEAANWPBquSAQAA1TPgpZIBAADV17mgkgEAANV7k5uSAQAA/////wAAAAA='

  function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    res.setHeader('Content-Type', 'application/vnd.apache.arrow.stream')
    res.end(Buffer.from(binaryContent, 'base64'))
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new UndiciConnection({
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

  t.test('Check server fingerprint (different formats)', async t => {
    t.plan(1)

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      res.end('ok')
    }

    const [{ port, caFingerprint }, server] = await buildServer(handler, { secure: true })

    let newCaFingerprint = caFingerprint.toLowerCase().replace(/:/g, '')

    const connection = new UndiciConnection({
      url: new URL(`https://localhost:${port}`),
      caFingerprint: newCaFingerprint
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

  t.test('Multiple requests to same connection should skip fingerprint check when session is reused', async t => {
    // fingerprint matching can, and must, be skipped when a TLS session is being reused
    // see https://nodejs.org/api/tls.html#session-resumption
    // this tests that subsequent requests sent to the same connection will not fail due to
    // a fingerprint match test failing.
    const runs = 4
    t.plan(runs)

    function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
      res.end('ok')
    }

    const [{ port, caFingerprint }, server] = await buildServer(handler, { secure: true })
    const connection = new UndiciConnection({
      url: new URL(`https://localhost:${port}`),
      caFingerprint,
    })

    for (let i = 0; i < runs; i++) {
      const res = await connection.request({
        path: `/hello-${i}`,
        method: 'GET'
      }, options)
      t.equal(res.body, 'ok')
    }

    server.stop()
  })

  t.end()
})

test('Should show local/remote socket addres in case of ECONNRESET', async t => {
  t.plan(2)

  function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
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

test('as stream', async t => {
  t.plan(2)

  function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
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

test('limit max open connections using Undici Agent', async t => {
  const maxOrigins = 3
  const connections = 3

  async function handler (_req: http.IncomingMessage, res: http.ServerResponse) {
    res.end('ok')
  }
  const agent = new Agent({
    maxOrigins,
    connections,
    keepAliveMaxTimeout: 100,
    keepAliveTimeout: 100
  })

  const conns: UndiciConnection[] = []
  const after: Function[] = []

  // create 1 more server than maxOrigins
  for (let i = 0; i <= maxOrigins; i++) {
    const [{ port }, server] = await buildServer(handler)
    const conn = new UndiciConnection({
      url: new URL(`http://localhost:${port}`),
      agent: () => agent
    })
    conns.push(conn)
    after.push(() => server.stop())
  }

  let reqCount = 0
  const reqs: Promise<ConnectionRequestResponse>[] = []

  conns.forEach(async c => {
    for (let i = 0; i < connections; i++) {
      reqs.push(c.request({ path: '/hello', method: 'GET' }, options))
      reqCount++
    }
  })
  const results = await Promise.allSettled(reqs)

  t.equal(results.filter(r => r.status === 'fulfilled').length, maxOrigins * connections)
  t.equal(results.filter(r => r.status === 'rejected').length, connections)
  results.filter(r => r.status === 'rejected').forEach(r => {
    t.ok(r.reason instanceof ConnectionError)
    t.equal(r.reason.message, 'Maximum allowed origins reached')
  })

  after.forEach(fn => fn())
})
