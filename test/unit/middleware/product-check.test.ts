/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import { ProductCheck } from '../../../src/middleware/ProductCheck'
import { MiddlewareContext, MiddlewareName, MiddlewarePriority } from '../../../src/middleware/types'
import { TransportResult } from '../../../src/types'
import { ProductNotSupportedError } from '../../../src/errors'

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

function createMockResult (
  statusCode: number = 200,
  headers: Record<string, any> = { 'x-elastic-product': 'Elasticsearch' }
): TransportResult {
  return {
    body: {},
    statusCode,
    headers,
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
    warnings: null
  }
}

test('ProductCheck middleware', async t => {
  await t.test('has correct name and priority', async t => {
    const middleware = new ProductCheck({ productCheck: 'Elasticsearch' })

    t.equal(middleware.name, MiddlewareName.PRODUCT_CHECK)
    t.equal(middleware.priority, MiddlewarePriority[MiddlewareName.PRODUCT_CHECK])
  })

  await t.test('passes when x-elastic-product header matches', async t => {
    const middleware = new ProductCheck({ productCheck: 'Elasticsearch' })
    const ctx = createMockContext()
    const result = createMockResult(200, { 'x-elastic-product': 'Elasticsearch' })

    middleware.onResponse(ctx, result)
    t.pass('did not throw')
  })

  await t.test('throws ProductNotSupportedError when header is missing', async t => {
    const middleware = new ProductCheck({ productCheck: 'Elasticsearch' })
    const ctx = createMockContext()
    const result = createMockResult(200, {})

    try {
      middleware.onResponse(ctx, result)
      t.fail('should throw')
    } catch (err: any) {
      t.ok(err instanceof ProductNotSupportedError, 'should be ProductNotSupportedError')
      t.ok(err.message.includes('Elasticsearch'), 'message should include product name')
    }
  })

  await t.test('throws ProductNotSupportedError when header does not match', async t => {
    const middleware = new ProductCheck({ productCheck: 'Elasticsearch' })
    const ctx = createMockContext()
    const result = createMockResult(200, { 'x-elastic-product': 'SomeOtherProduct' })

    try {
      middleware.onResponse(ctx, result)
      t.fail('should throw')
    } catch (err: any) {
      t.ok(err instanceof ProductNotSupportedError, 'should be ProductNotSupportedError')
    }
  })

  await t.test('does not throw for error status codes (4xx)', async t => {
    const middleware = new ProductCheck({ productCheck: 'Elasticsearch' })
    const ctx = createMockContext()
    const result = createMockResult(404, {})

    middleware.onResponse(ctx, result)
    t.pass('did not throw for 404')
  })

  await t.test('does not throw for error status codes (5xx)', async t => {
    const middleware = new ProductCheck({ productCheck: 'Elasticsearch' })
    const ctx = createMockContext()
    const result = createMockResult(500, {})

    middleware.onResponse(ctx, result)
    t.pass('did not throw for 500')
  })

  await t.test('does nothing when productCheck is null', async t => {
    const middleware = new ProductCheck({ productCheck: null })
    const ctx = createMockContext()
    const result = createMockResult(200, {})

    middleware.onResponse(ctx, result)
    t.pass('did not throw when productCheck is null')
  })

  await t.test('checks all 2xx status codes', async t => {
    const middleware = new ProductCheck({ productCheck: 'Elasticsearch' })
    const ctx = createMockContext()

    const successCodes = [200, 201, 202, 204, 299]

    for (const statusCode of successCodes) {
      const result = createMockResult(statusCode, {})

      try {
        middleware.onResponse(ctx, result)
        t.fail(`should throw for status ${statusCode}`)
      } catch (err: any) {
        t.ok(err instanceof ProductNotSupportedError, `throws for status ${statusCode}`)
      }
    }
  })
})
