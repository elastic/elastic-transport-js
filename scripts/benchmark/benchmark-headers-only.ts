/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

// Benchmark middleware overhead WITHOUT compression (fair comparison)

import { MiddlewareEngine } from '../../src/middleware/MiddlewareEngine'
import { MiddlewareContext, MiddlewareResult, Middleware } from '../../src/middleware/types'

// Mock OpenTelemetry middleware
class MockOpenTelemetryMiddleware implements Middleware {
  readonly name = 'opentelemetry'
  readonly priority = 5

  onBeforeRequestSync = (ctx: MiddlewareContext): MiddlewareResult | undefined => {
    const shared = new Map(ctx.shared)
    shared.set('otelSpan', { startTime: Date.now() })
    return {
      context: {
        request: {
          headers: { 'x-trace-id': 'trace-123' }
        },
        shared
      }
    }
  }
}

// Mock Authentication middleware
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

// Mock Kibana middleware
class MockKibanaMiddleware implements Middleware {
  readonly name = 'kibana'
  readonly priority = 15

  onBeforeRequestSync = (ctx: MiddlewareContext): MiddlewareResult | undefined => {
    return {
      context: {
        request: {
          headers: { 'x-elastic-product-origin': 'kibana' }
        }
      }
    }
  }
}

// Mock Content-Type middleware
class MockContentTypeMiddleware implements Middleware {
  readonly name = 'content-type'
  readonly priority = 20

  onBeforeRequestSync = (ctx: MiddlewareContext): MiddlewareResult | undefined => {
    return {
      context: {
        request: {
          headers: { 'content-type': 'application/json' }
        }
      }
    }
  }
}

// Mock Retry middleware
class MockRetryMiddleware implements Middleware {
  readonly name = 'retry'
  readonly priority = 60

  onBeforeRequestSync = (ctx: MiddlewareContext): MiddlewareResult | undefined => {
    const shared = new Map(ctx.shared)
    shared.set('retryCount', 0)
    return {
      context: {
        shared
      }
    }
  }
}

// Baseline: Current Transport behavior
async function runBaseline (iterations: number): Promise<{ duration: number, heapDelta: number }> {
  const context: MiddlewareContext = {
    request: {
      method: 'POST',
      path: '/test/_search',
      body: 'test data',
      headers: {}
    },
    options: {},
    shared: new Map()
  }

  if (global.gc != null) global.gc()
  const startMem = process.memoryUsage()
  const startTime = process.hrtime.bigint()

  for (let i = 0; i < iterations; i++) {
    const headers = {
      ...context.request.headers,
      'x-trace-id': 'trace-123',
      authorization: 'Bearer token',
      'x-elastic-product-origin': 'kibana',
      'content-type': 'application/json'
    }
    void headers
  }

  const endTime = process.hrtime.bigint()
  if (global.gc != null) global.gc()
  const endMem = process.memoryUsage()

  return {
    duration: Number(endTime - startTime) / 1_000_000,
    heapDelta: endMem.heapUsed - startMem.heapUsed
  }
}

// Middleware with sync handlers
async function runMiddleware (iterations: number): Promise<{ duration: number, heapDelta: number }> {
  const engine = new MiddlewareEngine()
  
  engine.register(new MockOpenTelemetryMiddleware())
  engine.register(new MockAuthMiddleware())
  engine.register(new MockKibanaMiddleware())
  engine.register(new MockContentTypeMiddleware())
  engine.register(new MockRetryMiddleware())

  const context: MiddlewareContext = {
    request: {
      method: 'POST',
      path: '/test/_search',
      body: 'test data',
      headers: {}
    },
    options: {},
    shared: new Map()
  }

  if (global.gc != null) global.gc()
  const startMem = process.memoryUsage()
  const startTime = process.hrtime.bigint()

  for (let i = 0; i < iterations; i++) {
    const result = await engine.executePhase('onBeforeRequest', context)
    void result.context
  }

  const endTime = process.hrtime.bigint()
  if (global.gc != null) global.gc()
  const endMem = process.memoryUsage()

  return {
    duration: Number(endTime - startTime) / 1_000_000,
    heapDelta: endMem.heapUsed - startMem.heapUsed
  }
}

async function main (): Promise<void> {
  const iterations = 100000

  console.log('='.repeat(70))
  console.log('Middleware Overhead Benchmark (Headers Only - No Compression)')
  console.log('='.repeat(70))
  console.log(`Iterations: ${iterations.toLocaleString()}`)
  console.log(`GC exposed: ${global.gc != null ? 'YES' : 'NO (run with --expose-gc)'}`)
  console.log('\nMiddleware stack (5 total):')
  console.log('  1. OpenTelemetry headers (sync)')
  console.log('  2. Authentication headers (sync)')
  console.log('  3. Kibana headers (sync)')
  console.log('  4. Content-Type header (sync)')
  console.log('  5. Retry tracking (sync)')

  console.log('\n' + '-'.repeat(70))
  console.log('Running benchmarks...')
  console.log('-'.repeat(70))

  const baseline = await runBaseline(iterations)
  console.log(`\nBaseline (inline header manipulation):`)
  console.log(`   Duration: ${baseline.duration.toFixed(2)}ms`)
  console.log(`   Heap delta: ${(baseline.heapDelta / 1024 / 1024).toFixed(2)}MB`)
  console.log(`   Ops/sec: ${(iterations / (baseline.duration / 1000)).toFixed(0)}`)
  console.log(`   Per-op latency: ${(baseline.duration / iterations * 1000).toFixed(3)}μs`)

  const middleware = await runMiddleware(iterations)
  console.log(`\nMiddleware (sync handlers):`)
  console.log(`   Duration: ${middleware.duration.toFixed(2)}ms`)
  console.log(`   Heap delta: ${(middleware.heapDelta / 1024 / 1024).toFixed(2)}MB`)
  console.log(`   Ops/sec: ${(iterations / (middleware.duration / 1000)).toFixed(0)}`)
  console.log(`   Per-op latency: ${(middleware.duration / iterations * 1000).toFixed(3)}μs`)
  console.log(`   Overhead: +${((middleware.duration / baseline.duration - 1) * 100).toFixed(1)}%`)
  console.log(`   Added latency: ${((middleware.duration - baseline.duration) / iterations * 1000).toFixed(3)}μs per request`)

  console.log('\n' + '='.repeat(70))
  console.log('Analysis:')
  console.log('='.repeat(70))
  console.log(`Baseline per-request: ${(baseline.duration / iterations * 1000).toFixed(3)}μs`)
  console.log(`Middleware per-request: ${(middleware.duration / iterations * 1000).toFixed(3)}μs`)
  console.log(`Middleware overhead: ${((middleware.duration - baseline.duration) / iterations * 1000).toFixed(3)}μs`)
  console.log(`\nAt 1,000 req/sec: ${((middleware.duration - baseline.duration) / iterations).toFixed(3)}ms added latency`)
  console.log(`At 10,000 req/sec: ${((middleware.duration - baseline.duration) / iterations * 10).toFixed(3)}ms added latency`)
  console.log('='.repeat(70))
}

main().catch(console.error)

