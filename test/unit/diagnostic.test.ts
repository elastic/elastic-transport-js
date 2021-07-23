/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
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
  } catch (err) {
    t.ok(err instanceof ConfigurationError)
  }
})

