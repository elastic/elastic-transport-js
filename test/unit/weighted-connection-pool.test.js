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
const { URL } = require('url')
const WeightedConnectionPool = require('../../lib/pool/WeightedConnectionPool')
const Connection = require('../../lib/Connection')
const { defaultNodeFilter } = require('../../lib/Transport').internals

test('API', t => {
  t.test('addConnection', t => {
    const pool = new WeightedConnectionPool({ Connection })
    const href = 'http://localhost:9200/'
    pool.addConnection(href)
    t.ok(pool.connections[0] instanceof Connection)
    t.end()
  })

  t.test('update should change the connections array in an immutable fashion', t => {
    const pool = new WeightedConnectionPool({ Connection })

    t.strictEqual(pool.size, 0)

    pool.update([
      pool.urlToHost('http://localhost:9200'),
      pool.urlToHost('http://localhost:9201'),
      pool.urlToHost('http://localhost:9202')
    ])

    t.strictEqual(pool.size, 3)

    t.end()
  })

  t.test('markDead', t => {
    const pool = new WeightedConnectionPool({ Connection })
    const connection = pool.addConnection('http://localhost:9200/')
    pool.addConnection('http://localhost:9201/')

    pool.markDead(connection)
    t.strictEqual(connection.weight, 491)
    t.strictEqual(connection.status, Connection.statuses.DEAD)
    t.strictEqual(pool.maxWeight, 500)
    t.strictEqual(pool.greatestCommonDivisor, 1)
    t.end()
  })

  t.test('markAlive', t => {
    const pool = new WeightedConnectionPool({ Connection })
    const connection = pool.addConnection('http://localhost:9200/')
    pool.addConnection('http://localhost:9201/')

    pool.markDead(connection)
    pool.markAlive(connection)

    t.strictEqual(connection.weight, 500)
    t.strictEqual(pool.maxWeight, 500)
    t.strictEqual(pool.greatestCommonDivisor, 500)
    t.strictEqual(connection.status, Connection.statuses.ALIVE)

    t.end()
  })

  t.test('getConnection', t => {
    t.test('Should return a connection', t => {
      const pool = new WeightedConnectionPool({ Connection })
      pool.addConnection('http://localhost:9200/')
      t.ok(pool.getConnection() instanceof Connection)
      t.end()
    })

    // TODO: test the nodes distribution with different weights
    t.test('Connection distribution', t => {
      t.test('3 Connections, same weight', t => {
        const pool = new WeightedConnectionPool({ Connection })
        pool.addConnection([
          'http://localhost:9200/',
          'http://localhost:9201/',
          'http://localhost:9202/'
        ])

        try {
          for (let i = 0; i < 1000; i++) {
            for (let j = 0; j < 3; j++) {
              if (pool.getConnection().id !== `http://localhost:920${j}/`) {
                throw new Error('Wrong distribution')
              }
            }
          }
          t.pass('Distribution is ok')
        } catch (err) {
          t.error(err)
        }

        t.end()
      })

      // t.test('3 Connections, 1 dead 1 time', t => {
      //   const pool = new WeightedConnectionPool({ Connection })
      //   pool.addConnection([
      //     'http://localhost:9200/',
      //     'http://localhost:9201/',
      //     'http://localhost:9202/'
      //   ])

      //   pool.markDead(pool.connections[1])

      //   // with thid distribution we expect
      //   // to see the dead connection every 7 gets
      //   try {
      //     var foundAt = 0
      //     for (var i = 0; i < 1000; i++) {
      //       const connection = pool.getConnection()
      //       if (connection.id === 'http://localhost:9201/' && foundAt === 0) {
      //         foundAt = i
      //       }
      //       if (connection.id === 'http://localhost:9201/') {
      //         if (foundAt !== i) throw new Error('Wrong distribution')
      //         foundAt += 7
      //       }
      //     }
      //     t.pass('Distribution is ok')
      //   } catch (err) {
      //     t.error(err)
      //   }

      //   t.end()
      // })

      // t.test('3 Connections, 1 dead 2 time', t => {
      //   const pool = new WeightedConnectionPool({ Connection })
      //   pool.addConnection([
      //     'http://localhost:9200/',
      //     'http://localhost:9201/',
      //     'http://localhost:9202/'
      //   ])

      //   pool.markDead(pool.connections[1])
      //   pool.markDead(pool.connections[1])

      //   // with thid distribution we expect
      //   // to see the dead connection every 4 times in 10 gets
      //   try {
      //     for (var i = 0; i < 100; i++) {
      //       const connection = pool.getConnection()
      //       if (connection.id === 'http://localhost:9201/') {
      //         if (i !== 59 && i !== 62 && i !== 65 && i !== 68) {
      //           throw new Error('Wrong distribution')
      //         }
      //       }
      //     }
      //     t.pass('Distribution is ok')
      //   } catch (err) {
      //     t.error(err)
      //   }

      //   t.end()
      // })

      t.test('3 Connections, 3 weights', t => {
        const pool = new WeightedConnectionPool({ Connection })
        pool.addConnection([
          'http://localhost:9200/',
          'http://localhost:9201/',
          'http://localhost:9202/'
        ])

        pool.connections[0].weight = 4
        pool.connections[0].id = 'A'

        pool.connections[1].weight = 3
        pool.connections[1].id = 'B'

        pool.connections[2].weight = 2
        pool.connections[2].id = 'C'

        pool.maxWeight = 4
        pool.greatestCommonDivisor = 1

        const arr = []
        for (let i = 0; i < 9; i++) arr.push(pool.getConnection().id)

        t.deepEqual(arr, ['A', 'A', 'B', 'A', 'B', 'C', 'A', 'B', 'C'])

        t.end()
      })

      t.end()
    })

    t.test('It should not enter in an infinite loop', t => {
      const pool = new WeightedConnectionPool({ Connection })
      pool.addConnection([
        'http://localhost:9200/',
        'http://localhost:9201/',
        'http://localhost:9202/'
      ])

      const filter = () => false

      t.strictEqual(pool.getConnection({ filter }), null)

      t.end()
    })

    t.test('filter option', t => {
      const pool = new WeightedConnectionPool({ Connection })
      const href1 = 'http://localhost:9200/'
      const href2 = 'http://localhost:9200/other'
      pool.addConnection([href1, href2])

      const filter = node => node.id === href2
      t.strictEqual(pool.getConnection({ filter }).id, href2)
      t.end()
    })

    t.test('filter should get Connection objects', t => {
      t.plan(1)
      const pool = new WeightedConnectionPool({ Connection })
      const href1 = 'http://localhost:9200/'
      const href2 = 'http://localhost:9200/other'
      pool.addConnection([href1, href2])

      const filter = node => {
        t.ok(node instanceof Connection)
        return true
      }
      pool.getConnection({ filter })
    })

    t.test('filter should get alive connection first', t => {
      t.plan(2)
      const pool = new WeightedConnectionPool({ Connection })
      const href1 = 'http://localhost:9200/'
      const href2 = 'http://localhost:9200/other'
      pool.addConnection([href1, href2])
      pool.markDead(pool.connections[0])

      const filter = node => {
        t.strictEqual(node.id, href2)
        t.strictEqual(node.weight, 500)
        return true
      }
      pool.getConnection({ filter })
    })

    t.end()
  })

  t.test('removeConnection', t => {
    t.test('Single node', t => {
      const pool = new WeightedConnectionPool({ Connection })
      const connection = pool.addConnection('http://localhost:9200/')
      t.ok(pool.getConnection() instanceof Connection)
      pool.removeConnection(connection)
      t.strictEqual(pool.getConnection(), null)
      t.end()
    })

    // TODO: redistribute the max weight
    // t.test('Should recalculate max and gcd', t => {
    //   const pool = new WeightedConnectionPool({ Connection })
    //   pool.addConnection([
    //     'http://localhost:9200/',
    //     'http://localhost:9201/',
    //     'http://localhost:9202/'
    //   ])

    //   t.strictEqual(pool.maxWeight, 33)
    //   t.strictEqual(pool.greatestCommonDivisor, 33)

    //   pool.removeConnection(pool.connections[0])

    //   t.strictEqual(pool.maxWeight, 50)
    //   t.strictEqual(pool.greatestCommonDivisor, 50)

    //   t.end()
    // })

    t.end()
  })

  t.test('empty', t => {
    const pool = new WeightedConnectionPool({ Connection })
    pool.addConnection('http://localhost:9200/')
    pool.addConnection('http://localhost:9201/')
    pool.empty(() => {
      t.deepEqual(pool.connections, [])
      t.strictEqual(pool.size, 0)
      t.strictEqual(pool.maxWeight, 0)
      t.strictEqual(pool.greatestCommonDivisor, 0)
      t.strictEqual(pool.index, -1)
      t.strictEqual(pool.currentWeight, 0)
      t.end()
    })
  })

  t.test('urlToHost', t => {
    const pool = new WeightedConnectionPool({ Connection })
    const url = 'http://localhost:9200'
    t.deepEqual(
      pool.urlToHost(url),
      { url: new URL(url) }
    )
    t.end()
  })

  t.test('nodesToHost', t => {
    t.test('publish_address as ip address (IPv4)', t => {
      const pool = new WeightedConnectionPool({ Connection })
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

      t.deepEqual(pool.nodesToHost(nodes, 'http:'), [{
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        roles: {
          master: true,
          data: true,
          ingest: true,
          ml: false
        }
      }, {
        url: new URL('http://127.0.0.1:9201'),
        id: 'a2',
        roles: {
          master: true,
          data: true,
          ingest: true,
          ml: false
        }
      }])

      t.strictEqual(pool.nodesToHost(nodes, 'http:')[0].url.host, '127.0.0.1:9200')
      t.strictEqual(pool.nodesToHost(nodes, 'http:')[1].url.host, '127.0.0.1:9201')
      t.end()
    })

    t.test('publish_address as ip address (IPv6)', t => {
      const pool = new WeightedConnectionPool({ Connection })
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

      t.deepEqual(pool.nodesToHost(nodes, 'http:'), [{
        url: new URL('http://[::1]:9200'),
        id: 'a1',
        roles: {
          master: true,
          data: true,
          ingest: true,
          ml: false
        }
      }, {
        url: new URL('http://[::1]:9201'),
        id: 'a2',
        roles: {
          master: true,
          data: true,
          ingest: true,
          ml: false
        }
      }])

      t.strictEqual(pool.nodesToHost(nodes, 'http:')[0].url.host, '[::1]:9200')
      t.strictEqual(pool.nodesToHost(nodes, 'http:')[1].url.host, '[::1]:9201')
      t.end()
    })

    t.test('publish_address as host/ip (IPv4)', t => {
      const pool = new WeightedConnectionPool({ Connection })
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

      t.deepEqual(pool.nodesToHost(nodes, 'http:'), [{
        url: new URL('http://example.com:9200'),
        id: 'a1',
        roles: {
          master: true,
          data: true,
          ingest: true,
          ml: false
        }
      }, {
        url: new URL('http://example.com:9201'),
        id: 'a2',
        roles: {
          master: true,
          data: true,
          ingest: true,
          ml: false
        }
      }])

      t.strictEqual(pool.nodesToHost(nodes, 'http:')[0].url.host, 'example.com:9200')
      t.strictEqual(pool.nodesToHost(nodes, 'http:')[1].url.host, 'example.com:9201')
      t.end()
    })

    t.test('publish_address as host/ip (IPv6)', t => {
      const pool = new WeightedConnectionPool({ Connection })
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

      t.deepEqual(pool.nodesToHost(nodes, 'http:'), [{
        url: new URL('http://example.com:9200'),
        id: 'a1',
        roles: {
          master: true,
          data: true,
          ingest: true,
          ml: false
        }
      }, {
        url: new URL('http://example.com:9201'),
        id: 'a2',
        roles: {
          master: true,
          data: true,
          ingest: true,
          ml: false
        }
      }])

      t.strictEqual(pool.nodesToHost(nodes, 'http:')[0].url.host, 'example.com:9200')
      t.strictEqual(pool.nodesToHost(nodes, 'http:')[1].url.host, 'example.com:9201')
      t.end()
    })

    t.test('Should use the configure protocol', t => {
      const pool = new WeightedConnectionPool({ Connection })
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

      t.strictEqual(pool.nodesToHost(nodes, 'https:')[0].url.protocol, 'https:')
      t.strictEqual(pool.nodesToHost(nodes, 'http:')[1].url.protocol, 'http:')
      t.end()
    })

    t.end()
  })

  t.test('update', t => {
    t.test('Should not update existing connections', t => {
      t.plan(2)
      const pool = new WeightedConnectionPool({ Connection })

      pool.addConnection([{
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        roles: {
          master: true,
          data: true,
          ingest: true
        }
      }, {
        url: new URL('http://127.0.0.1:9201'),
        id: 'a2',
        roles: {
          master: true,
          data: true,
          ingest: true
        }
      }])

      pool.update([{
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        roles: null
      }, {
        url: new URL('http://127.0.0.1:9201'),
        id: 'a2',
        roles: null
      }])

      t.ok(pool.connections[0].roles !== null)
      t.ok(pool.connections[1].roles !== null)
    })

    t.test('Should not update existing connections (mark alive)', t => {
      t.plan(5)
      class CustomWeightedConnectionPool extends WeightedConnectionPool {
        markAlive (connection) {
          t.ok('called')
          super.markAlive(connection)
        }
      }
      const pool = new CustomWeightedConnectionPool({ Connection })
      const conn1 = pool.addConnection({
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        roles: {
          master: true,
          data: true,
          ingest: true
        }
      })

      const conn2 = pool.addConnection({
        url: new URL('http://127.0.0.1:9201'),
        id: 'a2',
        roles: {
          master: true,
          data: true,
          ingest: true
        }
      })

      pool.markDead(conn1)
      pool.markDead(conn2)

      pool.update([{
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        roles: null
      }, {
        url: new URL('http://127.0.0.1:9201'),
        id: 'a2',
        roles: null
      }])

      t.ok(pool.connections[0].roles !== null)
      t.ok(pool.connections[1].roles !== null)
    })

    t.test('Should not update existing connections (same url, different id)', t => {
      t.plan(3)
      const pool = new WeightedConnectionPool({ Connection })

      pool.addConnection({
        url: new URL('http://127.0.0.1:9200'),
        id: 'http://127.0.0.1:9200/',
        roles: {
          master: true,
          data: true,
          ingest: true
        }
      })

      pool.update([{
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        roles: true
      }])

      // roles will never be updated, we only use it to do
      // a dummy check to see if the connection has been updated
      t.deepEqual(pool.connections[0].roles, {
        master: true,
        data: true,
        ingest: true,
        ml: false
      })
      t.strictEqual(pool.connections[0].id, 'a1')
      t.strictEqual(pool.size, 1)
    })

    t.test('Add a new connection', t => {
      t.plan(2)
      const pool = new WeightedConnectionPool({ Connection })
      pool.addConnection({
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        roles: {
          master: true,
          data: true,
          ingest: true
        }
      })

      pool.update([{
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        roles: null
      }, {
        url: new URL('http://127.0.0.1:9201'),
        id: 'a2',
        roles: null
      }])

      t.ok(pool.connections[0].roles !== null)
      t.strictEqual(pool.size, 2)
    })

    t.test('Remove old connections', t => {
      t.plan(3)
      const pool = new WeightedConnectionPool({ Connection })
      pool.addConnection({
        url: new URL('http://127.0.0.1:9200'),
        id: 'a1',
        roles: null
      })

      pool.update([{
        url: new URL('http://127.0.0.1:9200'),
        id: 'a2',
        roles: null
      }, {
        url: new URL('http://127.0.0.1:9201'),
        id: 'a3',
        roles: null
      }])

      t.strictEqual(pool.connections[0].id, 'a2')
      t.strictEqual(pool.connections[1].id, 'a3')
      t.strictEqual(pool.size, 2)
    })

    t.end()
  })

  t.end()
})

test('Node filter', t => {
  t.test('default', t => {
    t.plan(1)
    const pool = new WeightedConnectionPool({ Connection })
    pool.addConnection({ url: new URL('http://localhost:9200/') })
    t.true(pool.getConnection({ filter: defaultNodeFilter }) instanceof Connection)
  })

  t.test('Should filter master only nodes', t => {
    t.plan(1)
    const pool = new WeightedConnectionPool({ Connection })
    pool.addConnection({
      id: 'master',
      url: new URL('http://localhost:9200/'),
      roles: {
        master: true,
        data: false,
        ingest: false,
        ml: false
      }
    })
    pool.addConnection({
      id: 'data',
      url: new URL('http://localhost:9201/'),
      roles: {
        master: false,
        data: true,
        ingest: false,
        ml: false
      }
    })

    t.strictEqual(pool.getConnection({ filter: defaultNodeFilter }).id, 'data')
  })

  t.end()
})

test('Single node behavior', t => {
  const pool = new WeightedConnectionPool({ Connection, sniffEnabled: false })
  const conn = pool.addConnection('http://localhost:9200/')
  pool.markDead(conn)
  t.strictEqual(conn.weight, 1000)
  pool.markAlive(conn)
  t.strictEqual(conn.weight, 1000)

  t.end()
})
