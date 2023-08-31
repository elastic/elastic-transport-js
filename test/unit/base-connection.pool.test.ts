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
import {
  BaseConnectionPool,
  BaseConnection,
  HttpConnection,
  Connection,
  Diagnostic,
  errors
} from '../../'
import { kCaFingerprint } from '../../lib/symbols'
const { ConfigurationError } = errors

test('configure diagnostic', t => {
  const diagnostic = new Diagnostic()
  const pool = new BaseConnectionPool({ Connection: HttpConnection, diagnostic })

  t.ok(pool.diagnostic === diagnostic)
  t.end()
})

test('API', t => {
  t.test('addConnection', t => {
    const pool = new BaseConnectionPool({ Connection: HttpConnection })
    const href = 'http://localhost:9200/'
    pool.addConnection(href)
    t.ok(pool.connections.find(c => c.id === href) instanceof HttpConnection)
    t.equal(pool.connections.find(c => c.id === href)?.status, BaseConnection.statuses.ALIVE)
    t.end()
  })

  t.test('addConnection with auth', t => {
    const pool = new BaseConnectionPool({ Connection: HttpConnection, auth: { username: 'foo', password: 'bar' } })
    const href = 'http://localhost:9200/'
    pool.addConnection(href)
    t.ok(pool.connections.find(c => c.id === href) instanceof HttpConnection)
    t.same(pool.connections.find(c => c.id === href)?.headers, { authorization: 'Basic Zm9vOmJhcg==' })
    t.end()
  })

  t.test('addConnection should throw with two connections with the same id', t => {
    const pool = new BaseConnectionPool({ Connection: HttpConnection })
    const href = 'http://localhost:9200/'
    pool.addConnection(href)
    try {
      pool.addConnection(href)
      t.fail('Should throw')
    } catch (err: any) {
      t.equal(err.message, `Connection with id '${href}' is already present`)
    }
    t.end()
  })

  t.test('addConnection should handle not-friendly url parameters for user and password', t => {
    const pool = new BaseConnectionPool({ Connection: HttpConnection })
    const href = 'http://us"er:p@assword@localhost:9200/'
    pool.addConnection(href)
    const conn = pool.connections[0]
    t.equal(conn.url.username, 'us%22er')
    t.equal(conn.url.password, 'p%40assword')
    t.equal(conn.headers.authorization, 'Basic ' + Buffer.from('us"er:p@assword').toString('base64'))
    t.end()
  })

  t.test('getConnection should throw', t => {
    const pool = new BaseConnectionPool({ Connection: HttpConnection })
    const href = 'http://localhost:9200/'
    pool.addConnection(href)
    try {
      // @ts-expect-error
      pool.getConnection()
      t.fail('Should fail')
    } catch (err: any) {
      t.ok(err instanceof ConfigurationError)
    }
    t.end()
  })

  t.test('removeConnection', t => {
    const pool = new BaseConnectionPool({ Connection: HttpConnection })
    const href = 'http://localhost:9200/'
    pool.addConnection(href)
    pool.removeConnection(pool.connections[0])
    t.equal(pool.size, 0)
    t.end()
  })

  t.test('empty', async t => {
    t.plan(1)
    const pool = new BaseConnectionPool({ Connection: HttpConnection })
    pool.addConnection('http://localhost:9200/')
    pool.addConnection('http://localhost:9201/')
    await pool.empty()
    t.equal(pool.size, 0)
  })

  t.test('urlToHost', t => {
    const pool = new BaseConnectionPool({ Connection: HttpConnection })
    const url = 'http://localhost:9200'
    t.same(
      pool.urlToHost(url),
      { url: new URL(url) }
    )
    t.end()
  })

  t.test('nodesToHost', t => {
    t.test('publish_address as ip address (IPv4)', t => {
      const pool = new BaseConnectionPool({ Connection: HttpConnection })
      const nodes = {
        a1: {
          http: {
            publish_address: '127.0.0.1:9200'
          },
          roles: ['master', 'data', 'ingest']
        },
        a2: {
          http: {
            publish_address: '127.0.0.1:9201'
          },
          roles: ['master', 'data', 'ingest']
        }
      }

      t.same(pool.nodesToHost(nodes, 'http:'), [{
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1'
      }, {
        url: new URL('http://127.0.0.1:9201'),
        id: 'a2'
      }])

      t.equal(pool.nodesToHost(nodes, 'http:')[0].url.host, '127.0.0.1:9200')
      t.equal(pool.nodesToHost(nodes, 'http:')[1].url.host, '127.0.0.1:9201')
      t.end()
    })

    t.test('publish_address as ip address (IPv6)', t => {
      const pool = new BaseConnectionPool({ Connection: HttpConnection })
      const nodes = {
        a1: {
          http: {
            publish_address: '[::1]:9200'
          },
          roles: ['master', 'data', 'ingest']
        },
        a2: {
          http: {
            publish_address: '[::1]:9201'
          },
          roles: ['master', 'data', 'ingest']
        }
      }

      t.same(pool.nodesToHost(nodes, 'http:'), [{
        url: new URL('http://[::1]:9200'),
        id: 'a1'
      }, {
        url: new URL('http://[::1]:9201'),
        id: 'a2'
      }])

      t.equal(pool.nodesToHost(nodes, 'http:')[0].url.host, '[::1]:9200')
      t.equal(pool.nodesToHost(nodes, 'http:')[1].url.host, '[::1]:9201')
      t.end()
    })

    t.test('publish_address as host/ip (IPv4)', t => {
      const pool = new BaseConnectionPool({ Connection: HttpConnection })
      const nodes = {
        a1: {
          http: {
            publish_address: 'example.com/127.0.0.1:9200'
          },
          roles: ['master', 'data', 'ingest']
        },
        a2: {
          http: {
            publish_address: 'example.com/127.0.0.1:9201'
          },
          roles: ['master', 'data', 'ingest']
        }
      }

      t.same(pool.nodesToHost(nodes, 'http:'), [{
        url: new URL('http://example.com:9200'),
        id: 'a1'
      }, {
        url: new URL('http://example.com:9201'),
        id: 'a2'
      }])

      t.equal(pool.nodesToHost(nodes, 'http:')[0].url.host, 'example.com:9200')
      t.equal(pool.nodesToHost(nodes, 'http:')[1].url.host, 'example.com:9201')
      t.end()
    })

    t.test('publish_address as host/ip (IPv6)', t => {
      const pool = new BaseConnectionPool({ Connection: HttpConnection })
      const nodes = {
        a1: {
          http: {
            publish_address: 'example.com/[::1]:9200'
          },
          roles: ['master', 'data', 'ingest']
        },
        a2: {
          http: {
            publish_address: 'example.com/[::1]:9201'
          },
          roles: ['master', 'data', 'ingest']
        }
      }

      t.same(pool.nodesToHost(nodes, 'http:'), [{
        url: new URL('http://example.com:9200'),
        id: 'a1'
      }, {
        url: new URL('http://example.com:9201'),
        id: 'a2'
      }])

      t.equal(pool.nodesToHost(nodes, 'http:')[0].url.host, 'example.com:9200')
      t.equal(pool.nodesToHost(nodes, 'http:')[1].url.host, 'example.com:9201')
      t.end()
    })

    t.test('Should use the configure protocol', t => {
      const pool = new BaseConnectionPool({ Connection: HttpConnection })
      const nodes = {
        a1: {
          http: {
            publish_address: 'example.com/127.0.0.1:9200'
          },
          roles: ['master', 'data', 'ingest']
        },
        a2: {
          http: {
            publish_address: 'example.com/127.0.0.1:9201'
          },
          roles: ['master', 'data', 'ingest']
        }
      }

      t.equal(pool.nodesToHost(nodes, 'https:')[0].url.protocol, 'https:')
      t.equal(pool.nodesToHost(nodes, 'http:')[1].url.protocol, 'http:')
      t.end()
    })

    t.test('Should skip nodes that do not have an http property yet', t => {
      const pool = new BaseConnectionPool({ Connection: HttpConnection })
      const nodes = {
        a1: {
          http: {
            publish_address: '127.0.0.1:9200'
          },
          roles: ['master', 'data', 'ingest']
        },
        a2: {
          roles: ['master', 'data', 'ingest']
        }
      }

      t.same(pool.nodesToHost(nodes, 'http:'), [{
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1'
      }])

      t.end()
    })

    t.end()
  })

  t.test('update', t => {
    t.test('Should not update existing connections', t => {
      t.plan(2)
      const pool = new BaseConnectionPool({ Connection: HttpConnection })
      pool.addConnection([{
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        timeout: 42
      }, {
        url: new URL('http://127.0.0.1:9201'),
        id: 'a2',
        timeout: 42
      }])

      pool.update([{
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        timeout: 100
      }, {
        url: new URL('http://127.0.0.1:9201'),
        id: 'a2',
        timeout: 100
      }])

      t.equal(pool.connections.find(c => c.id === 'a1')?.timeout, 42)
      t.equal(pool.connections.find(c => c.id === 'a2')?.timeout, 42)
    })

    t.test('Should not update existing connections (mark alive)', t => {
      t.plan(5)
      class CustomBaseConnectionPool extends BaseConnectionPool {
        markAlive (connection: Connection): this {
          t.ok('called')
          return super.markAlive(connection)
        }
      }
      const pool = new CustomBaseConnectionPool({ Connection: HttpConnection })
      pool.addConnection({
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        timeout: 42
      })

      pool.addConnection({
        url: new URL('http://127.0.0.1:9201'),
        id: 'a2',
        timeout: 42
      })

      pool.markDead(pool.connections[0])
      pool.markDead(pool.connections[1])

      pool.update([{
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        timeout: 100
      }, {
        url: new URL('http://127.0.0.1:9201'),
        id: 'a2',
        timeout: 100
      }])

      t.equal(pool.connections.find(c => c.id === 'a1')?.timeout, 42)
      t.equal(pool.connections.find(c => c.id === 'a2')?.timeout, 42)
    })

    t.test('Should not update existing connections (same url, different id)', t => {
      class CustomBaseConnectionPool extends BaseConnectionPool {
        markAlive (connection: Connection): this {
          t.ok('called')
          return super.markAlive(connection)
        }
      }
      const pool = new CustomBaseConnectionPool({ Connection: HttpConnection })
      pool.addConnection([{
        url: new URL('http://127.0.0.1:9200'),
        id: 'http://127.0.0.1:9200/',
        timeout: 42
      }])

      pool.update([{
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        timeout: 100
      }])

      // roles will never be updated, we only use it to do
      // a dummy check to see if the connection has been updated
      t.equal(pool.connections.find(c => c.id === 'a1')?.timeout, 42)
      t.equal(pool.connections.find(c => c.id === 'http://127.0.0.1:9200/'), undefined)
      t.end()
    })

    t.test('Add a new connection', t => {
      const pool = new BaseConnectionPool({ Connection: HttpConnection })
      pool.addConnection({
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        timeout: 42
      })

      pool.update([{
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        timeout: 100
      }, {
        url: new URL('http://127.0.0.1:9201'),
        id: 'a2',
        timeout: 100
      }])

      t.equal(pool.connections.find(c => c.id === 'a1')?.timeout, 42)
      t.ok(pool.connections.find(c => c.id === 'a2'))
      t.end()
    })

    t.test('Remove old connections', t => {
      const pool = new BaseConnectionPool({ Connection: HttpConnection })
      pool.addConnection({
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1'
      })

      pool.update([{
        url: new URL('http://127.0.0.1:9200'),
        id: 'a2'
      }, {
        url: new URL('http://127.0.0.1:9201'),
        id: 'a3'
      }])

      t.notOk(pool.connections.find(c => c.id === 'a1'))
      t.ok(pool.connections.find(c => c.id === 'a2'))
      t.ok(pool.connections.find(c => c.id === 'a3'))
      t.end()
    })

    t.end()
  })

  t.test('CreateConnection', t => {
    const pool = new BaseConnectionPool({ Connection: HttpConnection })
    const conn = pool.createConnection('http://localhost:9200')
    pool.connections.push(conn)
    try {
      pool.createConnection('http://localhost:9200')
      t.fail('Should throw')
    } catch (err: any) {
      t.equal(err.message, 'Connection with id \'http://localhost:9200/\' is already present')
    }
    t.end()
  })

  t.end()
})

test('configure caFingerprint', t => {
  const pool = new BaseConnectionPool({ Connection: HttpConnection, caFingerprint: 'FO:OB:AR' })
  const conn = pool.createConnection('http://localhost:9200')
  t.equal(conn[kCaFingerprint], 'FO:OB:AR')
  t.end()
})

