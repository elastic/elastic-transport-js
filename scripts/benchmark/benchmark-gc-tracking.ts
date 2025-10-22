/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Benchmark with GC tracking using perf_hooks
 * Shows when and how long GC events take during middleware execution
 */

import { PerformanceObserver, performance, constants } from 'node:perf_hooks'
import { MiddlewareEngine } from '../../src/middleware/MiddlewareEngine'
import { CompressionMiddleware } from '../../src/middleware/CompressionMiddleware'
import { MiddlewareContext, MiddlewareResult, Middleware } from '../../src/middleware/types'

interface GCEvent {
  kind: number
  kindName: string
  duration: number
  timestamp: number
}

interface HeapSnapshot {
  timestamp: number
  heapUsed: number
  heapTotal: number
  external: number
}

class BenchmarkWithGCTracking {
  private gcEvents: GCEvent[] = []
  private heapSnapshots: HeapSnapshot[] = []
  private gcObserver: PerformanceObserver
  private heapInterval: NodeJS.Timeout | null = null

  constructor () {
    this.gcObserver = new PerformanceObserver((items) => {
      items.getEntries().forEach((entry: any) => {
        this.gcEvents.push({
          kind: entry.kind,
          kindName: this.getGCKindName(entry.kind),
          duration: entry.duration,
          timestamp: entry.startTime
        })
      })
    })
    this.gcObserver.observe({ entryTypes: ['gc'] })
  }

  private getGCKindName (kind: number): string {
    const kinds: Record<number, string> = {
      [constants.NODE_PERFORMANCE_GC_MAJOR]: 'Major (Mark-Sweep-Compact)',
      [constants.NODE_PERFORMANCE_GC_MINOR]: 'Minor (Scavenge)',
      [constants.NODE_PERFORMANCE_GC_INCREMENTAL]: 'Incremental',
      [constants.NODE_PERFORMANCE_GC_WEAKCB]: 'Weak Callbacks'
    }
    return kinds[kind] ?? `Unknown (${kind})`
  }

  startHeapTracking (intervalMs: number = 10): void {
    this.heapInterval = setInterval(() => {
      const mem = process.memoryUsage()
      this.heapSnapshots.push({
        timestamp: Date.now(),
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external
      })
    }, intervalMs)
  }

  stopHeapTracking (): void {
    if (this.heapInterval != null) {
      clearInterval(this.heapInterval)
      this.heapInterval = null
    }
  }

  cleanup (): void {
    this.gcObserver.disconnect()
    this.stopHeapTracking()
  }

  getGCStats () {
    const totalGCTime = this.gcEvents.reduce((sum, e) => sum + e.duration, 0)
    const gcByKind = this.gcEvents.reduce((acc, e) => {
      if (acc[e.kindName] == null) acc[e.kindName] = { count: 0, totalTime: 0 }
      acc[e.kindName].count++
      acc[e.kindName].totalTime += e.duration
      return acc
    }, {} as Record<string, { count: number, totalTime: number }>)

    return {
      totalEvents: this.gcEvents.length,
      totalGCTime,
      byKind: gcByKind,
      events: this.gcEvents
    }
  }

  getHeapStats () {
    if (this.heapSnapshots.length === 0) return null

    const heapUsedValues = this.heapSnapshots.map(s => s.heapUsed)
    const min = Math.min(...heapUsedValues)
    const max = Math.max(...heapUsedValues)
    const avg = heapUsedValues.reduce((a, b) => a + b, 0) / heapUsedValues.length

    return {
      samples: heapUsedValues.length,
      minHeapUsed: min,
      maxHeapUsed: max,
      avgHeapUsed: avg,
      heapGrowth: max - min,
      snapshots: this.heapSnapshots
    }
  }
}

class MockAuthMiddleware implements Middleware {
  readonly name = 'auth'
  readonly priority = 10

  onBeforeRequestSync = (ctx: MiddlewareContext): MiddlewareResult | undefined => {
    return {
      context: {
        request: {
          headers: { authorization: 'Bearer token' }
        }
      }
    }
  }
}

async function runBenchmark (): Promise<void> {
  const tracker = new BenchmarkWithGCTracking()

  const engine = new MiddlewareEngine()
  engine.register(new MockAuthMiddleware())
  engine.register(new CompressionMiddleware({ enabled: true }))

  const context: MiddlewareContext = {
    request: {
      method: 'POST',
      path: '/test/_search',
      body: 'test data '.repeat(1000),
      headers: {}
    },
    options: {},
    shared: new Map()
  }

  console.log('='.repeat(70))
  console.log('Benchmark with GC Tracking')
  console.log('='.repeat(70))
  console.log('Starting benchmark with heap and GC monitoring...\n')

  if (global.gc != null) {
    console.log('Running initial GC...')
    global.gc()
  }

  const iterations = 10000
  tracker.startHeapTracking(5) // Sample every 5ms

  performance.mark('benchmark-start')
  const startMem = process.memoryUsage()
  const startTime = process.hrtime.bigint()

  for (let i = 0; i < iterations; i++) {
    let ctx = context
    const r1 = await engine.executePhase('onBeforeRequest', ctx)
    ctx = r1.context
    const r2 = await engine.executePhase('onRequest', ctx)
    ctx = r2.context
    await engine.executePhase('onComplete', ctx)
  }

  const endTime = process.hrtime.bigint()
  const endMem = process.memoryUsage()
  performance.mark('benchmark-end')
  performance.measure('benchmark-duration', 'benchmark-start', 'benchmark-end')

  tracker.stopHeapTracking()

  const duration = Number(endTime - startTime) / 1_000_000 // milliseconds
  const heapDelta = endMem.heapUsed - startMem.heapUsed

  console.log('\n' + '='.repeat(70))
  console.log('Benchmark Results')
  console.log('='.repeat(70))
  console.log(`Iterations: ${iterations.toLocaleString()}`)
  console.log(`Duration: ${duration.toFixed(2)}ms`)
  console.log(`Ops/sec: ${(iterations / (duration / 1000)).toFixed(0)}`)
  console.log(`Heap delta: ${(heapDelta / 1024 / 1024).toFixed(2)}MB`)

  console.log('\n' + '-'.repeat(70))
  console.log('GC Events')
  console.log('-'.repeat(70))
  const gcStats = tracker.getGCStats()
  console.log(`Total GC events: ${gcStats.totalEvents}`)
  console.log(`Total GC time: ${gcStats.totalGCTime.toFixed(2)}ms`)
  console.log(`GC overhead: ${((gcStats.totalGCTime / duration) * 100).toFixed(2)}%`)

  console.log('\nGC by type:')
  Object.entries(gcStats.byKind).forEach(([kind, stats]) => {
    console.log(`  ${kind}:`)
    console.log(`    Count: ${stats.count}`)
    console.log(`    Total time: ${stats.totalTime.toFixed(2)}ms`)
    console.log(`    Avg time: ${(stats.totalTime / stats.count).toFixed(2)}ms`)
  })

  const heapStats = tracker.getHeapStats()
  if (heapStats != null) {
    console.log('\n' + '-'.repeat(70))
    console.log('Heap Statistics')
    console.log('-'.repeat(70))
    console.log(`Samples: ${heapStats.samples}`)
    console.log(`Min heap: ${(heapStats.minHeapUsed / 1024 / 1024).toFixed(2)}MB`)
    console.log(`Max heap: ${(heapStats.maxHeapUsed / 1024 / 1024).toFixed(2)}MB`)
    console.log(`Avg heap: ${(heapStats.avgHeapUsed / 1024 / 1024).toFixed(2)}MB`)
    console.log(`Heap growth: ${(heapStats.heapGrowth / 1024 / 1024).toFixed(2)}MB`)
  }

  const results = {
    benchmark: {
      iterations,
      duration,
      opsPerSec: iterations / (duration / 1000),
      heapDelta
    },
    gc: gcStats,
    heap: heapStats
  }

  console.log('\n' + '='.repeat(70))
  console.log('Analysis')
  console.log('='.repeat(70))

  if (gcStats.totalEvents === 0) {
    console.log('No GC events during benchmark')
  } else {
    const gcOverhead = (gcStats.totalGCTime / duration) * 100
    if (gcOverhead < 5) {
      console.log(`Low GC overhead (${gcOverhead.toFixed(2)}%)`)
    } else if (gcOverhead < 10) {
      console.log(`Moderate GC overhead (${gcOverhead.toFixed(2)}%)`)
    } else {
      console.log(`High GC overhead (${gcOverhead.toFixed(2)}%)`)
    }
  }
  tracker.cleanup()

  const fs = await import('fs')
  const path = await import('path')
  const outputDir = path.join(__dirname, '../../benchmark-results')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }
  const outputPath = path.join(outputDir, 'gc-tracking-results.json')
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2))
  console.log(`\nDetailed results saved to: ${outputPath}`)
}

if (global.gc == null) {
  console.error('GC not exposed. Run with: npx tsx --expose-gc benchmark-gc-tracking.ts')
  process.exit(1)
}

runBenchmark().catch(console.error)

