#!/usr/bin/env node
/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * Benchmark JSON comparison script
 * Usage: node scripts/compare-benchmark-json.mjs <base.json> <pr.json>
 * Output: Markdown comparison of benchmark results
 */

import { readFileSync } from 'fs'

if (process.argv.length !== 4) {
  console.error('Usage: node scripts/compare-benchmark-json.mjs <base.json> <pr.json>')
  process.exit(1)
}

const [, , baseFile, prFile] = process.argv

function readJSON(filename) {
  try {
    const content = readFileSync(filename, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    console.error(`Error reading ${filename}:`, error.message)
    process.exit(1)
  }
}

function formatNumber(num) {
  return typeof num === 'number' ? num.toLocaleString() : num
}

function calculateChange(base, pr) {
  if (typeof base !== 'number' || typeof pr !== 'number') return null
  if (base === 0 || pr === 0) return 'n/a'
  const change = ((pr - base) / base) * 100
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`
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

function formatMarkdownComparison(baseData, prData) {
  let code = '# Benchmark Comparison\n\n'

  const allGroups = new Set([...Object.keys(baseData), ...Object.keys(prData)])

  for (const groupName of allGroups) {
    const baseGroup = baseData[groupName] || {}
    const prGroup = prData[groupName] || {}
    const allItems = new Set([...Object.keys(baseGroup), ...Object.keys(prGroup)])

    if (allItems.size === 0) continue

    code += `## ${groupName}\n\n`

    for (const itemName of allItems) {
      const baseItem = baseGroup[itemName] || {}
      const prItem = prGroup[itemName] || {}

      const differences = compareValues(baseItem, prItem)

      if (differences.length === 0) {
        code += `### ${itemName}\nNo performance changes detected.\n\n`
        continue
      }

      code += `### ${itemName}\n\n`
      code += '| Stat | Base | PR | Change |\n'
      code += '|------|------|----|--------|\n'

      // group by top-level stats vs nested stats
      const topLevelStats = ['min', 'max', 'p25', 'p50', 'p75', 'p99', 'p999', 'avg']
      const nestedGroups = ['heap', 'gc']

      for (const stat of topLevelStats) {
        const statDifferences = differences.filter(diff => diff.path === stat)
        for (const diff of statDifferences) {
          const baseValue = diff.base !== undefined ? formatNumber(diff.base) : 'N/A'
          const prValue = diff.pr !== undefined ? formatNumber(diff.pr) : 'N/A'
          code += `| \`${diff.path}\` | ${baseValue} | ${prValue} | ${diff.direction} ${diff.change} |\n`
        }
      }

      for (const group of nestedGroups) {
        const groupDifferences = differences.filter(diff => diff.path.startsWith(`${group}.`))
        if (groupDifferences.length > 0) {
          const hasTopLevelStats = differences.some(diff => topLevelStats.includes(diff.path))
          if (hasTopLevelStats) {
            code += '| **' + group.toUpperCase() + '** | | | |\n'
          }

          for (const diff of groupDifferences) {
            const statName = diff.path.replace(`${group}.`, '')
            const baseValue = diff.base !== undefined ? formatNumber(diff.base) : 'N/A'
            const prValue = diff.pr !== undefined ? formatNumber(diff.pr) : 'N/A'
            code += `| \`${statName}\` | ${baseValue} | ${prValue} | ${diff.direction} ${diff.change} |\n`
          }
        }
      }

      code += '\n'
    }
  }

  return code
}

try {
  console.log('Loading benchmark data')
  const baseData = readJSON(baseFile)
  const prData = readJSON(prFile)

  console.log('Comparing results')
  const markdown = formatMarkdownComparison(baseData, prData)

  console.log('\n' + markdown)
} catch (error) {
  console.error('Error:', error.message)
  process.exit(1)
}
