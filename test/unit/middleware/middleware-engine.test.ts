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
    },
    state: new Map()
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
    engine.executePhase('onResponse', createMockContext(), createMockResult())

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
    engine.executePhase('onResponse', createMockContext(), createMockResult())

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
    engine.executePhase('onResponse', createMockContext(), createMockResult())

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
    engine.executePhase('onResponse', createMockContext(), createMockResult())

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
      engine.executePhase('onResponse', createMockContext(), createMockResult())
      t.fail('should throw')
    } catch (err: any) {
      t.ok(err instanceof MiddlewareException, 'should be MiddlewareException')
      t.ok(err.message.includes('product-check'), 'should include middleware name')
      t.ok(err.message.includes('onResponse'), 'should include phase name')
      t.ok(err.cause instanceof Error, 'should have original error as cause')
    }
  })
})

test('MiddlewareEngine lifecycle phases', async t => {
  await t.test('executeBeforeRequest runs onBeforeRequest handlers in priority order', async t => {
    const engine = new MiddlewareEngine()
    const order: string[] = []

    engine.register({
      name: MiddlewareName.PRODUCT_CHECK,
      priority: 50,
      onBeforeRequest: async () => { order.push('low') }
    })
    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      onBeforeRequest: () => { order.push('high') }
    })

    await engine.executeBeforeRequest(createMockContext())

    t.same(order, ['high', 'low'], 'handlers run in priority order, supporting sync and async')
  })

  await t.test('executeOnComplete passes context and result to handlers', async t => {
    const engine = new MiddlewareEngine()
    let received: any = null

    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      onComplete: (ctx, result) => { received = { ctx, result } }
    })

    const ctx = createMockContext()
    const result = createMockResult()
    await engine.executeOnComplete(ctx, result)

    t.equal(received.ctx, ctx, 'context is forwarded')
    t.equal(received.result, result, 'result is forwarded')
  })

  await t.test('executeOnError passes context, error and result to handlers', async t => {
    const engine = new MiddlewareEngine()
    let received: { error: Error, result: any } | null = null

    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      onError: (_ctx, error, result) => { received = { error, result } }
    })

    const error = new Error('boom')
    const result = createMockResult()
    await engine.executeOnError(createMockContext(), error, result)

    t.equal(received!.error, error, 'error is forwarded')
    t.equal(received!.result, result, 'result is forwarded')
  })

  await t.test('skips middleware that do not implement the phase', async t => {
    const engine = new MiddlewareEngine()
    let called = false

    engine.register({ name: MiddlewareName.PRODUCT_CHECK, priority: 50 })
    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      onComplete: () => { called = true }
    })

    await engine.executeOnComplete(createMockContext(), createMockResult())

    t.equal(called, true, 'middleware implementing the phase is still called')
  })

  await t.test('wraps non-transport errors thrown in executeBeforeRequest', async t => {
    const engine = new MiddlewareEngine()

    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      onBeforeRequest: () => { throw new Error('setup failed') }
    })

    try {
      await engine.executeBeforeRequest(createMockContext())
      t.fail('should throw')
    } catch (err: any) {
      t.ok(err instanceof MiddlewareException, 'should be MiddlewareException')
      t.ok(err.message.includes('onBeforeRequest'), 'should include phase name')
      t.ok(err.cause instanceof Error, 'should preserve original error as cause')
    }
  })

  await t.test('wraps non-transport errors thrown in executeOnComplete', async t => {
    const engine = new MiddlewareEngine()

    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      onComplete: () => { throw new Error('complete failed') }
    })

    try {
      await engine.executeOnComplete(createMockContext(), createMockResult())
      t.fail('should throw')
    } catch (err: any) {
      t.ok(err instanceof MiddlewareException, 'should be MiddlewareException')
      t.ok(err.message.includes('onComplete'), 'should include phase name')
    }
  })
})

