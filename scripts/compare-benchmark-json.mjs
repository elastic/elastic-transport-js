#!/usr/bin/env node
/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * Benchmark JSON comparison script
 * Usage: node scripts/compare-benchmark-json.mjs <base-dir> <pr-dir>
 * Output: Markdown comparison of benchmark results
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

if (process.argv.length !== 4) {
  console.error('Usage: node scripts/compare-benchmark-json.mjs <base-dir> <pr-dir>')
  process.exit(1)
}

const [, , baseDir, prDir] = process.argv

function readJSON(filepath) {
  try {
    if (!existsSync(filepath)) {
      return null
    }
    const content = readFileSync(filepath, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    console.error(`Error reading ${filepath}:`, error.message)
    return null
  }
}

function formatNumber(num) {
  return typeof num === 'number' ? num.toFixed(3) : num
}

function calculateChange(base, pr) {
  if (typeof base !== 'number' || typeof pr !== 'number') return null
  if (base === 0 || pr === 0) return 'n/a'
  const change = ((pr - base) / base) * 100
  return `${change >= 0 ? '+' : ''}${change.toFixed(3)}%`
}

function getDirection(base, pr) {
  if (typeof base !== 'number' || typeof pr !== 'number') {
    return ''
  }
  if (pr > base) return '↑'
  if (pr < base) return '↓'
  return ''
}

function compareValues(base, pr, path = '') {
  const results = []

  if (typeof base === 'object' && base !== null && typeof pr === 'object' && pr !== null) {
    const allKeys = new Set([...Object.keys(base), ...Object.keys(pr)])

    for (const key of allKeys) {
      const nestedPath = path ? `${path}.${key}` : key
      const nestedResults = compareValues(base[key], pr[key], nestedPath)
      results.push(...nestedResults)
    }
  } else if (base !== pr) {
    const direction = getDirection(base, pr)
    const change = calculateChange(base, pr)

    results.push({
      path,
      base,
      pr,
      direction,
      change
    })
  }

  return results
}

function formatMarkdownComparison(baseData, prData, title) {
  if (!baseData && !prData) {
    return `## ${title}\n\nNo benchmark data available.\n\n`
  }

  if (!baseData) {
    return `## ${title}\n\nBase benchmark data not available.\n\n`
  }

  if (!prData) {
    return `## ${title}\n\nPR benchmark data not available.\n\n`
  }

  let code = `## ${title}\n\n`

  const allGroups = new Set([...Object.keys(baseData), ...Object.keys(prData)])

  for (const groupName of allGroups) {
    const baseGroup = baseData[groupName] || {}
    const prGroup = prData[groupName] || {}
    const allItems = new Set([...Object.keys(baseGroup), ...Object.keys(prGroup)])

    if (allItems.size === 0) continue

    code += `### ${groupName}\n\n`

    for (const itemName of allItems) {
      const baseItem = baseGroup[itemName] || {}
      const prItem = prGroup[itemName] || {}

      const differences = compareValues(baseItem, prItem)

      if (differences.length === 0) {
        code += `#### ${itemName}\nNo performance changes detected.\n\n`
        continue
      }

      code += `#### ${itemName}\n\n`
      code += '| Stat | Base | PR | Change |\n'
      code += '|------|------|----|--------|\n'

      // group by top-level stats vs nested stats
      const topLevelStats = ['p75', 'p99', 'avg']

      for (const stat of topLevelStats) {
        const statDifferences = differences.filter(diff => diff.path === stat)
        for (const diff of statDifferences) {
          const baseValue = diff.base !== undefined ? formatNumber(diff.base) : 'N/A'
          const prValue = diff.pr !== undefined ? formatNumber(diff.pr) : 'N/A'
          code += `| \`${diff.path}\` | ${baseValue} | ${prValue} | ${diff.direction} ${diff.change} |\n`
        }
      }

      code += '\n'
    }
  }

  return code
}

function formatGCBenchmarkComparison(baseData, prData) {
  if (!baseData && !prData) {
    return `## GC Benchmarks\n\nNo GC benchmark data available.\n\n`
  }

  if (!baseData) {
    return `## GC Benchmarks\n\nBase GC benchmark data not available.\n\n`
  }

  if (!prData) {
    return `## GC Benchmarks\n\nPR GC benchmark data not available.\n\n`
  }

  let code = `## GC Benchmarks\n\n`

  // Get all scenarios from both base and PR
  const baseResults = baseData.results || []
  const prResults = prData.results || []

  const allScenarios = new Set([
    ...baseResults.map(r => r.scenario),
    ...prResults.map(r => r.scenario)
  ])

  for (const scenarioName of allScenarios) {
    const baseScenario = baseResults.find(r => r.scenario === scenarioName)
    const prScenario = prResults.find(r => r.scenario === scenarioName)

    code += `### ${scenarioName}\n\n`

    if (!baseScenario) {
      code += 'Base scenario data not available.\n\n'
      continue
    }

    if (!prScenario) {
      code += 'PR scenario data not available.\n\n'
      continue
    }

    code += '| Metric | Base | PR | Change |\n'
    code += '|--------|------|----|--------|\n'

    // Performance metrics
    if (baseScenario.performance && prScenario.performance) {
      const perfMetrics = ['opsPerSec', 'avgLatencyMs', 'durationMs']
      for (const metric of perfMetrics) {
        const baseValue = baseScenario.performance[metric]
        const prValue = prScenario.performance[metric]
        if (baseValue !== undefined && prValue !== undefined) {
          const direction = getDirection(baseValue, prValue)
          const change = direction === '' ? 'n/a' : calculateChange(baseValue, prValue)
          code += `| \`${metric}\` | ${formatNumber(baseValue)} | ${formatNumber(prValue)} | ${direction} ${change} |\n`
        }
      }
    }

    // GC metrics
    if (baseScenario.gc && prScenario.gc) {
      code += '| **Garbage collection** | | | |\n'
      const gcMetrics = ['totalEvents', 'totalDuration', 'avgDuration', 'maxDuration']

      if (baseScenario.gc.totalEvents === 0 && prScenario.gc.totalEvents === 0) {
        code += `| \`totalEvents\` | 0 | 0 | n/a |\n`
      } else {
        for (const metric of gcMetrics) {
          const baseValue = baseScenario.gc[metric]
          const prValue = prScenario.gc[metric]
          if (baseValue !== undefined && prValue !== undefined) {
            const direction = getDirection(baseValue, prValue)
            const change = calculateChange(baseValue, prValue)
            code += `| \`${metric}\` | ${formatNumber(baseValue)} | ${formatNumber(prValue)} | ${direction} ${change} |\n`
          }
        }
      }
    }

    // Memory metrics - after measurement
    if (baseScenario.memory?.after && prScenario.memory?.after) {
      code += '| **Memory usage (after)** | | | |\n'
      const memoryMetrics = ['heapUsed', 'heapTotal', 'external', 'arrayBuffers']
      for (const metric of memoryMetrics) {
        const baseValue = baseScenario.memory.after[metric]
        const prValue = prScenario.memory.after[metric]
        if (baseValue !== undefined && prValue !== undefined) {
          const direction = getDirection(baseValue, prValue)
          const change = calculateChange(baseValue, prValue)
          const unit = metric === 'arrayBuffers' ? '' : ' bytes'
          code += `| \`${metric}\` | ${formatNumber(baseValue)}${unit} | ${formatNumber(prValue)}${unit} | ${direction} ${change} |\n`
        }
      }
    }

    // Memory delta
    if (baseScenario.memory?.delta && prScenario.memory?.delta) {
      code += '| **Memory usage (delta)** | | | |\n'
      const deltaMetrics = ['heapUsed', 'heapTotal', 'external']
      for (const metric of deltaMetrics) {
        const baseValue = baseScenario.memory.delta[metric]
        const prValue = prScenario.memory.delta[metric]
        if (baseValue !== undefined && prValue !== undefined) {
          const direction = getDirection(baseValue, prValue)
          const change = calculateChange(baseValue, prValue)
          code += `| \`${metric} delta\` | ${formatNumber(baseValue)} bytes | ${formatNumber(prValue)} bytes | ${direction} ${change} |\n`
        }
      }
    }

    code += '\n'
  }

  return code
}

try {
  // Read performance benchmark data
  const basePerf = readJSON(join(baseDir, 'benchmark.json'))
  const prPerf = readJSON(join(prDir, 'benchmark.json'))

  // Read GC benchmark data
  const baseGC = readJSON(join(baseDir, 'benchmark-gc.json'))
  const prGC = readJSON(join(prDir, 'benchmark-gc.json'))

  let output = ''

  // Generate performance comparison
  if (basePerf || prPerf) {
    output += formatMarkdownComparison(basePerf, prPerf, 'Performance Benchmarks')
  }

  // Generate GC comparison
  if (baseGC || prGC) {
    output += formatGCBenchmarkComparison(baseGC, prGC)
  }

  if (!output) {
    output = '# Benchmark Comparison\n\nNo benchmark data available.\n'
  }

  console.log('\n' + output)
} catch (error) {
  console.error('Error:', error.message)
  process.exit(1)
}
