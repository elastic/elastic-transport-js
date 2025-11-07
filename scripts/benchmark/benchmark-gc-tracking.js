/**
 * GC Tracking Benchmark
 * 
 * Measures garbage collection behavior and memory usage during benchmarks.
 * Outputs structured JSON data for analysis.
 * 
 * Run: node --expose-gc scripts/benchmark/benchmark-gc-tracking.js > benchmark-results/gc-tracking-results.json
 */

const { PerformanceObserver, performance } = require('perf_hooks')
const Transport = require('../../lib/Transport').default
const { ClusterConnectionPool } = require('../../lib/pool')
const BaseConnection = require('../../lib/connection/BaseConnection').default

class MockConnection extends BaseConnection {
  async request(params, options) {
    return new Promise((resolve) => {
      const body = JSON.stringify({ acknowledged: true, result: 'success' })
      const response = {
        body,
        statusCode: 200,
        headers: {
          'content-type': 'application/json;utf=8',
          'content-length': String(body.length),
          'x-elastic-product': 'Elasticsearch',
          connection: 'keep-alive',
          date: new Date().toISOString()
        }
      }
      process.nextTick(resolve, response)
    })
  }
}

function createTransport(config = {}) {
  const pool = new ClusterConnectionPool({ Connection: MockConnection })
  pool.addConnection('http://localhost:9200')
  
  return new Transport({
    connectionPool: pool,
    compression: config.compression || false,
    maxRetries: config.maxRetries || 0,
    _disableMiddleware: !config.useMiddleware
  })
}

// Collect GC events
const gcEvents = []
const obs = new PerformanceObserver((list) => {
  const entries = list.getEntries()
  entries.forEach((entry) => {
    gcEvents.push({
      type: entry.detail?.kind || 'unknown',
      duration: entry.duration,
      startTime: entry.startTime,
      flags: entry.detail?.flags
    })
  })
})

obs.observe({ entryTypes: ['gc'], buffered: true })

async function runWithGCTracking() {
  const scenarios = [
    {
      name: 'Legacy (baseline)',
      config: { useMiddleware: false, compression: false, maxRetries: 0 }
    },
    {
      name: 'Legacy + compression',
      config: { useMiddleware: false, compression: true, maxRetries: 0 }
    },
    {
      name: 'Middleware (baseline)',
      config: { useMiddleware: true, compression: false, maxRetries: 0 }
    },
    {
      name: 'Middleware + compression',
      config: { useMiddleware: true, compression: true, maxRetries: 0 }
    }
  ]

  const iterations = 5000
  const results = []

  for (const scenario of scenarios) {
    // Clear GC events for this scenario
    gcEvents.length = 0
    
    // Force GC before starting
    if (global.gc) {
      global.gc()
    }
    
    const memoryBefore = process.memoryUsage()
    const transport = createTransport(scenario.config)
    
    // Warm up
    for (let i = 0; i < 100; i++) {
      await transport.request({
        method: 'POST',
        path: '/_search',
        body: { query: { match_all: {} } }
      })
    }

    // Clear GC events after warmup
    gcEvents.length = 0
    
    // Force GC before measurement
    if (global.gc) {
      global.gc()
    }
    
    const memoryAfterWarmup = process.memoryUsage()

    // Measure
    const start = process.hrtime.bigint()
    
    for (let i = 0; i < iterations; i++) {
      await transport.request({
        method: 'POST',
        path: '/_search',
        body: { query: { match_all: {} } }
      })
    }
    
    const end = process.hrtime.bigint()
    const durationNs = Number(end - start)
    
    // Force GC after measurement
    if (global.gc) {
      global.gc()
    }
    
    const memoryAfter = process.memoryUsage()

    // Calculate GC statistics
    const gcStats = {
      totalEvents: gcEvents.length,
      totalDuration: gcEvents.reduce((sum, e) => sum + e.duration, 0),
      avgDuration: gcEvents.length > 0 
        ? gcEvents.reduce((sum, e) => sum + e.duration, 0) / gcEvents.length 
        : 0,
      maxDuration: gcEvents.length > 0
        ? Math.max(...gcEvents.map(e => e.duration))
        : 0,
      byType: {}
    }

    // Group by GC type
    gcEvents.forEach(event => {
      if (!gcStats.byType[event.type]) {
        gcStats.byType[event.type] = {
          count: 0,
          totalDuration: 0,
          avgDuration: 0
        }
      }
      gcStats.byType[event.type].count++
      gcStats.byType[event.type].totalDuration += event.duration
    })

    // Calculate averages
    Object.keys(gcStats.byType).forEach(type => {
      const stat = gcStats.byType[type]
      stat.avgDuration = stat.totalDuration / stat.count
    })

    const result = {
      scenario: scenario.name,
      config: scenario.config,
      performance: {
        iterations,
        durationMs: (durationNs / 1_000_000).toFixed(2),
        avgLatencyMs: (durationNs / iterations / 1_000_000).toFixed(3),
        opsPerSec: Math.floor(iterations / (durationNs / 1_000_000_000))
      },
      gc: gcStats,
      memory: {
        before: {
          heapUsed: memoryBefore.heapUsed,
          heapTotal: memoryBefore.heapTotal,
          external: memoryBefore.external,
          arrayBuffers: memoryBefore.arrayBuffers || 0
        },
        afterWarmup: {
          heapUsed: memoryAfterWarmup.heapUsed,
          heapTotal: memoryAfterWarmup.heapTotal,
          external: memoryAfterWarmup.external,
          arrayBuffers: memoryAfterWarmup.arrayBuffers || 0
        },
        after: {
          heapUsed: memoryAfter.heapUsed,
          heapTotal: memoryAfter.heapTotal,
          external: memoryAfter.external,
          arrayBuffers: memoryAfter.arrayBuffers || 0
        },
        delta: {
          heapUsed: memoryAfter.heapUsed - memoryAfterWarmup.heapUsed,
          heapTotal: memoryAfter.heapTotal - memoryAfterWarmup.heapTotal,
          external: memoryAfter.external - memoryAfterWarmup.external
        }
      }
    }
    
    results.push(result)
  }

  return results
}

// Run and output JSON
runWithGCTracking()
  .then(results => {
    const output = {
      metadata: {
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: require('os').cpus().length,
        totalMemory: require('os').totalmem(),
        freeMemory: require('os').freemem()
      },
      results
    }
    
    console.log(JSON.stringify(output, null, 2))
    process.exit(0)
  })
  .catch(err => {
    console.error(JSON.stringify({ error: err.message, stack: err.stack }))
    process.exit(1)
  })

