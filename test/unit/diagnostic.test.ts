/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import { URL } from 'url'
import { Diagnostic, HttpConnection, errors, DiagnosticResult, events } from '../..'
const { ConnectionError, ConfigurationError } = errors

const mmeta = {
  body: {},
  statusCode: 200,
  headers: {},
  warnings: null,
  meta: {
    context: null,
    name: 'name',
    request: {
      params: { path: '/', method: 'GET' },
      options: {},
      id: 1
    },
    connection: new HttpConnection({ url: new URL('http://localhost:9200') }),
    attempts: 0,
    aborted: false
  }
}

test('on', t => {
  t.plan(4)
  const d = new Diagnostic()

  d.on(events.REQUEST, (err, meta) => {
    t.ok(err instanceof ConnectionError)
    t.same(meta, mmeta)
  })

  d.emit(events.REQUEST, new ConnectionError('kaboom'), mmeta)
  d.emit(events.REQUEST, new ConnectionError('kaboom'), mmeta)
})

test('once', t => {
  t.plan(2)
  const d = new Diagnostic()

  d.once(events.REQUEST, (err, meta) => {
    t.ok(err instanceof ConnectionError)
    t.same(meta, mmeta)
  })

  d.emit(events.REQUEST, new ConnectionError('kaboom'), mmeta)
  d.emit(events.REQUEST, new ConnectionError('kaboom'), mmeta)
})

test('off', t => {
  t.plan(2)
  const d = new Diagnostic()

  function handler (err: errors.ElasticsearchClientError | null, meta: DiagnosticResult | null) {
    t.ok(err instanceof ConnectionError)
    t.same(meta, mmeta)
  }

  d.on(events.REQUEST, handler)
  d.emit(events.REQUEST, new ConnectionError('kaboom'), mmeta)

  d.off(events.REQUEST, handler)
  d.emit(events.REQUEST, new ConnectionError('kaboom'), mmeta)
})


test('on', t => {
  t.plan(1)
  const d = new Diagnostic()

  try {
    // @ts-expect-error
    d.on('foobar', (err, meta) => {
      t.ok(err instanceof ConnectionError)
      t.same(meta, mmeta)
    })
  } catch (err: any) {
    t.ok(err instanceof ConfigurationError)
  }
})

