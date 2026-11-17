/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import assert from 'node:assert/strict'
import { parse } from 'node:querystring'
import * as hegel from '@hegeldev/hegel'
import * as gs from '@hegeldev/hegel/generators'
import { Serializer, errors } from '../../index.js'
import { json, jsonObject } from './gen.mjs'

test('serialize/deserialize round-trips JSON objects', async () => await hegel.test(tc => {
  const s = new Serializer()
  const obj = tc.draw(jsonObject)
  assert.deepEqual(s.deserialize(s.serialize(obj)), JSON.parse(JSON.stringify(obj)))
}))

test('deserialize either parses or throws DeserializationError', async () => await hegel.test(tc => {
  const protection = tc.draw(gs.sampledFrom([false, true, 'proto', 'constructor']))
  const s = new Serializer({ enablePrototypePoisoningProtection: protection })
  const input = tc.draw(gs.oneOf(gs.text(), json.map(v => JSON.stringify(v))))
  try {
    s.deserialize(input)
  } catch (err) {
    assert.ok(err instanceof errors.DeserializationError, String(err))
    assert.equal(err.data, input)
  }
}))

test('prototype poisoning protection rejects __proto__ keys', async () => await hegel.test(tc => {
  const s = new Serializer({ enablePrototypePoisoningProtection: tc.draw(gs.sampledFrom([true, 'proto'])) })
  const obj = tc.draw(jsonObject)
  const body = JSON.stringify(obj).replace(/^\{/, '{"__proto__":{"polluted":1}' + (Object.keys(obj).length > 0 ? ',' : ''))
  assert.throws(() => s.deserialize(body), errors.DeserializationError)
  assert.equal({}.polluted, undefined)
}))

test('serialize throws SerializationError on circular structures', async () => await hegel.test(tc => {
  const obj = tc.draw(jsonObject)
  obj[tc.draw(gs.text({ maxSize: 5 }))] = obj
  assert.throws(() => new Serializer().serialize(obj), errors.SerializationError)
}))

test('ndserialize emits one parseable line per entry', async () => await hegel.test(tc => {
  const s = new Serializer()
  const items = tc.draw(gs.arrays(jsonObject, { maxSize: 8 }))
  const out = s.ndserialize(items)
  assert.ok(items.length === 0 ? out === '' : out.endsWith('\n'))
  const lines = out.split('\n').slice(0, -1)
  assert.equal(lines.length, items.length)
  lines.forEach((line, i) => assert.deepEqual(JSON.parse(line), JSON.parse(JSON.stringify(items[i]))))
}))

test('ndserialize passes strings through verbatim', async () => await hegel.test(tc => {
  const items = tc.draw(gs.arrays(gs.text(), { maxSize: 8 }))
  assert.equal(new Serializer().ndserialize(items), items.map(i => i + '\n').join(''))
}))

test('ndserialize rejects non-arrays', async () => await hegel.test(tc => {
  const notArray = tc.draw(gs.oneOf(jsonObject, gs.text(), gs.integers()))
  assert.throws(() => new Serializer().ndserialize(notArray), errors.SerializationError)
}))

test('qserialize drops undefined, joins arrays, and round-trips via querystring', async () => await hegel.test(tc => {
  const key = gs.text({ minSize: 1, maxSize: 8 })
  const value = gs.oneOf(
    gs.text(),
    gs.integers(),
    gs.booleans(),
    gs.just(undefined),
    gs.arrays(gs.text({ alphabet: 'abc123' }), { minSize: 1, maxSize: 4 })
  )
  const obj = Object.fromEntries(tc.draw(gs.arrays(gs.tuples(key, value), { maxSize: 6 })))
  const expected = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    expected[k] = Array.isArray(v) ? v.join(',') : String(v)
  }
  assert.deepEqual({ ...parse(new Serializer().qserialize({ ...obj })) }, expected)
}))

test('qserialize passes strings through and maps nullish to empty', async () => await hegel.test(tc => {
  const s = new Serializer()
  const str = tc.draw(gs.text())
  assert.equal(s.qserialize(str), str)
  assert.equal(s.qserialize(tc.draw(gs.sampledFrom([null, undefined]))), '')
}))

test('float32 vectors round-trip through base64', async () => await hegel.test(tc => {
  const s = new Serializer()
  const floats = tc.draw(gs.arrays(gs.floats({ width: 32 }), { maxSize: 64 }))
  const decoded = s.decodeFloat32Vector(s.encodeFloat32Vector(floats))
  assert.equal(decoded.length, floats.length)
  decoded.forEach((f, i) => assert.ok(Object.is(f, floats[i]), `index ${i}: ${f} !== ${floats[i]}`))
}))

test('float32 encoding of 64-bit floats matches Math.fround', async () => await hegel.test(tc => {
  const s = new Serializer()
  const floats = tc.draw(gs.arrays(gs.floats({ allowNan: false }), { maxSize: 16 }))
  assert.deepEqual(s.decodeFloat32Vector(s.encodeFloat32Vector(floats)), floats.map(Math.fround))
}))

test('decodeFloat32Vector rejects byte lengths not divisible by 4', async () => await hegel.test(tc => {
  const bytes = tc.draw(gs.binary({ maxSize: 64 }))
  tc.assume(bytes.length % 4 !== 0)
  const b64 = Buffer.from(bytes).toString('base64')
  assert.throws(() => new Serializer().decodeFloat32Vector(b64), errors.DeserializationError)
}))

test('decodeFloat32Vector never throws anything but DeserializationError', async () => await hegel.test(tc => {
  const input = tc.draw(gs.oneOf(gs.text(), gs.integers(), gs.none()))
  try {
    new Serializer().decodeFloat32Vector(input)
  } catch (err) {
    assert.ok(err instanceof errors.DeserializationError, String(err))
  }
}))

test('encodeFloat32Vector rejects non-arrays', async () => await hegel.test(tc => {
  const input = tc.draw(gs.oneOf(gs.text(), gs.integers(), jsonObject))
  assert.throws(() => new Serializer().encodeFloat32Vector(input), errors.SerializationError)
}))
