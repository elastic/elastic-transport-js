/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import { ProductCheck } from '../../../src/middleware'
import type { MiddlewareContext } from '../../../src/middleware'
import type { TransportResult } from '../../../src/types'

test('ProductCheck middleware', t => {
  t.test('does nothing when productCheck is null', t => {
    const middleware = new ProductCheck({ productCheck: null })

    const ctx: MiddlewareContext = {
      request: {
        method: 'GET',
        path: '/test',
        headers: {}
      },
      params: { method: 'GET', path: '/test' },
      options: {},
      meta: {
        requestId: '123',
        name: 'test',
        context: null,
        connection: null,
        attempts: 0
      },
      shared: new Map()
    }

    const result: TransportResult = {
      body: {},
      statusCode: 200,
      headers: {},
      meta: ctx.meta as any
    }

    const middlewareResult = middleware.onResponse?.(ctx, result)
    t.equal(middlewareResult, undefined)
    t.end()
  })

  t.test('passes when header matches', t => {
    const middleware = new ProductCheck({ productCheck: 'Elasticsearch' })

    const ctx: MiddlewareContext = {
      request: {
        method: 'GET',
        path: '/test',
        headers: {}
      },
      params: { method: 'GET', path: '/test' },
      options: {},
      meta: {
        requestId: '123',
        name: 'test',
        context: null,
        connection: null,
        attempts: 0
      },
      shared: new Map()
    }

    const result: TransportResult = {
      body: {},
      statusCode: 200,
      headers: {
        'x-elastic-product': 'Elasticsearch'
      },
      meta: ctx.meta as any
    }

    const middlewareResult = middleware.onResponse?.(ctx, result)
    t.equal(middlewareResult, undefined)
    t.end()
  })

  t.test('throws ProductNotSupportedError when header does not match for 2xx response', t => {
    const middleware = new ProductCheck({ productCheck: 'Elasticsearch' })

    const ctx: MiddlewareContext = {
      request: {
        method: 'GET',
        path: '/test',
        headers: {}
      },
      params: { method: 'GET', path: '/test' },
      options: {},
      meta: {
        requestId: '123',
        name: 'test',
        context: null,
        connection: null,
        attempts: 0
      },
      shared: new Map()
    }

    const result: TransportResult = {
      body: {},
      statusCode: 200,
      headers: {
        'x-elastic-product': 'SomethingElse'
      },
      meta: ctx.meta as any
    }

    try {
      middleware.onResponse?.(ctx, result)
      t.fail('should have thrown ProductNotSupportedError')
    } catch (err: any) {
      t.equal(err.name, 'ProductNotSupportedError')
    }
    t.end()
  })

  t.test('passes when header does not match for non-2xx response', t => {
    const middleware = new ProductCheck({ productCheck: 'Elasticsearch' })

    const ctx: MiddlewareContext = {
      request: {
        method: 'GET',
        path: '/test',
        headers: {}
      },
      params: { method: 'GET', path: '/test' },
      options: {},
      meta: {
        requestId: '123',
        name: 'test',
        context: null,
        connection: null,
        attempts: 0
      },
      shared: new Map()
    }

    const result: TransportResult = {
      body: {},
      statusCode: 404,
      headers: {
        'x-elastic-product': 'SomethingElse'
      },
      meta: ctx.meta as any
    }

    const middlewareResult = middleware.onResponse?.(ctx, result)
    t.equal(middlewareResult, undefined)
    t.end()
  })

  t.test('throws ProductNotSupportedError when header is missing', t => {
    const middleware = new ProductCheck({ productCheck: 'Elasticsearch' })

    const ctx: MiddlewareContext = {
      request: {
        method: 'GET',
        path: '/test',
        headers: {}
      },
      params: { method: 'GET', path: '/test' },
      options: {},
      meta: {
        requestId: '123',
        name: 'test',
        context: null,
        connection: null,
        attempts: 0
      },
      shared: new Map()
    }

    const result: TransportResult = {
      body: {},
      statusCode: 200,
      headers: {},
      meta: ctx.meta as any
    }

    try {
      middleware.onResponse?.(ctx, result)
      t.fail('should have thrown ProductNotSupportedError')
    } catch (err: any) {
      t.equal(err.name, 'ProductNotSupportedError')
    }
    t.end()
  })

  t.end()
})

