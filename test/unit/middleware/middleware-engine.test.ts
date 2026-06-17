/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import { MiddlewareEngine, MiddlewareException } from '../../../src/middleware/MiddlewareEngine'
import { Middleware, MiddlewareContext, MiddlewareName, MiddlewarePriority } from '../../../src/middleware/types'
import { TransportResult } from '../../../src/types'

function createMockContext (): MiddlewareContext {
  return {
    request: {
      method: 'GET',
      path: '/test',
      headers: {}
    },
    params: {
      method: 'GET',
      path: '/test'
    },
    options: {},
    meta: {
      requestId: 1,
      name: 'test',
      context: null,
      connection: null,
      attempts: 0
    }
  }
}

function createMockResult (overrides: Partial<TransportResult> = {}): TransportResult {
  return {
    body: {},
    statusCode: 200,
    headers: {
      'x-elastic-product': 'Elasticsearch'
    },
    meta: {
      context: null,
      request: {
        params: { method: 'GET', path: '/test' },
        options: {},
        id: 1
      },
      name: 'test',
      connection: null,
      attempts: 0,
      aborted: false
    },
    warnings: null,
    ...overrides
  }
}

test('MiddlewareEngine', async t => {
  await t.test('executes registered middleware', async t => {
    const engine = new MiddlewareEngine()
    let called = false

    const middleware: Middleware = {
      name: MiddlewareName.PRODUCT_CHECK,
      priority: MiddlewarePriority[MiddlewareName.PRODUCT_CHECK],
      onResponse: () => {
        called = true
      }
    }

    engine.register(middleware)
    engine.executeOnResponse(createMockContext(), createMockResult())

    t.equal(called, true, 'middleware should be called')
  })

  await t.test('executes middleware in priority order', async t => {
    const engine = new MiddlewareEngine()
    const order: string[] = []

    const lowPriority: Middleware = {
      name: MiddlewareName.PRODUCT_CHECK,
      priority: 100,
      onResponse: () => {
        order.push('low')
      }
    }

    const highPriority: Middleware = {
      name: MiddlewareName.PRODUCT_CHECK,
      priority: 10,
      onResponse: () => {
        order.push('high')
      }
    }

    engine.register(lowPriority)
    engine.register(highPriority)
    engine.executeOnResponse(createMockContext(), createMockResult())

    t.same(order, ['high', 'low'], 'middleware should execute in priority order')
  })

  await t.test('stops execution when continue is false', async t => {
    const engine = new MiddlewareEngine()
    let secondCalled = false

    const first: Middleware = {
      name: MiddlewareName.PRODUCT_CHECK,
      priority: 10,
      onResponse: () => {
        return { continue: false }
      }
    }

    const second: Middleware = {
      name: MiddlewareName.PRODUCT_CHECK,
      priority: 20,
      onResponse: () => {
        secondCalled = true
      }
    }

    engine.register(first)
    engine.register(second)
    engine.executeOnResponse(createMockContext(), createMockResult())

    t.equal(secondCalled, false, 'second middleware should not be called')
  })

  await t.test('skips middleware without handler', async t => {
    const engine = new MiddlewareEngine()
    let called = false

    const withoutHandler: Middleware = {
      name: MiddlewareName.PRODUCT_CHECK,
      priority: 10
    }

    const withHandler: Middleware = {
      name: MiddlewareName.PRODUCT_CHECK,
      priority: 20,
      onResponse: () => {
        called = true
      }
    }

    engine.register(withoutHandler)
    engine.register(withHandler)
    engine.executeOnResponse(createMockContext(), createMockResult())

    t.equal(called, true, 'middleware with handler should still be called')
  })

  await t.test('wraps non-transport errors in MiddlewareException', async t => {
    const engine = new MiddlewareEngine()

    const middleware: Middleware = {
      name: MiddlewareName.PRODUCT_CHECK,
      priority: 50,
      onResponse: () => {
        throw new Error('Something went wrong')
      }
    }

    engine.register(middleware)

    try {
      engine.executeOnResponse(createMockContext(), createMockResult())
      t.fail('should throw')
    } catch (err: any) {
      t.ok(err instanceof MiddlewareException, 'should be MiddlewareException')
      t.ok(err.message.includes('product-check'), 'should include middleware name')
      t.ok(err.message.includes('onResponse'), 'should include phase name')
      t.ok(err.cause instanceof Error, 'should have original error as cause')
    }
  })
})

test('MiddlewareEngine.run (around chain)', async t => {
  await t.test('wraps the request as an onion in priority order', async t => {
    const engine = new MiddlewareEngine()
    const order: string[] = []

    engine.register({
      name: MiddlewareName.PRODUCT_CHECK,
      priority: 50,
      around: async (_ctx, next) => { order.push('inner-before'); const r = await next(); order.push('inner-after'); return r }
    })
    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      around: async (_ctx, next) => { order.push('outer-before'); const r = await next(); order.push('outer-after'); return r }
    })

    const result = createMockResult()
    const out = await engine.run(createMockContext(), async () => { order.push('run'); return result })

    t.same(order, ['outer-before', 'inner-before', 'run', 'inner-after', 'outer-after'])
    t.equal(out, result, 'returns the inner result')
  })

  await t.test('runs the request directly when no around handler is registered', async t => {
    const engine = new MiddlewareEngine()
    engine.register({ name: MiddlewareName.PRODUCT_CHECK, priority: 50, onResponse: () => {} })

    const result = createMockResult()
    t.equal(await engine.run(createMockContext(), async () => result), result)
  })

  await t.test('propagates errors from the request unchanged', async t => {
    const engine = new MiddlewareEngine()
    engine.register({ name: MiddlewareName.OPEN_TELEMETRY, priority: 10, around: async (_ctx, next) => await next() })

    const error = new Error('boom')
    try {
      await engine.run(createMockContext(), async () => { throw error })
      t.fail('should throw')
    } catch (err) {
      t.equal(err, error, 'error is not wrapped')
    }
  })
})

