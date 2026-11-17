/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import assert from 'node:assert/strict'
import * as hegel from '@hegeldev/hegel'
import * as gs from '@hegeldev/hegel/generators'
import engineModule from '../../lib/middleware/MiddlewareEngine.js'
import { errors } from '../../index.js'

const { MiddlewareEngine, MiddlewareException } = engineModule

// A list of middleware with random priorities; each records its hook calls into `log`
function drawMiddleware (tc, log) {
  const specs = tc.draw(gs.arrays(gs.record({
    priority: gs.optional(gs.integers({ minValue: 0, maxValue: 200 })),
    before: gs.booleans(),
    around: gs.booleans(),
    response: gs.sampledFrom(['none', 'continue', 'stop'])
  }), { maxSize: 8 }))
  return specs.map((spec, i) => ({
    name: `m${i}`,
    stops: spec.response === 'stop',
    ...(spec.priority != null ? { priority: spec.priority } : {}),
    ...(spec.before ? { onBeforeRequest: () => { log.push(['before', i]); return { headers: { [`m${i}`]: 'x' } } } } : {}),
    ...(spec.around ? { around: async (_ctx, next) => { log.push(['enter', i]); const r = await next(); log.push(['exit', i]); return r } } : {}),
    ...(spec.response !== 'none' ? { onResponse: () => { log.push(['response', i]); return spec.response === 'stop' ? { continue: false } : undefined } } : {})
  }))
}

// stable sort by priority, defaulting to 100: the documented ordering
const ordered = mws => mws.map((m, i) => [m, i]).sort(([a], [b]) => (a.priority ?? 100) - (b.priority ?? 100)).map(([, i]) => i)

test('onBeforeRequest runs in stable priority order and merges updates', async () => await hegel.testAsync(async tc => {
  const log = []
  const mws = drawMiddleware(tc, log)
  const engine = new MiddlewareEngine()
  mws.forEach(m => engine.register(m))
  const ctx = { request: { headers: {} } }
  await engine.executeOnBeforeRequest(ctx)
  const expected = ordered(mws).filter(i => mws[i].onBeforeRequest != null)
  assert.deepEqual(log.map(([, i]) => i), expected)
  // a shallow merge: the last writer of `headers` wins
  if (expected.length > 0) assert.deepEqual(ctx.request.headers, { [`m${expected.at(-1)}`]: 'x' })
}))

test('around handlers nest as an onion in priority order', async () => await hegel.testAsync(async tc => {
  const log = []
  const mws = drawMiddleware(tc, log)
  const engine = new MiddlewareEngine()
  mws.forEach(m => engine.register(m))
  const result = { body: tc.draw(gs.text()) }
  assert.equal(await engine.run({}, async () => { log.push(['run']); return result }), result)
  const order = ordered(mws).filter(i => mws[i].around != null)
  assert.deepEqual(log, [...order.map(i => ['enter', i]), ['run'], ...order.reverse().map(i => ['exit', i])])
}))

test('onResponse stops at the first { continue: false }', async () => await hegel.test(tc => {
  const log = []
  const mws = drawMiddleware(tc, log)
  const engine = new MiddlewareEngine()
  mws.forEach(m => engine.register(m))
  engine.executeOnResponse({}, {})
  const expected = []
  for (const i of ordered(mws)) {
    if (mws[i].onResponse == null) continue
    expected.push(i)
    if (mws[i].stops) break
  }
  assert.deepEqual(log.map(([, i]) => i), expected)
}))

test('handler errors are wrapped unless they are client errors', async () => await hegel.testAsync(async tc => {
  const clientError = tc.draw(gs.booleans())
  const hook = tc.draw(gs.sampledFrom(['onBeforeRequest', 'onResponse']))
  const err = clientError ? new errors.ConfigurationError(tc.draw(gs.text())) : new Error(tc.draw(gs.text()))
  const engine = new MiddlewareEngine()
  engine.register({ name: 'boom', [hook]: () => { throw err } })
  const call = hook === 'onBeforeRequest'
    ? () => engine.executeOnBeforeRequest({ request: {} })
    : async () => engine.executeOnResponse({}, {})
  await assert.rejects(call, thrown => clientError ? thrown === err : thrown instanceof MiddlewareException && thrown.cause === err)
}))
