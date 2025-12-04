#!/usr/bin/env node
/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const THRESHOLDS = {
  latency: { warning: 5, failure: 10 },
  throughput: { warning: -5, failure: -10 },
  memory: { warning: 10, failure: 25 },
  gc: { warning: 15, failure: 30 }
}

const regressions = { failures: [], warnings: [] }

if (process.argv.length !== 4) {
  console.error('Usage: node scripts/compare-benchmark-json.mjs <base-dir> <pr-dir>')
  process.exit(1)
}

const [, , baseDir, prDir] = process.argv

function readJSON(filepath) {
  try {
    if (!existsSync(filepath)) return null
    return JSON.parse(readFileSync(filepath, 'utf8'))
  } catch (error) {
    console.error(`Error reading ${filepath}:`, error.message)
    return null
  }
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number') return bytes
  const units = ['B', 'KB', 'MB', 'GB']
  let unitIndex = 0
  let value = bytes
  while (Math.abs(value) >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

function formatNumber(num, isBytes = false) {
  if (typeof num !== 'number') return num
  if (isBytes) return formatBytes(num)
  if (Math.abs(num) >= 1000) return Math.round(num).toLocaleString()
  if (Math.abs(num) >= 10) return num.toFixed(1)
  return num.toFixed(2)
}

function formatMs(ms) {
  if (typeof ms !== 'number') return ms
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  if (ms >= 1) return `${ms.toFixed(2)}ms`
  return `${(ms * 1000).toFixed(1)}us`
}

function calculateChange(base, pr) {
  if (typeof base !== 'number' || typeof pr !== 'number') return { value: null, raw: null }
  if (base === 0) return { value: 'n/a', raw: null }
  const change = ((pr - base) / base) * 100
  const formatted = `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`
  return { value: formatted, raw: change }
}

function getDirection(base, pr) {
  if (typeof base !== 'number' || typeof pr !== 'number') return ''
  if (pr > base) return '+'
  if (pr < base) return '-'
  return '='
}

function checkThreshold(metricName, changePercent, thresholdType, context) {
  if (changePercent === null || changePercent === undefined) return ''

  const threshold = THRESHOLDS[thresholdType]
  if (!threshold) return ''

  const isRegressionPositive = thresholdType !== 'throughput'
  const regressionValue = isRegressionPositive ? changePercent : -changePercent

  if (regressionValue >= threshold.failure) {
    regressions.failures.push({ metric: metricName, change: changePercent, context })
    return ' [FAIL]'
  }
  if (regressionValue >= threshold.warning) {
    regressions.warnings.push({ metric: metricName, change: changePercent, context })
    return ' [WARN]'
  }
  if (regressionValue <= -threshold.warning) {
    return ' [OK]'
  }
  return ''
}

function compareValues(base, pr, path = '', context = '') {
  const results = []

  if (typeof base === 'object' && base !== null && typeof pr === 'object' && pr !== null) {
    const allKeys = new Set([...Object.keys(base), ...Object.keys(pr)])
    for (const key of allKeys) {
      const nestedPath = path ? `${path}.${key}` : key
      results.push(...compareValues(base[key], pr[key], nestedPath, context))
    }
  } else if (base !== pr) {
    const { value: change, raw: changeRaw } = calculateChange(base, pr)
    results.push({ path, base, pr, direction: getDirection(base, pr), change, changeRaw })
  }

  return results
}

function formatMarkdownComparison(baseData, prData, title) {
  if (!baseData && !prData) return `## ${title}\n\nNo benchmark data available.\n\n`
  if (!baseData) return `## ${title}\n\nBase benchmark data not available.\n\n`
  if (!prData) return `## ${title}\n\nPR benchmark data not available.\n\n`

  let code = `## ${title}\n\n`

  const allGroups = new Set([...Object.keys(baseData), ...Object.keys(prData)])

  for (const groupName of allGroups) {
    const baseGroup = baseData[groupName] || {}
    const prGroup = prData[groupName] || {}
    const allItems = new Set([...Object.keys(baseGroup), ...Object.keys(prGroup)])

    if (allItems.size === 0) continue

    code += `### ${groupName}\n\n`
    code += '| Pool | Metric | Base | PR | Change |\n'
    code += '|------|--------|------|----|--------|\n'

    for (const itemName of allItems) {
      const baseItem = baseGroup[itemName] || {}
      const prItem = prGroup[itemName] || {}
      const context = `${groupName} > ${itemName}`

      const differences = compareValues(baseItem, prItem, '', context)

      if (differences.length === 0) {
        code += `| ${itemName} | - | - | - | No change |\n`
        continue
      }

      const topLevelStats = ['p75', 'p99', 'avg']
      let isFirst = true

      for (const stat of topLevelStats) {
        const statDifferences = differences.filter(diff => diff.path === stat)
        for (const diff of statDifferences) {
          const baseNs = diff.base
          const prNs = diff.pr
          const baseValue = baseNs !== undefined ? formatMs(baseNs / 1_000_000) : 'N/A'
          const prValue = prNs !== undefined ? formatMs(prNs / 1_000_000) : 'N/A'
          const indicator = checkThreshold(`${context} ${diff.path}`, diff.changeRaw, 'latency', context)

          const poolCell = isFirst ? itemName : ''
          code += `| ${poolCell} | \`${diff.path}\` | ${baseValue} | ${prValue} | ${diff.change}${indicator} |\n`
          isFirst = false
        }
      }
    }

    code += '\n'
  }

  return code
}

function formatGCBenchmarkComparison(baseData, prData) {
  if (!baseData && !prData) return `## GC & Memory Benchmarks\n\nNo GC benchmark data available.\n\n`
  if (!baseData) return `## GC & Memory Benchmarks\n\nBase GC benchmark data not available.\n\n`
  if (!prData) return `## GC & Memory Benchmarks\n\nPR GC benchmark data not available.\n\n`

  let code = `## GC & Memory Benchmarks\n\n`

  const baseResults = baseData.results || []
  const prResults = prData.results || []
  const allScenarios = new Set([
    ...baseResults.map(r => r.scenario),
    ...prResults.map(r => r.scenario)
  ])

  for (const scenarioName of allScenarios) {
    const baseScenario = baseResults.find(r => r.scenario === scenarioName)
    const prScenario = prResults.find(r => r.scenario === scenarioName)
    const context = scenarioName

    code += `### ${scenarioName}\n\n`

    if (!baseScenario) { code += 'Base scenario data not available.\n\n'; continue }
    if (!prScenario) { code += 'PR scenario data not available.\n\n'; continue }

    code += '| Metric | Base | PR | Change |\n'
    code += '|--------|------|----|--------|\n'

    if (baseScenario.performance && prScenario.performance) {
      code += '| **Throughput** | | | |\n'

      const baseOps = baseScenario.performance.opsPerSec
      const prOps = prScenario.performance.opsPerSec
      if (baseOps !== undefined && prOps !== undefined) {
        const { value: change, raw: changeRaw } = calculateChange(baseOps, prOps)
        const indicator = checkThreshold(`${context} opsPerSec`, changeRaw, 'throughput', context)
        code += `| ops/sec | ${formatNumber(baseOps)} | ${formatNumber(prOps)} | ${change}${indicator} |\n`
      }

      const baseLatency = baseScenario.performance.avgLatencyMs
      const prLatency = prScenario.performance.avgLatencyMs
      if (baseLatency !== undefined && prLatency !== undefined) {
        const { value: change, raw: changeRaw } = calculateChange(baseLatency, prLatency)
        const indicator = checkThreshold(`${context} avgLatency`, changeRaw, 'latency', context)
        code += `| avg latency | ${formatMs(baseLatency)} | ${formatMs(prLatency)} | ${change}${indicator} |\n`
      }

      const baseDuration = baseScenario.performance.durationMs
      const prDuration = prScenario.performance.durationMs
      if (baseDuration !== undefined && prDuration !== undefined) {
        const { value: change } = calculateChange(baseDuration, prDuration)
        code += `| total time | ${formatMs(baseDuration)} | ${formatMs(prDuration)} | ${change} |\n`
      }

      code += `| iterations | ${formatNumber(baseScenario.performance.iterations)} | ${formatNumber(prScenario.performance.iterations)} | - |\n`
    }

    if (baseScenario.gc && prScenario.gc) {
      code += '| **Garbage Collection** | | | |\n'

      if (baseScenario.gc.totalEvents === 0 && prScenario.gc.totalEvents === 0) {
        code += `| GC events | 0 | 0 | none |\n`
      } else {
        const gcMetrics = [
          { key: 'totalEvents', label: 'GC events', unit: '' },
          { key: 'totalDuration', label: 'GC total time', unit: 'ms' },
          { key: 'avgDuration', label: 'GC avg time', unit: 'ms' },
          { key: 'maxDuration', label: 'GC max pause', unit: 'ms' }
        ]

        for (const { key, label, unit } of gcMetrics) {
          const baseValue = baseScenario.gc[key]
          const prValue = prScenario.gc[key]
          if (baseValue !== undefined && prValue !== undefined) {
            const { value: change, raw: changeRaw } = calculateChange(baseValue, prValue)
            const indicator = checkThreshold(`${context} ${key}`, changeRaw, 'gc', context)
            const suffix = unit ? ` ${unit}` : ''
            code += `| ${label} | ${formatNumber(baseValue)}${suffix} | ${formatNumber(prValue)}${suffix} | ${change}${indicator} |\n`
          }
        }
      }
    }

    if (baseScenario.memory?.after && prScenario.memory?.after) {
      code += '| **Memory (after test)** | | | |\n'
      const memoryMetrics = [
        { key: 'heapUsed', label: 'heap used' },
        { key: 'heapTotal', label: 'heap total' },
        { key: 'external', label: 'external' },
        { key: 'arrayBuffers', label: 'array buffers' }
      ]

      for (const { key, label } of memoryMetrics) {
        const baseValue = baseScenario.memory.after[key]
        const prValue = prScenario.memory.after[key]
        if (baseValue !== undefined && prValue !== undefined) {
          const { value: change, raw: changeRaw } = calculateChange(baseValue, prValue)
          const indicator = checkThreshold(`${context} ${key}`, changeRaw, 'memory', context)
          code += `| ${label} | ${formatBytes(baseValue)} | ${formatBytes(prValue)} | ${change}${indicator} |\n`
        }
      }
    }

    if (baseScenario.memory?.delta && prScenario.memory?.delta) {
      code += '| **Memory delta** | | | |\n'
      const deltaMetrics = [
        { key: 'heapUsed', label: 'd heap used' },
        { key: 'heapTotal', label: 'd heap total' },
        { key: 'external', label: 'd external' }
      ]

      for (const { key, label } of deltaMetrics) {
        const baseValue = baseScenario.memory.delta[key]
        const prValue = prScenario.memory.delta[key]
        if (baseValue !== undefined && prValue !== undefined) {
          const { value: change, raw: changeRaw } = calculateChange(baseValue, prValue)
          const indicator = checkThreshold(`${context} ${label}`, changeRaw, 'memory', context)
          const baseFormatted = baseValue >= 0 ? `+${formatBytes(baseValue)}` : `-${formatBytes(Math.abs(baseValue))}`
          const prFormatted = prValue >= 0 ? `+${formatBytes(prValue)}` : `-${formatBytes(Math.abs(prValue))}`
          code += `| ${label} | ${baseFormatted} | ${prFormatted} | ${change}${indicator} |\n`
        }
      }
    }

    code += '\n'
  }

  return code
}

function generateSummary() {
  let summary = `## Summary\n\n`

  if (regressions.failures.length === 0 && regressions.warnings.length === 0) {
    summary += `**PASSED** - No significant performance regressions detected.\n\n`
    return summary
  }

  if (regressions.failures.length > 0) {
    summary += `**FAILED** - ${regressions.failures.length} regression(s) detected\n\n`
    summary += '| Metric | Regression |\n'
    summary += '|--------|------------|\n'
    for (const { metric, change } of regressions.failures) {
      summary += `| ${metric} | ${change >= 0 ? '+' : ''}${change.toFixed(1)}% |\n`
    }
    summary += '\n'
  }

  if (regressions.warnings.length > 0) {
    summary += `**${regressions.warnings.length} warning(s)**\n\n`
    summary += '| Metric | Change |\n'
    summary += '|--------|--------|\n'
    for (const { metric, change } of regressions.warnings) {
      summary += `| ${metric} | ${change >= 0 ? '+' : ''}${change.toFixed(1)}% |\n`
    }
    summary += '\n'
  }

  summary += `### Thresholds\n\n`
  summary += `| Type | Warning | Failure |\n`
  summary += `|------|---------|---------|\n`
  summary += `| Latency | >${THRESHOLDS.latency.warning}% slower | >${THRESHOLDS.latency.failure}% slower |\n`
  summary += `| Throughput | >${Math.abs(THRESHOLDS.throughput.warning)}% slower | >${Math.abs(THRESHOLDS.throughput.failure)}% slower |\n`
  summary += `| Memory | >${THRESHOLDS.memory.warning}% larger | >${THRESHOLDS.memory.failure}% larger |\n`
  summary += `| GC | >${THRESHOLDS.gc.warning}% more | >${THRESHOLDS.gc.failure}% more |\n\n`

  return summary
}

try {
  const basePerf = readJSON(join(baseDir, 'benchmark.json'))
  const prPerf = readJSON(join(prDir, 'benchmark.json'))
  const baseGC = readJSON(join(baseDir, 'benchmark-gc.json'))
  const prGC = readJSON(join(prDir, 'benchmark-gc.json'))

  let output = '# Benchmark Comparison\n\n'

  if (basePerf || prPerf) {
    output += formatMarkdownComparison(basePerf, prPerf, 'Performance Benchmarks')
  }

  if (baseGC || prGC) {
    output += formatGCBenchmarkComparison(baseGC, prGC)
  }

  const summary = generateSummary()
  output = '# Benchmark Comparison\n\n' + summary + output.replace('# Benchmark Comparison\n\n', '')

  if (output === '# Benchmark Comparison\n\n') {
    output = '# Benchmark Comparison\n\nNo benchmark data available.\n'
  }

  console.log('\n' + output)

  if (regressions.failures.length > 0) {
    console.error(`\nBenchmark failed: ${regressions.failures.length} regression(s) exceeded threshold`)
    process.exit(1)
  }
} catch (error) {
  console.error('Error:', error.message)
  process.exit(1)
}
