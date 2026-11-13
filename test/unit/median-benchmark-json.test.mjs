/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import { median } from '../../scripts/median-benchmark-json.mjs'

test('median of benchmark runs', t => {
  const runs = [
    { g: { a: { avg: 3, p99: 10 } }, results: [{ n: 'x', v: 1 }], ts: 'one' },
    { g: { a: { avg: 1, p99: 30 } }, results: [{ n: 'x', v: 5 }], ts: 'two' },
    { g: { a: { avg: 2, p99: 20 } }, results: [{ n: 'x', v: 9 }], ts: 'three' }
  ]
  t.same(median(runs), {
    g: { a: { avg: 2, p99: 20 } },
    results: [{ n: 'x', v: 5 }],
    ts: 'one'
  })
  t.end()
})
