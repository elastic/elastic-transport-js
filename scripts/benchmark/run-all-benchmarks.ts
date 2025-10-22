/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const RESULTS_DIR = path.join(__dirname, '../../benchmark-results')
const BASELINE_DIR = path.join(__dirname, 'baselines')
const NODE_VERSION = process.env.NODE_VERSION ?? process.version.slice(1).split('.')[0]

const THRESHOLDS = {
  WARN: 0.05,
  FAIL: 0.15
}

interface BenchmarkResult {
  scenario: string
  duration_ms: number
  heap_mb?: number
  ops_per_sec?: number
}

interface BenchmarkMetrics {
  name: string
  timestamp: string
  nodeVersion: string
  build: {
    number: string
    branch: string
    commit: string
  }
  results: BenchmarkResult[]
}

interface ComparisonResult {
  scenario: string
  status: 'pass' | 'warn' | 'fail' | 'new' | 'improvement'
  message: string
  current?: number
  baseline?: number
  change?: string
}

interface Comparison {
  hasRegression: boolean
  comparisons: ComparisonResult[]
}

interface BenchmarkExecutionResult {
  success: boolean
  output: string
  error: string | null
}

// Ensure directories exist
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
}

/**
 * Run a single benchmark and capture output
 */
function runBenchmark (name: string, scriptPath: string): BenchmarkExecutionResult {
  console.log(`\n=== Running ${name} ===`)

  try {
    const output = execSync(
      `npx tsx --expose-gc ${scriptPath}`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )
    return { success: true, output, error: null }
  } catch (error: any) {
    return {
      success: false,
      output: error.stdout ?? '',
      error: error.stderr ?? error.message
    }
  }
}

function parseBenchmarkOutput (name: string, output: string): BenchmarkMetrics {
  const metrics: BenchmarkMetrics = {
    name,
    timestamp: new Date().toISOString(),
    nodeVersion: NODE_VERSION,
    build: {
      number: process.env.BUILDKITE_BUILD_NUMBER ?? 'local',
      branch: process.env.BUILDKITE_BRANCH ?? 'local',
      commit: process.env.BUILDKITE_COMMIT ?? 'unknown'
    },
    results: []
  }

  if (name.includes('transport')) {
    const durationRegex = /Duration:\s+([\d.]+)ms/g
    const heapRegex = /Heap delta:\s+([\d.]+)MB/g
    const opsRegex = /Ops\/sec:\s+([\d,]+)/g

    const durations = [...output.matchAll(durationRegex)].map(m => parseFloat(m[1]))
    const heaps = [...output.matchAll(heapRegex)].map(m => parseFloat(m[1]))
    const ops = [...output.matchAll(opsRegex)].map(m => parseInt(m[1].replace(/,/g, '')))

    const labels = ['baseline', 'original', 'optimized']
    durations.forEach((duration, i) => {
      if (labels[i] !== undefined) {
        metrics.results.push({
          scenario: labels[i],
          duration_ms: duration,
          heap_mb: heaps[i] ?? 0,
          ops_per_sec: ops[i] ?? 0
        })
      }
    })
  } else if (name.includes('headers')) {
    const match = output.match(/Duration:\s+([\d.]+)ms/)
    if (match != null) {
      metrics.results.push({
        scenario: 'headers_only',
        duration_ms: parseFloat(match[1]),
        ops_per_sec: 0
      })
    }
  } else if (name.includes('gc')) {
    const match = output.match(/Duration:\s+([\d.]+)ms/)
    if (match != null) {
      metrics.results.push({
        scenario: 'merge_strategy',
        duration_ms: parseFloat(match[1]),
        ops_per_sec: 0
      })
    }
  }

  return metrics
}

function loadBaseline (benchmarkName: string): BenchmarkMetrics | null {
  const baselinePath = path.join(BASELINE_DIR, `${benchmarkName}-node${NODE_VERSION}.json`)

  if (!fs.existsSync(baselinePath)) {
    console.log(`No baseline found at ${baselinePath}`)
    return null
  }

  try {
    const data = fs.readFileSync(baselinePath, 'utf-8')
    return JSON.parse(data)
  } catch (error: any) {
    console.error(`Failed to load baseline: ${error.message}`)
    return null
  }
}

function compareWithBaseline (current: BenchmarkMetrics, baseline: BenchmarkMetrics | null): Comparison {
  if (baseline == null || baseline.results == null) {
    return { hasRegression: false, comparisons: [] }
  }

  const comparisons: ComparisonResult[] = []
  let hasRegression = false

  current.results.forEach(currentResult => {
    const baselineResult = baseline.results.find(r => r.scenario === currentResult.scenario)

    if (baselineResult == null) {
      comparisons.push({
        scenario: currentResult.scenario,
        status: 'new',
        message: 'New scenario (no baseline)',
        current: currentResult.duration_ms
      })
      return
    }

    const change = (currentResult.duration_ms - baselineResult.duration_ms) / baselineResult.duration_ms
    const changePercent = (change * 100).toFixed(1)

    let status: ComparisonResult['status'] = 'pass'
    let message = `${changePercent}% change`

    if (change > THRESHOLDS.FAIL) {
      status = 'fail'
      message = `${changePercent}% slower (threshold: ${THRESHOLDS.FAIL * 100}%)`
      hasRegression = true
    } else if (change > THRESHOLDS.WARN) {
      status = 'warn'
      message = `${changePercent}% slower (threshold: ${THRESHOLDS.WARN * 100}%)`
    } else if (change < -0.05) {
      status = 'improvement'
      message = `${Math.abs(parseFloat(changePercent))}% faster`
    } else {
      message = `${changePercent}% change (within threshold)`
    }

    comparisons.push({
      scenario: currentResult.scenario,
      status,
      message,
      current: currentResult.duration_ms,
      baseline: baselineResult.duration_ms,
      change: changePercent
    })
  })

  return { hasRegression, comparisons }
}

function generateMarkdown (benchmarkName: string, metrics: BenchmarkMetrics, comparison: Comparison): string {
  let md = `## ${benchmarkName}\n\n`
  md += `**Node.js**: ${metrics.nodeVersion}\n`
  md += `**Timestamp**: ${metrics.timestamp}\n\n`

  md += '### Results\n\n'
  md += '| Scenario | Duration (ms) | Heap (MB) | Ops/sec |\n'
  md += '|----------|--------------|-----------|----------|\n'

  metrics.results.forEach(result => {
    md += `| ${result.scenario} | ${result.duration_ms.toFixed(2)} | `
    md += `${(result.heap_mb ?? 0).toFixed(2)} | `
    md += `${(result.ops_per_sec ?? 0).toLocaleString()} |\n`
  })

  if (comparison.comparisons.length > 0) {
    md += '\n### Comparison vs Baseline\n\n'
    md += '| Scenario | Status | Change | Current | Baseline |\n'
    md += '|----------|--------|--------|---------|----------|\n'

    comparison.comparisons.forEach(comp => {
      md += `| ${comp.scenario} | ${comp.status} | `

      if (comp.change !== undefined) {
        md += `${comp.change}% | ${comp.current?.toFixed(2)}ms | ${comp.baseline?.toFixed(2)}ms |\n`
      } else {
        md += `new | ${comp.current?.toFixed(2) ?? 'N/A'}ms | N/A |\n`
      }
    })

    md += `\n${comparison.comparisons.map(c => c.message).join('\n')}\n`
  }

  md += '\n---\n\n'
  return md
}

function main (): void {
  console.log('='.repeat(70))
  console.log('Elastic Transport Benchmark Suite')
  console.log('='.repeat(70))
  console.log(`Node.js version: ${NODE_VERSION}`)
  console.log(`Results directory: ${RESULTS_DIR}`)
  console.log(`Baseline directory: ${BASELINE_DIR}`)
  console.log('='.repeat(70))

  const benchmarks = [
    { name: 'benchmark-transport', script: 'benchmark-transport.ts' },
    { name: 'benchmark-headers', script: 'benchmark-headers-only.ts' },
    { name: 'benchmark-gc', script: 'benchmark-gc.ts' }
  ]

  const allResults: BenchmarkMetrics[] = []
  const allComparisons: Comparison[] = []
  let hasAnyRegression = false

  for (const benchmark of benchmarks) {
    const scriptPath = path.join(__dirname, benchmark.script)

    if (!fs.existsSync(scriptPath)) {
      console.warn(`Benchmark script not found: ${scriptPath}`)
      continue
    }

    const result = runBenchmark(benchmark.name, scriptPath)

    if (!result.success) {
      console.error(`Benchmark ${benchmark.name} failed:`)
      console.error(result.error)
      continue
    }

    const metrics = parseBenchmarkOutput(benchmark.name, result.output)

    const baseline = loadBaseline(benchmark.name)
    const comparison = compareWithBaseline(metrics, baseline)

    if (comparison.hasRegression) {
      hasAnyRegression = true
    }

    const jsonPath = path.join(RESULTS_DIR, `${benchmark.name}-node${NODE_VERSION}.json`)
    fs.writeFileSync(jsonPath, JSON.stringify(metrics, null, 2))
    console.log(`Saved JSON results: ${jsonPath}`)

    const markdown = generateMarkdown(benchmark.name, metrics, comparison)
    const mdPath = path.join(RESULTS_DIR, `results-node${NODE_VERSION}.md`)
    fs.appendFileSync(mdPath, markdown)
    console.log(`Appended markdown results: ${mdPath}`)

    if (comparison.comparisons.length > 0) {
      const compPath = path.join(RESULTS_DIR, `comparison-${benchmark.name}-node${NODE_VERSION}.md`)
      fs.writeFileSync(compPath, markdown)
      allComparisons.push(comparison)
    }

    allResults.push(metrics)
  }

  const summary = {
    timestamp: new Date().toISOString(),
    nodeVersion: NODE_VERSION,
    hasRegression: hasAnyRegression,
    benchmarks: allResults,
    comparisons: allComparisons
  }

  const summaryPath = path.join(RESULTS_DIR, `summary-node${NODE_VERSION}.json`)
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  console.log(`Saved summary: ${summaryPath}`)

  console.log('\n' + '='.repeat(70))
  console.log('Benchmark Suite Complete')
  console.log('='.repeat(70))

  if (hasAnyRegression) {
    console.error('PERFORMANCE REGRESSION DETECTED')
    process.exit(1)
  } else {
    console.log('All benchmarks passed')
  }
}

main()

