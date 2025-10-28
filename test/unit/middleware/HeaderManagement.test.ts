/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import { HeaderManagement } from '../../../src/middleware'
import type { MiddlewareContext } from '../../../src/middleware'

test('HeaderManagement middleware', t => {
  t.test('sets user-agent header', t => {
    const middleware = new HeaderManagement({
      userAgent: 'test-agent/1.0',
      defaultHeaders: {}
    })

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

    const result = middleware.onBeforeRequest?.(ctx)
    t.ok(result)
    t.equal(result?.context?.request?.headers?.['user-agent'], 'test-agent/1.0')
    t.end()
  })

  t.test('sets client-meta header', t => {
    const middleware = new HeaderManagement({
      clientMeta: 'et=1.0,js=18.0.0',
      defaultHeaders: {}
    })

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

    const result = middleware.onBeforeRequest?.(ctx)
    t.ok(result)
    t.equal(result?.context?.request?.headers?.['x-elastic-client-meta'], 'et=1.0,js=18.0.0')
    t.end()
  })

  t.test('sets accept-encoding header', t => {
    const middleware = new HeaderManagement({
      acceptEncoding: 'gzip,deflate',
      defaultHeaders: {}
    })

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

    const result = middleware.onBeforeRequest?.(ctx)
    t.ok(result)
    t.equal(result?.context?.request?.headers?.['accept-encoding'], 'gzip,deflate')
    t.end()
  })

  t.test('merges default headers', t => {
    const middleware = new HeaderManagement({
      defaultHeaders: {
        'x-custom': 'default-value',
        authorization: 'Bearer token'
      }
    })

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

    const result = middleware.onBeforeRequest?.(ctx)
    t.ok(result)
    t.equal(result?.context?.request?.headers?.['x-custom'], 'default-value')
    t.equal(result?.context?.request?.headers?.authorization, 'Bearer token')
    t.end()
  })

  t.test('respects TransportRequestOptions headers', t => {
    const middleware = new HeaderManagement({
      defaultHeaders: {
        'x-custom': 'default-value'
      }
    })

    const ctx: MiddlewareContext = {
      request: {
        method: 'GET',
        path: '/test',
        headers: {}
      },
      params: { method: 'GET', path: '/test' },
      options: {
        headers: {
          'x-custom': 'override-value',
          'x-another': 'new-value'
        }
      },
      meta: {
        requestId: '123',
        name: 'test',
        context: null,
        connection: null,
        attempts: 0
      },
      shared: new Map()
    }

    const result = middleware.onBeforeRequest?.(ctx)
    t.ok(result)
    t.equal(result?.context?.request?.headers?.['x-custom'], 'override-value', 'options headers override default headers')
    t.equal(result?.context?.request?.headers?.['x-another'], 'new-value')
    t.end()
  })

  t.test('sets opaque-id header without prefix', t => {
    const middleware = new HeaderManagement({
      opaqueIdPrefix: null,
      defaultHeaders: {}
    })

    const ctx: MiddlewareContext = {
      request: {
        method: 'GET',
        path: '/test',
        headers: {}
      },
      params: { method: 'GET', path: '/test' },
      options: {
        opaqueId: 'my-request-123'
      },
      meta: {
        requestId: '123',
        name: 'test',
        context: null,
        connection: null,
        attempts: 0
      },
      shared: new Map()
    }

    const result = middleware.onBeforeRequest?.(ctx)
    t.ok(result)
    t.equal(result?.context?.request?.headers?.['x-opaque-id'], 'my-request-123')
    t.end()
  })

  t.test('sets opaque-id header with prefix', t => {
    const middleware = new HeaderManagement({
      opaqueIdPrefix: 'app-prefix-',
      defaultHeaders: {}
    })

    const ctx: MiddlewareContext = {
      request: {
        method: 'GET',
        path: '/test',
        headers: {}
      },
      params: { method: 'GET', path: '/test' },
      options: {
        opaqueId: 'my-request-123'
      },
      meta: {
        requestId: '123',
        name: 'test',
        context: null,
        connection: null,
        attempts: 0
      },
      shared: new Map()
    }

    const result = middleware.onBeforeRequest?.(ctx)
    t.ok(result)
    t.equal(result?.context?.request?.headers?.['x-opaque-id'], 'app-prefix-my-request-123')
    t.end()
  })

  t.end()
})

