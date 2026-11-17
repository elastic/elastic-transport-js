/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as gs from '@hegeldev/hegel/generators'

const finite = gs.floats({ allowNan: false, allowInfinity: false })

export const scalar = gs.oneOf(
  gs.none(),
  gs.booleans(),
  gs.integers({ minValue: -1e9, maxValue: 1e9 }),
  finite,
  gs.text()
)

// arbitrary JSON-compatible values
export const json = gs.recursive(scalar, children => gs.oneOf(
  gs.arrays(children, { maxSize: 5 }),
  gs.arrays(gs.tuples(gs.text({ maxSize: 10 }), children), { maxSize: 5 })
    .map(entries => Object.fromEntries(entries))
), { maxLeaves: 30 })

export const jsonObject = gs.arrays(gs.tuples(gs.text({ maxSize: 10 }), json), { maxSize: 6 })
  .map(entries => Object.fromEntries(entries))

export const hostname = gs.fromRegex('[a-z][a-z0-9-]{0,10}(\\.[a-z][a-z0-9]{0,5}){0,2}', { fullmatch: true })
export const port = gs.integers({ minValue: 1, maxValue: 65535 })
export const ipv4 = gs.tuples(...Array(4).fill(gs.integers({ minValue: 0, maxValue: 255 }))).map(p => p.join('.'))
