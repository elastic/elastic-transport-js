/**
 * Real Transport Benchmark with Middleware
 * 
 * Compares the performance of Transport with middleware enabled vs legacy mode.
 * Tests actual implementation with real features:
 * - Middleware stack (OpenTelemetry, Headers, Compression, etc.)
 * - Real Serializer (JSON serialization)
 * - Real compression (gzip)
 * - Real connection pool
 * - Real retry logic
 * - Real error handling
 * - Mock network I/O (no actual HTTP)
 */

const Transport = require('../../lib/Transport').default
const { ClusterConnectionPool } = require('../../lib/pool')
const BaseConnection = require('../../lib/connection/BaseConnection').default

// Mock connection that simulates responses without network I/O
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
    // Enable/disable middleware with internal flag
    _disableMiddleware: !config.useMiddleware
  })
}

async function runBenchmark() {
  console.log('='.repeat(70))
  console.log('Real Transport Benchmark with Middleware')
  console.log('='.repeat(70))
  console.log('Testing actual Transport implementation with:')
  console.log('  - Middleware stack (OpenTelemetry, Headers, Compression, etc.)')
  console.log('  - Real Serializer (JSON serialization)')
  console.log('  - Real compression (gzip)')
  console.log('  - Real connection pool')
  console.log('  - Real retry logic')
  console.log('  - Real error handling')
  console.log('  - Mock network I/O (no actual HTTP)')
  console.log('')
  console.log('Scenarios test middleware enabled vs legacy (no middleware)')
  console.log('='.repeat(70))

  const scenarios = [
    {
      name: 'Legacy (baseline)',
      config: {
        useMiddleware: false,
        compression: false,
        maxRetries: 0
      }
    },
    {
      name: 'Legacy + compression',
      config: {
        useMiddleware: false,
        compression: true,
        maxRetries: 0
      }
    },
    {
      name: 'Legacy + retries',
      config: {
        useMiddleware: false,
        compression: false,
        maxRetries: 3
      }
    },
    {
      name: 'Legacy + all features',
      config: {
        useMiddleware: false,
        compression: true,
        maxRetries: 3
      }
    },
    {
      name: 'Middleware (baseline)',
      config: {
        useMiddleware: true,
        compression: false,
        maxRetries: 0
      }
    },
    {
      name: 'Middleware + compression',
      config: {
        useMiddleware: true,
        compression: true,
        maxRetries: 0
      }
    },
    {
      name: 'Middleware + retries',
      config: {
        useMiddleware: true,
        compression: false,
        maxRetries: 3
      }
    },
    {
      name: 'Middleware + all features',
      config: {
        useMiddleware: true,
        compression: true,
        maxRetries: 3
      }
    }
  ]

  const iterations = 5000
  const results = []

  for (const scenario of scenarios) {
    const transport = createTransport(scenario.config)
    
    // Warm up
    for (let i = 0; i < 100; i++) {
      await transport.request({
        method: 'POST',
        path: '/_search',
        body: { query: { match_all: {} } }
      })
    }

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
    const durationMs = (durationNs / 1_000_000).toFixed(2)
    const avgLatencyMs = (durationNs / iterations / 1_000_000).toFixed(3)
    const opsPerSec = Math.floor(iterations / (durationNs / 1_000_000_000))

    const result = {
      name: scenario.name,
      config: scenario.config,
      iterations,
      durationMs,
      avgLatencyMs,
      opsPerSec: opsPerSec.toLocaleString()
    }
    
    results.push(result)
    
    console.log(`\n--- ${scenario.name} ---`)
    console.log(`  Iterations:    ${iterations}`)
    console.log(`  Duration:      ${durationMs}ms`)
    console.log(`  Ops/sec:       ${result.opsPerSec}`)
    console.log(`  Avg latency:   ${result.avgLatencyMs}ms`)
  }

  // Summary comparison
  console.log('\n' + '='.repeat(70))
  console.log('Performance Comparison')
  console.log('='.repeat(70))
  console.log(`${'Scenario'.padEnd(40)} ${'Ops/sec'.padEnd(12)} ${'Latency (ms)'}`)
  console.log('-'.repeat(70))

  for (const result of results) {
    console.log(
      `${result.name.padEnd(40)} ${result.opsPerSec.padEnd(12)} ${result.avgLatencyMs}`
    )
  }

  console.log('\n' + '='.repeat(70))
  console.log('Side-by-Side Comparison (Legacy vs Middleware)')
  console.log('='.repeat(70))
  console.log(`${'Feature Set'.padEnd(25)} ${'Legacy (ms)'.padEnd(15)} ${'Middleware (ms)'.padEnd(18)} Overhead`)
  console.log('-'.repeat(70))

  const comparisons = [
    { feature: 'Baseline', legacyIdx: 0, middlewareIdx: 4 },
    { feature: 'With compression', legacyIdx: 1, middlewareIdx: 5 },
    { feature: 'With retries', legacyIdx: 2, middlewareIdx: 6 },
    { feature: 'All features', legacyIdx: 3, middlewareIdx: 7 }
  ]

  for (const comp of comparisons) {
    const legacy = results[comp.legacyIdx]
    const middleware = results[comp.middlewareIdx]
    const overhead = ((parseFloat(middleware.avgLatencyMs) / parseFloat(legacy.avgLatencyMs) - 1) * 100).toFixed(1)
    const sign = overhead >= 0 ? '+' : ''
    
    console.log(
      `${comp.feature.padEnd(25)} ${legacy.avgLatencyMs.padEnd(15)} ${middleware.avgLatencyMs.padEnd(18)} ${sign}${overhead}%`
    )
  }

  return results
}

runBenchmark()
  .then(() => {
    console.log('\nBenchmark complete!')
    process.exit(0)
  })
  .catch(err => {
    console.error('Benchmark failed:', err)
    process.exit(1)
  })

