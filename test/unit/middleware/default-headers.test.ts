/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import { DefaultHeaders } from '../../../src/middleware/DefaultHeaders'
import { MiddlewareContext, MiddlewareName, MiddlewarePriority } from '../../../src/middleware/types'

const middleware = new DefaultHeaders({
  headers: { 'user-agent': 'ua' },
  opaqueIdPrefix: 'pre-',
  jsonContentType: 'json',
  ndjsonContentType: 'ndjson',
  acceptHeader: 'accept'
})

function ctx (params: any, body: any, options = {}, headers = {}): MiddlewareContext {
  return {
    request: { method: 'POST', path: '/test', body, headers },
    params: { method: 'POST', path: '/test', ...params },
    options,
    meta: { requestId: 1, name: 'test', context: null, connection: null, attempts: 0 }
  }
}

test('DefaultHeaders middleware', async t => {
  await t.test('has correct name and runs before compression', async t => {
    t.equal(middleware.name, MiddlewareName.DEFAULT_HEADERS)
    t.ok(middleware.priority < MiddlewarePriority[MiddlewareName.COMPRESSION])
  })

  await t.test('sets json headers for a serialized body', async t => {
    t.same(middleware.onBeforeRequest(ctx({ body: { a: 1 } }, '{"a":1}')).headers,
      { 'user-agent': 'ua', 'content-type': 'json', accept: 'json' })
  })

  await t.test('sets text/plain for a string body', async t => {
    t.same(middleware.onBeforeRequest(ctx({ body: 'hi' }, 'hi')).headers,
      { 'user-agent': 'ua', 'content-type': 'text/plain', accept: 'accept' })
  })

  await t.test('sets ndjson headers for a bulk body', async t => {
    t.same(middleware.onBeforeRequest(ctx({ bulkBody: [{}] }, '{}\n')).headers,
      { 'user-agent': 'ua', 'content-type': 'ndjson', accept: 'json' })
  })

  await t.test('sets defaults for an empty body', async t => {
    t.same(middleware.onBeforeRequest(ctx({}, undefined)).headers,
      { 'user-agent': 'ua', 'content-type': 'json', accept: 'accept' })
  })

  await t.test('prefixes opaque id and keeps lowercased user headers', async t => {
    t.same(middleware.onBeforeRequest(ctx({ body: {} }, '{}', { opaqueId: 'x', headers: { 'Content-Type': 'mine' } })).headers,
      { 'user-agent': 'ua', 'content-type': 'mine', accept: 'json', 'x-opaque-id': 'pre-x' })
  })

  await t.test('keeps headers set by earlier middleware', async t => {
    t.same(middleware.onBeforeRequest(ctx({}, undefined, { headers: { accept: 'user' } }, { accept: 'earlier' })).headers,
      { 'user-agent': 'ua', 'content-type': 'json', accept: 'earlier' })
  })
})
