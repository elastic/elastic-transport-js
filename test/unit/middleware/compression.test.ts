/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import { Readable } from 'node:stream'
import { gunzipSync } from 'node:zlib'
import { Compression } from '../../../src/middleware/Compression'
import { MiddlewareContext, MiddlewareName, MiddlewarePriority } from '../../../src/middleware/types'

function createMockContext (body: any, options = {}): MiddlewareContext {
  return {
    request: { method: 'POST', path: '/test', body, headers: { foo: 'bar' } },
    params: { method: 'POST', path: '/test' },
    options,
    meta: { requestId: 1, name: 'test', context: null, connection: null, attempts: 0 }
  }
}

test('Compression middleware', async t => {
  await t.test('has correct name and priority', async t => {
    const middleware = new Compression({ compression: true })
    t.equal(middleware.name, MiddlewareName.COMPRESSION)
    t.equal(middleware.priority, MiddlewarePriority[MiddlewareName.COMPRESSION])
  })

  await t.test('gzips a string body', async t => {
    const update = await new Compression({ compression: true }).onBeforeRequest(createMockContext('hello'))
    t.equal(gunzipSync(update?.body as Buffer).toString(), 'hello')
    t.same(update?.headers, { foo: 'bar', 'content-encoding': 'gzip' })
  })

  await t.test('pipes a stream body through gzip', async t => {
    const update = await new Compression({ compression: true }).onBeforeRequest(createMockContext(Readable.from(['hello'])))
    const chunks: Buffer[] = []
    for await (const chunk of update?.body as Readable) chunks.push(chunk)
    t.equal(gunzipSync(Buffer.concat(chunks)).toString(), 'hello')
    t.equal(update?.headers?.['content-encoding'], 'gzip')
  })

  await t.test('skips empty bodies', async t => {
    const middleware = new Compression({ compression: true })
    t.equal(await middleware.onBeforeRequest(createMockContext('')), undefined)
    t.equal(await middleware.onBeforeRequest(createMockContext(null)), undefined)
  })

  await t.test('skips when disabled', async t => {
    t.equal(await new Compression({ compression: false }).onBeforeRequest(createMockContext('hello')), undefined)
  })

  await t.test('per-request option overrides the default', async t => {
    t.equal(await new Compression({ compression: true }).onBeforeRequest(createMockContext('hello', { compression: false })), undefined)
    t.ok(await new Compression({ compression: false }).onBeforeRequest(createMockContext('hello', { compression: true })))
  })
})
