/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import {
  WeightedConnectionPool,
  HttpConnection,
  BaseConnection,
  Connection
} from '../..'

const opts = {
  now: Date.now() + 1000 * 60 * 3,
  requestId: 1,
  name: 'elasticsearch-js',
  context: null
}

test('API', t => {
  t.test('markDead', t => {
    const pool = new WeightedConnectionPool({ Connection: HttpConnection })
    pool.addConnection('http://localhost:9200/')
    pool.addConnection('http://localhost:9201/')

    pool.markDead(pool.connections[0])
    t.equal(pool.connections[0].weight, 491)
    t.equal(pool.connections[0].status, BaseConnection.statuses.DEAD)
    t.equal(pool.maxWeight, 500)
    t.equal(pool.greatestCommonDivisor, 1)
    t.end()
  })

  t.test('markAlive', t => {
    const pool = new WeightedConnectionPool({ Connection: HttpConnection })
    pool.addConnection('http://localhost:9200/')
    pool.addConnection('http://localhost:9201/')

    pool.markDead(pool.connections[0])
    pool.markAlive(pool.connections[0])

    t.equal(pool.connections[0].weight, 500)
    t.equal(pool.maxWeight, 500)
    t.equal(pool.greatestCommonDivisor, 500)
    t.equal(pool.connections[0].status, BaseConnection.statuses.ALIVE)

    t.end()
  })

  t.test('getConnection', t => {
    t.test('Should return a connection', t => {
      const pool = new WeightedConnectionPool({ Connection: HttpConnection })
      pool.addConnection('http://localhost:9200/')
      t.ok(pool.getConnection(opts) instanceof HttpConnection)
      t.end()
    })

    // TODO: test the nodes distribution with different weights
    t.test('Connection distribution', t => {
      t.test('3 Connections, same weight', t => {
        const pool = new WeightedConnectionPool({ Connection: HttpConnection })
        pool.addConnection([
          'http://localhost:9200/',
          'http://localhost:9201/',
          'http://localhost:9202/'
        ])

        try {
          for (let i = 0; i < 1000; i++) {
            for (let j = 0; j < 3; j++) {
              if (pool.getConnection(opts)?.id !== `http://localhost:920${j}/`) {
                throw new Error('Wrong distribution')
              }
            }
          }
          t.pass('Distribution is ok')
        } catch (err: any) {
          t.error(err)
        }

        t.end()
      })

      // t.test('3 Connections, 1 dead 1 time', t => {
      //   const pool = new WeightedConnectionPool({ Connection: HttpConnection })
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
      //   } catch (err: any) {
      //     t.error(err)
      //   }

      //   t.end()
      // })

      // t.test('3 Connections, 1 dead 2 time', t => {
      //   const pool = new WeightedConnectionPool({ Connection: HttpConnection })
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
      //   } catch (err: any) {
      //     t.error(err)
      //   }

      //   t.end()
      // })

      t.test('3 Connections, 3 weights', t => {
        const pool = new WeightedConnectionPool({ Connection: HttpConnection })
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
        for (let i = 0; i < 9; i++) arr.push(pool.getConnection(opts)?.id)

        t.same(arr, ['A', 'A', 'B', 'A', 'B', 'C', 'A', 'B', 'C'])

        t.end()
      })

      t.end()
    })

    t.test('It should not enter in an infinite loop', t => {
      const pool = new WeightedConnectionPool({ Connection: HttpConnection })
      pool.addConnection([
        'http://localhost:9200/',
        'http://localhost:9201/',
        'http://localhost:9202/'
      ])

      const filter = (node: Connection): boolean => false

      t.equal(pool.getConnection({ ...opts, filter }), null)

      t.end()
    })

    t.test('filter option', t => {
      const pool = new WeightedConnectionPool({ Connection: HttpConnection })
      const href1 = 'http://localhost:9200/'
      const href2 = 'http://localhost:9200/other'
      pool.addConnection([href1, href2])

      const filter = (node: Connection): boolean => node.id === href2
      t.equal(pool.getConnection({ ...opts, filter })?.id, href2)
      t.end()
    })

    t.test('filter should get Connection objects', t => {
      t.plan(1)
      const pool = new WeightedConnectionPool({ Connection: HttpConnection })
      const href1 = 'http://localhost:9200/'
      const href2 = 'http://localhost:9200/other'
      pool.addConnection([href1, href2])

      const filter = (node: Connection): boolean => {
        t.ok(node instanceof HttpConnection)
        return true
      }
      pool.getConnection({ ...opts, filter })
    })

    t.test('filter should get alive connection first', t => {
      t.plan(2)
      const pool = new WeightedConnectionPool({ Connection: HttpConnection })
      const href1 = 'http://localhost:9200/'
      const href2 = 'http://localhost:9200/other'
      pool.addConnection([href1, href2])
      pool.markDead(pool.connections[0])

      const filter = (node: Connection): boolean => {
        t.equal(node.id, href2)
        t.equal(node.weight, 500)
        return true
      }
      pool.getConnection({ ...opts, filter })
    })

    t.end()
  })

  t.test('empty', async t => {
    const pool = new WeightedConnectionPool({ Connection: HttpConnection })
    pool.addConnection('http://localhost:9200/')
    pool.addConnection('http://localhost:9201/')
    await pool.empty()
    t.same(pool.connections, [])
    t.equal(pool.size, 0)
    t.equal(pool.maxWeight, 0)
    t.equal(pool.greatestCommonDivisor, 0)
    t.equal(pool.index, -1)
    t.equal(pool.currentWeight, 0)
    t.end()
  })

  t.end()
})

test('Single node behavior', t => {
  const pool = new WeightedConnectionPool({ Connection: HttpConnection })
  pool.addConnection('http://localhost:9200/')
  pool.markDead(pool.connections[0])
  t.equal(pool.connections[0].weight, 1000)
  pool.markAlive(pool.connections[0])
  t.equal(pool.connections[0].weight, 1000)

  t.end()
})
