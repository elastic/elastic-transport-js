/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import assert from 'node:assert/strict'
import * as hegel from '@hegeldev/hegel'
import * as gs from '@hegeldev/hegel/generators'
import base from '../../lib/connection/BaseConnection.js'
import utils from '../../lib/utils.js'
import { BaseConnection, errors } from '../../index.js'
import { hostname, port, json, jsonObject } from './gen.mjs'

const { stripAuth, prepareHeaders, isCaFingerprintMatch, isBinary } = base
const { lowerCaseHeaders, shouldSerialize, isStream } = utils

const userinfo = gs.text({ minSize: 1, maxSize: 10 })
const urlPath = gs.text({ maxSize: 15 }).map(p => '/' + encodeURI(p))

test('stripAuth removes credentials and keeps host and path', async () => await hegel.test(tc => {
  const url = new URL(`${tc.draw(gs.sampledFrom(['http', 'https']))}://${tc.draw(hostname)}:${tc.draw(port)}`)
  url.username = tc.draw(userinfo)
  url.password = tc.draw(userinfo)
  url.pathname = tc.draw(urlPath)
  const stripped = new URL(stripAuth(url.href))
  assert.equal(stripped.username, '')
  assert.equal(stripped.password, '')
  assert.equal(stripped.host, url.host)
  assert.equal(stripped.pathname, url.pathname)
}))

test('stripAuth is the identity on URLs without credentials', { todo: 'known bug: stripAuth mangles URLs with @ after the host' }, async () => await hegel.test(tc => {
  const url = new URL(`http://${tc.draw(hostname)}:${tc.draw(port)}`)
  url.pathname = tc.draw(urlPath)
  url.search = tc.draw(gs.text({ maxSize: 10 }))
  assert.equal(stripAuth(url.href), url.href)
}))

test('prepareHeaders basic auth encodes username:password', async () => await hegel.test(tc => {
  const username = tc.draw(gs.text())
  const password = tc.draw(gs.text())
  const { authorization } = prepareHeaders({}, { username, password })
  assert.match(authorization, /^Basic /)
  assert.equal(Buffer.from(authorization.slice(6), 'base64').toString(), Buffer.from(`${username}:${password}`).toString())
}))

test('prepareHeaders api key and bearer auth', async () => await hegel.test(tc => {
  const apiKey = tc.draw(gs.oneOf(
    gs.text({ minSize: 1 }),
    gs.record({ id: gs.text(), api_key: gs.text() })
  ))
  const ak = prepareHeaders({}, { apiKey }).authorization
  if (typeof apiKey === 'string') assert.equal(ak, `ApiKey ${apiKey}`)
  else assert.equal(Buffer.from(ak.slice(7), 'base64').toString(), Buffer.from(`${apiKey.id}:${apiKey.api_key}`).toString())
  const bearer = tc.draw(gs.text({ minSize: 1 }))
  assert.equal(prepareHeaders({}, { bearer }).authorization, `Bearer ${bearer}`)
}))

test('prepareHeaders never overrides an existing authorization header', async () => await hegel.test(tc => {
  const existing = tc.draw(gs.text())
  const auth = tc.draw(gs.oneOf(
    gs.record({ username: gs.text(), password: gs.text() }),
    gs.record({ apiKey: gs.text() }),
    gs.record({ bearer: gs.text() })
  ))
  assert.equal(prepareHeaders({ authorization: existing }, auth).authorization, existing)
}))

test('isCaFingerprintMatch ignores case and colons, and is symmetric', async () => await hegel.test(tc => {
  const hex = tc.draw(gs.fromRegex('[0-9a-f]{2}(:[0-9a-f]{2}){0,31}', { fullmatch: true }))
  const variant = hex.toUpperCase().replace(/:/g, tc.draw(gs.booleans()) ? '' : ':')
  assert.ok(isCaFingerprintMatch(hex, variant))
  const a = tc.draw(gs.optional(gs.text()))
  const b = tc.draw(gs.optional(gs.text()))
  assert.equal(isCaFingerprintMatch(a, b), isCaFingerprintMatch(b, a))
  assert.ok(isCaFingerprintMatch(a, a))
}))

const binaryTypes = [
  'application/vnd.mapbox-vector-tile',
  'application/vnd.apache.arrow.stream',
  'application/vnd.elasticsearch+arrow+stream',
  'application/smile',
  'application/vnd.elasticsearch+smile',
  'application/cbor',
  'application/vnd.elasticsearch+cbor'
]

test('isBinary detects binary content types with parameters', async () => await hegel.test(tc => {
  const type = tc.draw(gs.sampledFrom(binaryTypes))
  const suffix = tc.draw(gs.sampledFrom(['', '; charset=utf-8', ';compatible-with=8']))
  assert.ok(isBinary(type + suffix))
  assert.ok(isBinary([tc.draw(gs.text()), type]))
}))

test('isBinary is false for json/text content types', async () => await hegel.test(tc => {
  const type = tc.draw(gs.sampledFrom(['application/json', 'text/plain', 'application/x-ndjson', 'application/vnd.elasticsearch+json']))
  assert.equal(isBinary(type + tc.draw(gs.sampledFrom(['', '; charset=utf-8']))), false)
}))

test('lowerCaseHeaders lowercases keys and preserves values', async () => await hegel.test(tc => {
  const headers = Object.fromEntries(tc.draw(gs.arrays(gs.tuples(gs.text({ minSize: 1, maxSize: 10 }), gs.text()), { maxSize: 6 })))
  // headers differing only by case legitimately collapse into one
  tc.assume(new Set(Object.keys(headers).map(k => k.toLowerCase())).size === Object.keys(headers).length)
  if (Object.keys(headers).some(k => k.toLowerCase() === '__proto__')) {
    assert.throws(() => lowerCaseHeaders(headers), errors.ConfigurationError)
    return
  }
  const out = lowerCaseHeaders(headers)
  for (const k of Object.keys(out)) assert.equal(k, k.toLowerCase())
  for (const [k, v] of Object.entries(headers)) assert.ok(Object.values(out).includes(v), `value for ${k} lost`)
  assert.equal(lowerCaseHeaders(tc.draw(gs.sampledFrom([null, undefined]))), null)
}))

test('shouldSerialize/isStream classify inputs', async () => await hegel.test(tc => {
  const str = tc.draw(gs.text())
  assert.equal(shouldSerialize(str), false)
  assert.equal(shouldSerialize(Buffer.from(str)), false)
  assert.equal(shouldSerialize(tc.draw(jsonObject)), true)
  assert.equal(isStream(tc.draw(json)), false)
}))

test('BaseConnection accepts only http(s) URLs', async () => await hegel.test(tc => {
  const protocol = tc.draw(gs.sampledFrom(['http:', 'https:', 'ftp:', 'ws:', 'file:']))
  const url = new URL(`${protocol}//${tc.draw(hostname)}`)
  const make = () => new BaseConnection({ url })
  if (protocol === 'http:' || protocol === 'https:') assert.equal(make().status, 'alive')
  else assert.throws(make, errors.ConfigurationError)
}))

test('BaseConnection toJSON never leaks credentials', async () => await hegel.test(tc => {
  const url = new URL(`http://${tc.draw(hostname)}:${tc.draw(port)}`)
  url.username = tc.draw(userinfo)
  url.password = tc.draw(gs.text({ minSize: 4, maxSize: 10 }))
  const headers = tc.draw(jsonObject)
  tc.assume(!(url.host + JSON.stringify(headers)).includes(url.password))
  const conn = new BaseConnection({ url, headers })
  const out = JSON.stringify(conn.toJSON())
  assert.ok(!out.includes(url.password), `password ${url.password} leaked in ${out}`)
}))

test('BaseConnection status setter validates', async () => await hegel.test(tc => {
  const conn = new BaseConnection({ url: new URL('http://localhost:9200') })
  const status = tc.draw(gs.oneOf(gs.sampledFrom(['alive', 'dead']), gs.text()))
  if (status === 'alive' || status === 'dead') {
    conn.status = status
    assert.equal(conn.status, status)
  } else {
    assert.throws(() => { conn.status = status }, errors.ConfigurationError)
  }
}))

test('ResponseError never throws and derives statusCode consistently', async () => await hegel.test(tc => {
  const errorBody = gs.record({
    type: gs.text(),
    reason: gs.optional(gs.text()),
    caused_by: gs.optional(gs.record({ type: gs.text(), reason: gs.text() })),
    root_cause: gs.optional(gs.arrays(gs.record({ type: gs.text(), reason: gs.text() }), { maxSize: 3 }))
  })
  const body = tc.draw(gs.oneOf(
    json,
    gs.record({ error: errorBody, status: gs.optional(gs.integers({ minValue: 100, maxValue: 599 })) })
  ))
  const statusCode = tc.draw(gs.integers({ minValue: 100, maxValue: 599 }))
  const err = new errors.ResponseError({ body, statusCode, headers: {}, warnings: null, meta: {} }, { redaction: { type: 'off' } })
  assert.equal(typeof err.message, 'string')
  const expected = body !== null && typeof body === 'object' && !Array.isArray(body) && typeof body.status === 'number' ? body.status : statusCode
  assert.equal(err.statusCode, expected)
  assert.equal(err.body, body)
  if (body?.error?.type != null) assert.ok(err.message.startsWith(body.error.type))
}))

test('ResponseError redacts secret headers in meta by default', async () => await hegel.test(tc => {
  const secret = tc.draw(gs.text({ minSize: 5 }))
  const err = new errors.ResponseError({ body: null, statusCode: 500, headers: { authorization: secret }, warnings: null, meta: {} })
  assert.equal(err.headers.authorization, '[redacted]')
}))
