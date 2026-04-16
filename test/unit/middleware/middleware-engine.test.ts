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
  await t.test('executeOnResponse: executes registered middleware', async t => {
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

  await t.test('executeOnResponse: executes middleware in priority order', async t => {
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

  await t.test('executeOnResponse: stops execution when continue is false', async t => {
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

  await t.test('executeOnResponse: skips middleware without handler', async t => {
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

  await t.test('executeOnResponse: wraps non-transport errors in MiddlewareException', async t => {
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

  await t.test('executeBeforeRequest: calls handlers in priority order', async t => {
    const engine = new MiddlewareEngine()
    const order: string[] = []

    engine.register({
      name: MiddlewareName.PRODUCT_CHECK,
      priority: 100,
      onBeforeRequest: async () => { order.push('low') }
    })
    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      onBeforeRequest: async () => { order.push('high') }
    })

    await engine.executeBeforeRequest(createMockContext())

    t.same(order, ['high', 'low'], 'handlers run lowest priority number first')
  })

  await t.test('executeBeforeRequest: skips middleware without handler', async t => {
    const engine = new MiddlewareEngine()
    let called = false

    engine.register({ name: MiddlewareName.PRODUCT_CHECK, priority: 10 })
    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 20,
      onBeforeRequest: async () => { called = true }
    })

    await engine.executeBeforeRequest(createMockContext())

    t.equal(called, true, 'middleware with handler should be called')
  })

  await t.test('executeBeforeRequest: wraps non-transport errors in MiddlewareException', async t => {
    const engine = new MiddlewareEngine()

    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      onBeforeRequest: async () => { throw new Error('setup failed') }
    })

    try {
      await engine.executeBeforeRequest(createMockContext())
      t.fail('should throw')
    } catch (err: any) {
      t.ok(err instanceof MiddlewareException, 'should be MiddlewareException')
      t.ok(err.message.includes('opentelemetry'), 'should include middleware name')
      t.ok(err.message.includes('onBeforeRequest'), 'should include hook name')
      t.ok(err.cause instanceof Error, 'should have original error as cause')
    }
  })

  await t.test('executeOnError: calls handlers with the error', async t => {
    const engine = new MiddlewareEngine()
    const received: Error[] = []
    const sentinel = new Error('request failed')

    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      onError: async (_, err) => { received.push(err) }
    })

    await engine.executeOnError(createMockContext(), sentinel)

    t.equal(received.length, 1, 'handler called once')
    t.equal(received[0], sentinel, 'passes the original error')
  })

  await t.test('executeOnError: calls handlers in priority order', async t => {
    const engine = new MiddlewareEngine()
    const order: string[] = []

    engine.register({
      name: MiddlewareName.PRODUCT_CHECK,
      priority: 100,
      onError: async () => { order.push('low') }
    })
    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      onError: async () => { order.push('high') }
    })

    await engine.executeOnError(createMockContext(), new Error('fail'))

    t.same(order, ['high', 'low'])
  })

  await t.test('executeOnError: wraps non-transport errors in MiddlewareException', async t => {
    const engine = new MiddlewareEngine()

    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      onError: async () => { throw new Error('handler blew up') }
    })

    try {
      await engine.executeOnError(createMockContext(), new Error('original'))
      t.fail('should throw')
    } catch (err: any) {
      t.ok(err instanceof MiddlewareException, 'should be MiddlewareException')
      t.ok(err.message.includes('opentelemetry'), 'should include middleware name')
      t.ok(err.message.includes('onError'), 'should include hook name')
    }
  })

  await t.test('executeOnComplete: calls handlers with the result', async t => {
    const engine = new MiddlewareEngine()
    const received: TransportResult[] = []
    const mockResult = createMockResult()

    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      onComplete: async (_, result) => { received.push(result) }
    })

    await engine.executeOnComplete(createMockContext(), mockResult)

    t.equal(received.length, 1, 'handler called once')
    t.equal(received[0], mockResult, 'passes the result')
  })

  await t.test('executeOnComplete: calls handlers in priority order', async t => {
    const engine = new MiddlewareEngine()
    const order: string[] = []

    engine.register({
      name: MiddlewareName.PRODUCT_CHECK,
      priority: 100,
      onComplete: async () => { order.push('low') }
    })
    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      onComplete: async () => { order.push('high') }
    })

    await engine.executeOnComplete(createMockContext(), createMockResult())

    t.same(order, ['high', 'low'])
  })

  await t.test('executeOnComplete: wraps non-transport errors in MiddlewareException', async t => {
    const engine = new MiddlewareEngine()

    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      onComplete: async () => { throw new Error('handler blew up') }
    })

    try {
      await engine.executeOnComplete(createMockContext(), createMockResult())
      t.fail('should throw')
    } catch (err: any) {
      t.ok(err instanceof MiddlewareException, 'should be MiddlewareException')
      t.ok(err.message.includes('opentelemetry'), 'should include middleware name')
      t.ok(err.message.includes('onComplete'), 'should include hook name')
    }
  })

  await t.test('same MiddlewareContext object is passed to all hooks for a request', async t => {
    t.plan(3)
    const engine = new MiddlewareEngine()
    const ctx = createMockContext()
    const result = createMockResult()
    const seenContexts: MiddlewareContext[] = []

    engine.register({
      name: MiddlewareName.OPEN_TELEMETRY,
      priority: 10,
      onBeforeRequest: async (c) => { seenContexts.push(c) },
      onResponse: (c) => { seenContexts.push(c) },
      onComplete: async (c) => { seenContexts.push(c) }
    })

    await engine.executeBeforeRequest(ctx)
    engine.executeOnResponse(ctx, result)
    await engine.executeOnComplete(ctx, result)

    t.equal(seenContexts[0], ctx, 'onBeforeRequest receives the context')
    t.equal(seenContexts[1], ctx, 'onResponse receives the same context')
    t.equal(seenContexts[2], ctx, 'onComplete receives the same context')
  })
})
