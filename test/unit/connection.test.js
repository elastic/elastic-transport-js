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

'use strict'

const { test } = require('tap')
const { inspect } = require('util')
const { URL } = require('url')
const { Agent } = require('http')
const buffer = require('buffer')
const { Readable } = require('stream')
const hpagent = require('hpagent')
const intoStream = require('into-stream')
const AbortController = require('node-abort-controller')
const { buildServer } = require('../utils')
const Connection = require('../../lib/connection/Connection')
const {
  TimeoutError,
  ConfigurationError,
  RequestAbortedError,
  ConnectionError
} = require('../../lib/errors')

test('Basic (http)', t => {
  t.plan(3)

  function handler (req, res) {
    t.match(req.headers, {
      'x-custom-test': 'true',
      connection: 'keep-alive'
    })
    res.end('ok')
  }

  buildServer(handler, ({ port }, server) => {
    const connection = new Connection({
      url: new URL(`http://localhost:${port}`)
    })
    connection.request({
      path: '/hello',
      method: 'GET',
      headers: {
        'X-Custom-Test': true
      }
    }).then(res => {
      t.match(res.headers, { connection: 'keep-alive' })
      t.strictEqual(res.body, 'ok')
      server.stop()
    }).catch(t.fail)
  })
})

test('Basic (https)', t => {
  t.plan(3)

  function handler (req, res) {
    t.match(req.headers, {
      'x-custom-test': 'true',
      connection: 'keep-alive'
    })
    res.end('ok')
  }

  buildServer(handler, { secure: true }, ({ port }, server) => {
    const connection = new Connection({
      url: new URL(`https://localhost:${port}`)
    })
    connection.request({
      path: '/hello',
      method: 'GET',
      headers: {
        'X-Custom-Test': true
      }
    }).then(res => {
      t.match(res.headers, { connection: 'keep-alive' })
      t.strictEqual(res.body, 'ok')
      server.stop()
    }).catch(t.fail)
  })
})

test('Basic (https with ssl agent)', t => {
  t.plan(3)

  function handler (req, res) {
    t.match(req.headers, {
      'x-custom-test': 'true',
      connection: 'keep-alive'
    })
    res.end('ok')
  }

  buildServer(handler, { secure: true }, ({ port, key, cert }, server) => {
    const connection = new Connection({
      url: new URL(`https://localhost:${port}`),
      ssl: { key, cert }
    })
    connection.request({
      path: '/hello',
      method: 'GET',
      headers: {
        'X-Custom-Test': true
      }
    }).then(res => {
      t.match(res.headers, { connection: 'keep-alive' })
      t.strictEqual(res.body, 'ok')
      server.stop()
    }).catch(t.fail)
  })
})

test('Custom http agent', t => {
  t.plan(5)

  function handler (req, res) {
    t.match(req.headers, {
      'x-custom-test': 'true',
      connection: 'keep-alive'
    })
    res.end('ok')
  }

  buildServer(handler, ({ port }, server) => {
    const agent = new Agent({
      keepAlive: true,
      keepAliveMsecs: 1000,
      maxSockets: 256,
      maxFreeSockets: 256
    })
    agent.custom = true
    const connection = new Connection({
      url: new URL(`http://localhost:${port}`),
      agent: opts => {
        t.match(opts, {
          url: new URL(`http://localhost:${port}`)
        })
        return agent
      }
    })
    t.true(connection.agent.custom)
    connection.request({
      path: '/hello',
      method: 'GET',
      headers: {
        'X-Custom-Test': true
      }
    }).then(res => {
      t.match(res.headers, { connection: 'keep-alive' })
      t.strictEqual(res.body, 'ok')
      server.stop()
    }).catch(t.fail)
  })
})

test('Disable keep alive', t => {
  t.plan(2)

  function handler (req, res) {
    t.match(req.headers, {
      'x-custom-test': 'true',
      connection: 'close'
    })
    res.end('ok')
  }

  buildServer(handler, ({ port }, server) => {
    const connection = new Connection({
      url: new URL(`http://localhost:${port}`),
      agent: false
    })
    connection.request({
      path: '/hello',
      method: 'GET',
      headers: {
        'X-Custom-Test': true
      }
    }).then(res => {
      t.match(res.headers, { connection: 'close' })
      server.stop()
    }).catch(t.fail)
  })
})

test('Timeout support', t => {
  t.plan(1)

  function handler (req, res) {
    setTimeout(
      () => res.end('ok'),
      1000
    )
  }

  buildServer(handler, ({ port }, server) => {
    const connection = new Connection({
      url: new URL(`http://localhost:${port}`)
    })
    connection.request({
      path: '/hello',
      method: 'GET',
      timeout: 500
    }).then(t.fail).catch(err => {
      t.ok(err instanceof TimeoutError)
      server.stop()
    })
  })
})

test('querystring', t => {
  t.test('Should concatenate the querystring', t => {
    t.plan(1)

    function handler (req, res) {
      t.strictEqual(req.url, '/hello?hello=world&you_know=for%20search')
      res.end('ok')
    }

    buildServer(handler, ({ port }, server) => {
      const connection = new Connection({
        url: new URL(`http://localhost:${port}`)
      })
      connection.request({
        path: '/hello',
        method: 'GET',
        querystring: 'hello=world&you_know=for%20search'
      }).then(res => {
        server.stop()
      }).catch(t.fail)
    })
  })

  t.test('If the querystring is null should not do anything', t => {
    t.plan(1)

    function handler (req, res) {
      t.strictEqual(req.url, '/hello')
      res.end('ok')
    }

    buildServer(handler, ({ port }, server) => {
      const connection = new Connection({
        url: new URL(`http://localhost:${port}`)
      })
      connection.request({
        path: '/hello',
        method: 'GET',
        querystring: null
      }).then(res => {
        server.stop()
      }).catch(t.fail)
    })
  })

  t.end()
})

test('Body request', t => {
  t.plan(1)

  function handler (req, res) {
    let payload = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { payload += chunk })
    req.on('error', err => t.fail(err))
    req.on('end', () => {
      t.strictEqual(payload, 'hello')
      res.end('ok')
    })
  }

  buildServer(handler, ({ port }, server) => {
    const connection = new Connection({
      url: new URL(`http://localhost:${port}`)
    })
    connection.request({
      path: '/hello',
      method: 'POST',
      body: 'hello'
    }).then(res => {
      server.stop()
    }).catch(t.fail)
  })
})

test('Send body as buffer', t => {
  t.plan(1)

  function handler (req, res) {
    let payload = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { payload += chunk })
    req.on('error', err => t.fail(err))
    req.on('end', () => {
      t.strictEqual(payload, 'hello')
      res.end('ok')
    })
  }

  buildServer(handler, ({ port }, server) => {
    const connection = new Connection({
      url: new URL(`http://localhost:${port}`)
    })
    connection.request({
      path: '/hello',
      method: 'POST',
      body: Buffer.from('hello')
    }).then(res => {
      server.stop()
    }).catch(t.fail)
  })
})

test('Send body as stream', t => {
  t.plan(1)

  function handler (req, res) {
    let payload = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { payload += chunk })
    req.on('error', err => t.fail(err))
    req.on('end', () => {
      t.strictEqual(payload, 'hello')
      res.end('ok')
    })
  }

  buildServer(handler, ({ port }, server) => {
    const connection = new Connection({
      url: new URL(`http://localhost:${port}`)
    })
    connection.request({
      path: '/hello',
      method: 'POST',
      body: intoStream('hello')
    }).then(res => {
      server.stop()
    }).catch(t.fail)
  })
})

test('Should not close a connection if there are open requests', t => {
  t.plan(3)

  function handler (req, res) {
    setTimeout(() => res.end('ok'), 1000)
  }

  buildServer(handler, ({ port }, server) => {
    const connection = new Connection({
      url: new URL(`http://localhost:${port}`)
    })

    setTimeout(() => {
      t.strictEqual(connection._openRequests, 1)
      connection.close()
    }, 500)

    connection.request({
      path: '/hello',
      method: 'GET'
    }).then(res => {
      t.strictEqual(connection._openRequests, 0)
      t.strictEqual(res.body, 'ok')
      server.stop()
    }).catch(t.fail)
  })
})

test('Should not close a connection if there are open requests (with agent disabled)', t => {
  t.plan(3)

  function handler (req, res) {
    setTimeout(() => res.end('ok'), 1000)
  }

  buildServer(handler, ({ port }, server) => {
    const connection = new Connection({
      url: new URL(`http://localhost:${port}`),
      agent: false
    })

    setTimeout(() => {
      t.strictEqual(connection._openRequests, 1)
      connection.close()
    }, 500)

    connection.request({
      path: '/hello',
      method: 'GET'
    }).then(res => {
      t.strictEqual(connection._openRequests, 0)
      t.strictEqual(res.body, 'ok')
      server.stop()
    }).catch(t.fail)
  })
})

test('Url with auth', t => {
  t.plan(1)

  function handler (req, res) {
    t.match(req.headers, {
      authorization: 'Basic Zm9vOmJhcg=='
    })
    res.end('ok')
  }

  buildServer(handler, ({ port }, server) => {
    const connection = new Connection({
      url: new URL(`http://foo:bar@localhost:${port}`),
      auth: { username: 'foo', password: 'bar' }
    })
    connection.request({
      path: '/hello',
      method: 'GET'
    }).then(res => {
      server.stop()
    }).catch(t.fail)
  })
})

test('Url with querystring', t => {
  t.plan(1)

  function handler (req, res) {
    t.strictEqual(req.url, '/hello?foo=bar&baz=faz')
    res.end('ok')
  }

  buildServer(handler, ({ port }, server) => {
    const connection = new Connection({
      url: new URL(`http://localhost:${port}?foo=bar`)
    })
    connection.request({
      path: '/hello',
      method: 'GET',
      querystring: 'baz=faz'
    }).then(res => {
      server.stop()
    }).catch(t.fail)
  })
})

test('Custom headers for connection', t => {
  t.plan(2)

  function handler (req, res) {
    t.match(req.headers, {
      'x-custom-test': 'true',
      'x-foo': 'bar'
    })
    res.end('ok')
  }

  buildServer(handler, ({ port }, server) => {
    const connection = new Connection({
      url: new URL(`http://localhost:${port}`),
      headers: { 'x-foo': 'bar' }
    })
    connection.request({
      path: '/hello',
      method: 'GET',
      headers: {
        'X-Custom-Test': true
      }
    }).then(res => {
      // should not update the default
      t.deepEqual(connection.headers, { 'x-foo': 'bar' })
      server.stop()
    }).catch(t.fail)
  })
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

test('Connection id should not contain credentials', t => {
  const connection = new Connection({
    url: new URL('http://user:password@localhost:9200')
  })
  t.strictEqual(connection.id, 'http://localhost:9200/')
  t.end()
})

test('Ipv6 support', t => {
  const connection = new Connection({
    url: new URL('http://[::1]:9200')
  })
  t.strictEqual(connection.buildRequestObject({}).hostname, '::1')
  t.end()
})

test('Should throw if the protocol is not http or https', t => {
  try {
    new Connection({ // eslint-disable-line
      url: new URL('nope://nope')
    })
    t.fail('Should throw')
  } catch (err) {
    t.ok(err instanceof ConfigurationError)
    t.is(err.message, 'Invalid protocol: \'nope:\'')
  }
  t.end()
})

// // https://github.com/nodejs/node/commit/b961d9fd83
test('Should disallow two-byte characters in URL path', t => {
  t.plan(1)

  const connection = new Connection({
    url: new URL('http://localhost:9200')
  })
  connection.request({
    path: '/thisisinvalid\uffe2',
    method: 'GET'
  }).then(t.fail).catch(err => {
    t.strictEqual(
      err.message,
      'ERR_UNESCAPED_CHARACTERS: /thisisinvalid\uffe2'
    )
  })
})

test('setRole', t => {
  t.test('Update the value of a role', t => {
    t.plan(2)

    const connection = new Connection({
      url: new URL('http://localhost:9200')
    })

    t.deepEqual(connection.roles, {
      master: true,
      data: true,
      ingest: true,
      ml: false
    })

    connection.setRole('master', false)

    t.deepEqual(connection.roles, {
      master: false,
      data: true,
      ingest: true,
      ml: false
    })
  })

  t.test('Invalid role', t => {
    t.plan(2)

    const connection = new Connection({
      url: new URL('http://localhost:9200')
    })

    try {
      connection.setRole('car', true)
      t.fail('Shoud throw')
    } catch (err) {
      t.true(err instanceof ConfigurationError)
      t.is(err.message, 'Unsupported role: \'car\'')
    }
  })

  t.test('Invalid value', t => {
    t.plan(2)

    const connection = new Connection({
      url: new URL('http://localhost:9200')
    })

    try {
      connection.setRole('master', 1)
      t.fail('Shoud throw')
    } catch (err) {
      t.true(err instanceof ConfigurationError)
      t.is(err.message, 'enabled should be a boolean')
    }
  })

  t.end()
})

test('Util.inspect Connection class should hide agent, ssl and auth', t => {
  t.plan(1)

  const connection = new Connection({
    url: new URL('http://user:password@localhost:9200'),
    id: 'node-id',
    headers: { foo: 'bar' }
  })

  // Removes spaces and new lines because
  // utils.inspect is handled differently
  // between major versions of Node.js
  function cleanStr (str) {
    return str
      .replace(/\s/g, '')
      .replace(/(\r\n|\n|\r)/gm, '')
  }

  t.strictEqual(cleanStr(inspect(connection)), cleanStr(`{ url: 'http://localhost:9200/',
  id: 'node-id',
  headers: { foo: 'bar' },
  deadCount: 0,
  resurrectTimeout: 0,
  _openRequests: 0,
  status: 'alive',
  roles: { master: true, data: true, ingest: true, ml: false }}`)
  )
})

test('connection.toJSON should hide agent, ssl and auth', t => {
  t.plan(1)

  const connection = new Connection({
    url: new URL('http://user:password@localhost:9200'),
    id: 'node-id',
    headers: { foo: 'bar' }
  })

  t.deepEqual(connection.toJSON(), {
    url: 'http://localhost:9200/',
    id: 'node-id',
    headers: {
      foo: 'bar'
    },
    deadCount: 0,
    resurrectTimeout: 0,
    _openRequests: 0,
    status: 'alive',
    roles: {
      master: true,
      data: true,
      ingest: true,
      ml: false
    }
  })
})

// https://github.com/elastic/elasticsearch-js/issues/843
test('Port handling', t => {
  t.test('http 80', t => {
    const connection = new Connection({
      url: new URL('http://localhost:80')
    })

    t.strictEqual(
      connection.buildRequestObject({}).port,
      undefined
    )

    t.end()
  })

  t.test('https 443', t => {
    const connection = new Connection({
      url: new URL('https://localhost:443')
    })

    t.strictEqual(
      connection.buildRequestObject({}).port,
      undefined
    )

    t.end()
  })

  t.end()
})

test('Authorization header', t => {
  t.test('None', t => {
    const connection = new Connection({
      url: new URL('http://localhost:9200')
    })

    t.deepEqual(connection.headers, {})

    t.end()
  })

  t.test('Basic', t => {
    const connection = new Connection({
      url: new URL('http://localhost:9200'),
      auth: { username: 'foo', password: 'bar' }
    })

    t.deepEqual(connection.headers, { authorization: 'Basic Zm9vOmJhcg==' })

    t.end()
  })

  t.test('ApiKey (string)', t => {
    const connection = new Connection({
      url: new URL('http://localhost:9200'),
      auth: { apiKey: 'Zm9vOmJhcg==' }
    })

    t.deepEqual(connection.headers, { authorization: 'ApiKey Zm9vOmJhcg==' })

    t.end()
  })

  t.test('ApiKey (object)', t => {
    const connection = new Connection({
      url: new URL('http://localhost:9200'),
      auth: { apiKey: { id: 'foo', api_key: 'bar' } }
    })

    t.deepEqual(connection.headers, { authorization: 'ApiKey Zm9vOmJhcg==' })

    t.end()
  })

  t.end()
})

test('Should not add agent and ssl to the serialized connection', t => {
  const connection = new Connection({
    url: new URL('http://localhost:9200')
  })

  t.strictEqual(
    JSON.stringify(connection),
    '{"url":"http://localhost:9200/","id":"http://localhost:9200/","headers":{},"deadCount":0,"resurrectTimeout":0,"_openRequests":0,"status":"alive","roles":{"master":true,"data":true,"ingest":true,"ml":false}}'
  )

  t.end()
})

test('Abort a request syncronously', t => {
  t.plan(1)

  function handler (req, res) {
    t.fail('The server should not be contacted')
  }

  buildServer(handler, ({ port }, server) => {
    const controller = new AbortController()
    const connection = new Connection({
      url: new URL(`http://localhost:${port}`)
    })
    connection.request({
      path: '/hello',
      method: 'GET',
      abortController: controller
    }).then(t.fail).catch(err => {
      t.ok(err instanceof RequestAbortedError)
      server.stop()
    })
    controller.abort()
  })
})

test('Abort a request asyncronously', t => {
  t.plan(1)

  function handler (req, res) {
    // might be called or not
    res.end('ok')
  }

  buildServer(handler, ({ port }, server) => {
    const controller = new AbortController()
    const connection = new Connection({
      url: new URL(`http://localhost:${port}`)
    })
    connection.request({
      path: '/hello',
      method: 'GET',
      abortController: controller
    }).then(t.fail).catch(err => {
      t.ok(err instanceof RequestAbortedError)
      server.stop()
    })
    setImmediate(() => controller.abort())
  })
})

test('Should correctly resolve request pathname', t => {
  t.plan(1)

  const connection = new Connection({
    url: new URL('http://localhost:80/test')
  })

  t.strictEqual(
    connection.buildRequestObject({
      path: 'hello'
    }).pathname,
    '/test/hello'
  )
})

test('Proxy agent (http)', t => {
  t.plan(1)

  const connection = new Connection({
    url: new URL('http://localhost:9200'),
    proxy: 'http://localhost:8080'
  })

  t.true(connection.agent instanceof hpagent.HttpProxyAgent)
})

test('Proxy agent (https)', t => {
  t.plan(1)

  const connection = new Connection({
    url: new URL('https://localhost:9200'),
    proxy: 'http://localhost:8080'
  })

  t.true(connection.agent instanceof hpagent.HttpsProxyAgent)
})

test('Abort with a slow body', t => {
  t.plan(1)

  const controller = new AbortController()
  const connection = new Connection({
    url: new URL('https://localhost:9200'),
    proxy: 'http://localhost:8080'
  })

  const slowBody = new Readable({
    read (size) {
      setTimeout(() => {
        this.push('{"size":1, "query":{"match_all":{}}}')
        this.push(null) // EOF
      }, 1000).unref()
    }
  })

  connection.request({
    method: 'GET',
    path: '/',
    body: slowBody,
    abortController: controller
  }).then(t.fail).catch(err => {
    t.ok(err instanceof RequestAbortedError)
  })

  setImmediate(() => controller.abort())
})

// The nodejs http agent will try to wait for the whole
// body to arrive before closing the request, so this
// test might take some time.
test('Bad content length', t => {
  t.plan(2)

  function handler (req, res) {
    const body = JSON.stringify({ hello: 'world' })
    res.setHeader('Content-Type', 'application/json;utf=8')
    res.setHeader('Content-Length', body.length + '')
    res.end(body.slice(0, -5))
  }

  buildServer(handler, ({ port }, server) => {
    const connection = new Connection({
      url: new URL(`http://localhost:${port}`)
    })

    connection.request({
      method: 'GET',
      path: '/'
    }).then(t.fail).catch(err => {
      t.ok(err instanceof ConnectionError)
      t.is(err.message, 'Response aborted while reading the body')
      server.stop()
    })
  })
})

test('Socket destryed while reading the body', t => {
  t.plan(2)

  function handler (req, res) {
    const body = JSON.stringify({ hello: 'world' })
    res.setHeader('Content-Type', 'application/json;utf=8')
    res.setHeader('Content-Length', body.length + '')
    res.write(body.slice(0, -5))
    setTimeout(() => {
      res.socket.destroy()
    }, 500)
  }

  buildServer(handler, ({ port }, server) => {
    const connection = new Connection({
      url: new URL(`http://localhost:${port}`)
    })

    connection.request({
      method: 'GET',
      path: '/'
    }).then(t.fail).catch(err => {
      t.ok(err instanceof ConnectionError)
      t.is(err.message, 'Response aborted while reading the body')
      server.stop()
    })
  })
})

test('Content length too big (buffer)', t => {
  t.plan(3)

  class MyConnection extends Connection {
    constructor (opts) {
      super(opts)
      this.makeRequest = () => {
        const stream = intoStream(JSON.stringify({ hello: 'world' }))
        stream.statusCode = 200
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
          on (event, cb) {
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

  connection.request({
    method: 'GET',
    path: '/'
  }).then(t.fail).catch(err => {
    t.ok(err instanceof RequestAbortedError)
    t.is(err.message, `The content length (${buffer.constants.MAX_LENGTH + 10}) is bigger than the maximum allowed buffer (${buffer.constants.MAX_LENGTH})`)
  })
})

test('Content length too big (string)', t => {
  t.plan(3)

  class MyConnection extends Connection {
    constructor (opts) {
      super(opts)
      this.makeRequest = () => {
        const stream = intoStream(JSON.stringify({ hello: 'world' }))
        stream.statusCode = 200
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
          on (event, cb) {
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

  connection.request({
    method: 'GET',
    path: '/'
  }).then(t.fail).catch(err => {
    t.ok(err instanceof RequestAbortedError)
    t.is(err.message, `The content length (${buffer.constants.MAX_STRING_LENGTH + 10}) is bigger than the maximum allowed string (${buffer.constants.MAX_STRING_LENGTH})`)
  })
})
