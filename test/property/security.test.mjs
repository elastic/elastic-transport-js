/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import assert from 'node:assert/strict'
import * as hegel from '@hegeldev/hegel'
import * as gs from '@hegeldev/hegel/generators'
import security from '../../lib/security.js'
import { json, jsonObject, scalar } from './gen.mjs'

const { redactObject, redactDiagnostic, sanitizeJsonBody, sanitizeStringQuery, sanitizeNdjsonBody } = security
const secretKeys = ['authorization', 'password', 'apikey', 'x-elastic-app-auth']

// mixes secret keys (in random case) into generated keys so redaction paths get exercised
const key = gs.oneOf(
  gs.text({ maxSize: 8 }),
  gs.tuples(gs.sampledFrom(secretKeys), gs.booleans()).map(([k, up]) => up ? k.toUpperCase() : k)
)
const tree = gs.recursive(scalar, children => gs.oneOf(
  gs.arrays(children, { maxSize: 4 }),
  gs.arrays(gs.tuples(key, children), { maxSize: 5 }).map(e => Object.fromEntries(e))
), { maxLeaves: 30 })
const treeObject = gs.arrays(gs.tuples(key, tree), { maxSize: 6 }).map(e => Object.fromEntries(e))

function assertRedacted (value, secrets) {
  if (Array.isArray(value)) return value.forEach(v => assertRedacted(v, secrets))
  if (value === null || typeof value !== 'object') return
  for (const [k, v] of Object.entries(value)) {
    if (secrets.includes(k.toLowerCase())) assert.equal(v, '[redacted]', `key ${k} not redacted`)
    else assertRedacted(v, secrets)
  }
}

test('redactObject redacts every secret key at any depth', async () => await hegel.test(tc => {
  const extra = tc.draw(gs.arrays(gs.text({ minSize: 1, maxSize: 5 }), { maxSize: 3 }))
  const obj = tc.draw(treeObject)
  assertRedacted(redactObject(obj, extra), [...secretKeys, ...extra.map(k => k.toLowerCase())])
}))

test('redactObject does not mutate its input', async () => await hegel.test(tc => {
  const obj = tc.draw(treeObject)
  const before = structuredClone(obj)
  redactObject(obj)
  assert.deepEqual(obj, before)
}))

test('redactObject preserves objects without secret keys', async () => await hegel.test(tc => {
  const obj = tc.draw(jsonObject)
  tc.assume(!JSON.stringify(obj).toLowerCase().match(/"(authorization|password|apikey|x-elastic-app-auth)"/))
  assert.deepEqual(redactObject(obj), obj)
}))

test('redactObject strips credentials from URL values', async () => await hegel.test(tc => {
  const user = tc.draw(gs.text({ alphabet: 'abcdef', minSize: 1, maxSize: 6 }))
  const pass = tc.draw(gs.text({ alphabet: 'ghijkl', minSize: 1, maxSize: 6 }))
  const out = redactObject({ url: new URL(`http://${user}:${pass}@localhost:9200/path?q=1`) })
  assert.equal(out.url, 'http://localhost:9200/path?q=1')
}))

test('redactObject terminates on circular references', async () => await hegel.test(tc => {
  const obj = tc.draw(treeObject)
  const child = { parent: obj }
  obj.child = child
  obj.self = obj
  redactObject(obj)
}))

test('redactDiagnostic remove clears sensitive fields', async () => await hegel.test(tc => {
  const headers = tc.draw(jsonObject)
  const diag = {
    body: tc.draw(json),
    statusCode: 200,
    headers,
    meta: {
      context: null,
      name: 'x',
      request: { params: { method: 'GET', path: '/', headers }, options: tc.draw(jsonObject), id: 1 },
      connection: {},
      attempts: 0,
      aborted: false,
      sniff: { hosts: [], reason: 'x' }
    },
    warnings: null
  }
  const out = redactDiagnostic(diag, { type: 'remove' })
  assert.equal(out.headers, undefined)
  assert.equal(out.meta.sniff, undefined)
  assert.equal(out.meta.request.params.headers, undefined)
  assert.deepEqual(out.meta.request.options, {})
  assert.equal(out.meta.connection, null)
}))

test('redactDiagnostic off is the identity', async () => await hegel.test(tc => {
  const diag = tc.draw(treeObject)
  assert.equal(redactDiagnostic(diag, { type: 'off' }), diag)
}))

// alphanumeric keys so bare `?` placeholders can be told apart from key text
const plainJson = gs.recursive(gs.oneOf(gs.none(), gs.booleans(), gs.integers(), gs.text()), children => gs.oneOf(
  gs.arrays(children, { maxSize: 4 }),
  gs.arrays(gs.tuples(gs.text({ alphabet: 'abcxyz09', maxSize: 6 }), children), { maxSize: 4 }).map(e => Object.fromEntries(e))
), { maxLeaves: 20 })

// keys-only skeleton of a JSON value: strings become '?', other literals null
function shape (v) {
  if (Array.isArray(v)) return v.map(shape)
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]))
  return typeof v === 'string' ? '?' : null
}

test('sanitizeJsonBody keeps structure and replaces every literal', async () => await hegel.test(tc => {
  const value = tc.draw(plainJson)
  const out = sanitizeJsonBody(JSON.stringify(value))
  assert.deepEqual(JSON.parse(out.replace(/(?<!")\?(?!")/g, 'null')), shape(value))
}))

test('sanitizeJsonBody never throws and returns null for invalid JSON', async () => await hegel.test(tc => {
  const input = tc.draw(gs.text())
  let valid = true
  try { JSON.parse(input) } catch { valid = false }
  const out = sanitizeJsonBody(input)
  if (!valid || input === '') assert.equal(out, null)
  else assert.equal(typeof out, 'string')
}))

test('sanitizeStringQuery returns the query only when parameterized', async () => await hegel.test(tc => {
  const query = tc.draw(gs.oneOf(gs.text(), json))
  const body = JSON.stringify({ ...tc.draw(jsonObject), query })
  const expected = typeof query === 'string' && query.includes('?') ? query : null
  assert.equal(sanitizeStringQuery(body), expected)
}))

test('sanitizeStringQuery never throws on arbitrary text', async () => await hegel.test(tc => {
  const out = sanitizeStringQuery(tc.draw(gs.text()))
  assert.ok(out === null || out.includes('?'))
}))

test('sanitizeNdjsonBody keeps headers verbatim and sanitizes bodies', async () => await hegel.test(tc => {
  const pairs = tc.draw(gs.arrays(gs.tuples(jsonObject, json), { minSize: 1, maxSize: 5 }))
  const eol = tc.draw(gs.sampledFrom(['\n', '\r\n']))
  const trailing = tc.draw(gs.booleans())
  const lines = pairs.flatMap(([h, b]) => [JSON.stringify(h), JSON.stringify(b)])
  const body = lines.join(eol) + (trailing ? eol : '')
  const expected = pairs.flatMap(([h, b]) => [JSON.stringify(h), sanitizeJsonBody(JSON.stringify(b))]).join(eol) + (trailing ? eol : '')
  assert.equal(sanitizeNdjsonBody(body), expected)
}))

test('sanitizeNdjsonBody never throws on arbitrary text', async () => await hegel.test(tc => {
  const out = sanitizeNdjsonBody(tc.draw(gs.text()))
  assert.ok(out === null || typeof out === 'string')
}))
