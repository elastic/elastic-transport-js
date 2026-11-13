/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Collapses several benchmark rounds into one result by taking the median of
 * every numeric field. Non-numeric fields are taken from the first round.
 *
 * Usage: node scripts/median-benchmark-json.mjs <out-dir> <round-dir>...
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function median (values) {
  const [first] = values
  if (typeof first === 'number') {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }
  if (Array.isArray(first)) return first.map((_, i) => median(values.map(v => v[i])))
  if (first !== null && typeof first === 'object') {
    return Object.fromEntries(Object.keys(first).map(k => [k, median(values.map(v => v[k]))]))
  }
  return first
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [outDir, ...roundDirs] = process.argv.slice(2)
  for (const file of readdirSync(roundDirs[0]).filter(f => f.endsWith('.json'))) {
    const rounds = roundDirs.map(dir => JSON.parse(readFileSync(join(dir, file), 'utf8')))
    writeFileSync(join(outDir, file), JSON.stringify(median(rounds)), 'utf8')
  }
}
