#!/usr/bin/env node
/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const outputDir = 'benchmark-output'

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function aggregatePerf(prefix) {
  const files = readdirSync(outputDir).filter(f => f.startsWith(`${prefix}-run`) && f.endsWith('.json') && !f.includes('-gc-'))
  if (files.length === 0) return null

  const runs = files.map(f => JSON.parse(readFileSync(join(outputDir, f), 'utf8')))
  const result = {}

  for (const groupName of Object.keys(runs[0])) {
    result[groupName] = {}
    for (const poolName of Object.keys(runs[0][groupName])) {
      const p75Values = runs.map(r => r[groupName]?.[poolName]?.p75).filter(v => v !== undefined)
      const p99Values = runs.map(r => r[groupName]?.[poolName]?.p99).filter(v => v !== undefined)
      const avgValues = runs.map(r => r[groupName]?.[poolName]?.avg).filter(v => v !== undefined)

      result[groupName][poolName] = {
        p75: median(p75Values),
        p99: median(p99Values),
        avg: median(avgValues)
      }
    }
  }

  return result
}

function aggregateGC(prefix) {
  const files = readdirSync(outputDir).filter(f => f.startsWith(`${prefix}-gc-run`) && f.endsWith('.json'))
  if (files.length === 0) return null

  const runs = files.map(f => JSON.parse(readFileSync(join(outputDir, f), 'utf8')))

  const result = {
    metadata: runs[0].metadata,
    results: []
  }

  const scenarios = runs[0].results.map(r => r.scenario)

  for (const scenario of scenarios) {
    const scenarioRuns = runs.map(r => r.results.find(s => s.scenario === scenario)).filter(Boolean)

    const aggregated = {
      scenario,
      config: scenarioRuns[0].config,
      performance: {
        iterations: scenarioRuns[0].performance.iterations,
        durationMs: median(scenarioRuns.map(r => r.performance.durationMs)),
        avgLatencyMs: median(scenarioRuns.map(r => r.performance.avgLatencyMs)),
        opsPerSec: Math.floor(median(scenarioRuns.map(r => r.performance.opsPerSec)))
      },
      gc: {
        totalEvents: Math.floor(median(scenarioRuns.map(r => r.gc.totalEvents))),
        totalDuration: median(scenarioRuns.map(r => r.gc.totalDuration)),
        avgDuration: median(scenarioRuns.map(r => r.gc.avgDuration)),
        maxDuration: median(scenarioRuns.map(r => r.gc.maxDuration)),
        byType: scenarioRuns[0].gc.byType
      },
      memory: {
        before: scenarioRuns[0].memory.before,
        afterWarmup: scenarioRuns[0].memory.afterWarmup,
        after: {
          heapUsed: Math.floor(median(scenarioRuns.map(r => r.memory.after.heapUsed))),
          heapTotal: Math.floor(median(scenarioRuns.map(r => r.memory.after.heapTotal))),
          external: Math.floor(median(scenarioRuns.map(r => r.memory.after.external))),
          arrayBuffers: Math.floor(median(scenarioRuns.map(r => r.memory.after.arrayBuffers || 0)))
        },
        delta: {
          heapUsed: Math.floor(median(scenarioRuns.map(r => r.memory.delta.heapUsed))),
          heapTotal: Math.floor(median(scenarioRuns.map(r => r.memory.delta.heapTotal))),
          external: Math.floor(median(scenarioRuns.map(r => r.memory.delta.external)))
        }
      }
    }

    result.results.push(aggregated)
  }

  return result
}

const basePerf = aggregatePerf('base')
const prPerf = aggregatePerf('pr')
const baseGC = aggregateGC('base')
const prGC = aggregateGC('pr')

if (basePerf) writeFileSync(join(outputDir, 'base', 'benchmark.json'), JSON.stringify(basePerf))
if (prPerf) writeFileSync(join(outputDir, 'pr', 'benchmark.json'), JSON.stringify(prPerf))
if (baseGC) writeFileSync(join(outputDir, 'base', 'benchmark-gc.json'), JSON.stringify(baseGC))
if (prGC) writeFileSync(join(outputDir, 'pr', 'benchmark-gc.json'), JSON.stringify(prGC))

console.log(`Aggregated ${readdirSync(outputDir).filter(f => f.includes('-run')).length} benchmark runs (median of 3)`)

