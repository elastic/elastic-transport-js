/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import { Compression } from '../../../src/middleware'
import type { MiddlewareContext } from '../../../src/middleware'

test('Compression middleware', t => {
  t.test('is disabled by default', t => {
    const middleware = new Compression({})

    t.equal(middleware.enabled, false)
    t.end()
  })

  t.test('can be enabled', t => {
    const middleware = new Compression({ enabled: true })

    t.equal(middleware.enabled, true)
    t.end()
  })

  t.test('does not set headers when disabled', t => {
    const middleware = new Compression({ enabled: false })

    const ctx: MiddlewareContext = {
      request: {
        method: 'POST',
        path: '/test',
        body: 'test data',
        headers: {}
      },
      params: { method: 'POST', path: '/test', body: 'test data' },
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
    t.equal(result, undefined)
    t.end()
  })

  t.test('sets accept-encoding header when enabled', t => {
    const middleware = new Compression({ enabled: true })

    const ctx: MiddlewareContext = {
      request: {
        method: 'POST',
        path: '/test',
        body: 'test data',
        headers: {}
      },
      params: { method: 'POST', path: '/test', body: 'test data' },
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

  t.test('compresses buffer body', async t => {
    const middleware = new Compression({ enabled: true })

    const ctx: MiddlewareContext = {
      request: {
        method: 'POST',
        path: '/test',
        body: Buffer.from('test data that should be compressed'),
        headers: {}
      },
      params: { method: 'POST', path: '/test', body: Buffer.from('test data that should be compressed') },
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

    const result = await middleware.onRequest?.(ctx)
    t.ok(result)
    t.ok(Buffer.isBuffer(result?.context?.request?.body), 'body should be a buffer')
    t.ok((result?.context?.request?.body as Buffer).length > 0, 'body should exist')
    t.equal(result?.context?.request?.headers?.['content-encoding'], 'gzip')
    t.ok(result?.context?.request?.headers?.['content-length'])
    t.end()
  })

  t.test('compresses string body', async t => {
    const middleware = new Compression({ enabled: true })

    const ctx: MiddlewareContext = {
      request: {
        method: 'POST',
        path: '/test',
        body: 'test data that should be compressed',
        headers: {}
      },
      params: { method: 'POST', path: '/test', body: 'test data that should be compressed' },
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

    const result = await middleware.onRequest?.(ctx)
    t.ok(result)
    t.ok(Buffer.isBuffer(result?.context?.request?.body), 'body should be a buffer')
    t.equal(result?.context?.request?.headers?.['content-encoding'], 'gzip')
    t.ok(result?.context?.request?.headers?.['content-length'])
    t.end()
  })

  t.test('does not compress empty body', async t => {
    const middleware = new Compression({ enabled: true })

    const ctx: MiddlewareContext = {
      request: {
        method: 'POST',
        path: '/test',
        body: '',
        headers: {}
      },
      params: { method: 'POST', path: '/test', body: '' },
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

    const result = await middleware.onRequest?.(ctx)
    t.equal(result, undefined)
    t.end()
  })

  t.test('compression is configured at middleware level', async t => {
    const middleware = new Compression({ enabled: true })

    const ctx: MiddlewareContext = {
      request: {
        method: 'POST',
        path: '/test',
        body: 'test data',
        headers: {}
      },
      params: { method: 'POST', path: '/test', body: 'test data' },
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

    const result = await middleware.onRequest?.(ctx)
    t.ok(result, 'should compress when middleware is enabled')
    t.equal(result?.context?.request?.headers?.['content-encoding'], 'gzip')
    t.end()
  })

  t.end()
})

