/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compares three scenarios:
 * 1. Baseline: Current Transport (no middleware)
 * 2. With Middleware (Original): Deep merge spreading
 * 3. With Middleware (Optimized): Conditional merge
 */

import { MiddlewareEngine } from '../../src/middleware/MiddlewareEngine'
import { CompressionMiddleware } from '../../src/middleware/CompressionMiddleware'
import { MiddlewareContext, MiddlewareResult, Middleware } from '../../src/middleware/types'
import * as zlib from 'node:zlib'
import { promisify } from 'node:util'

const gzipCompress = promisify(zlib.gzip)

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

  onComplete = async (ctx: MiddlewareContext): Promise<void> => {
    // Cleanup phase
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

// Original deep merge implementation
function deepMergeOriginal (current: MiddlewareContext, updates: NonNullable<MiddlewareResult['context']>): MiddlewareContext {
  return {
    ...current,
    request: updates.request != null
      ? {
          ...current.request,
          ...updates.request,
          headers: updates.request.headers != null
            ? {
                ...current.request.headers,
                ...updates.request.headers
              }
            : current.request.headers
        }
      : current.request,
    shared: updates.shared ?? current.shared
  }
}

// Baseline: Current Transport behavior WITH compression
async function baselineTransport (context: MiddlewareContext): Promise<void> {
  // Inline header manipulation like current Transport
  const headers = {
    ...context.request.headers,
    'x-trace-id': 'trace-123',
    authorization: 'Bearer token',
    'x-elastic-product-origin': 'kibana',
    'accept-encoding': 'gzip,deflate',
    'content-encoding': 'gzip'
  }

  if (context.request.body != null && context.request.body !== '') {
    const bodyStr = typeof context.request.body === 'string' ? context.request.body : context.request.body.toString()
    const compressedBody = await gzipCompress(bodyStr)
    void compressedBody
  }
}

// Middleware with original merge
async function middlewareOriginal (iterations: number): Promise<{ duration: number, heapDelta: number }> {
  const engine = new MiddlewareEngine()
  
  // Override mergeContext with original implementation
  ;(engine as any).mergeContext = deepMergeOriginal

  engine.register(new MockOpenTelemetryMiddleware())
  engine.register(new MockAuthMiddleware())
  engine.register(new MockKibanaMiddleware())
  engine.register(new CompressionMiddleware({ enabled: true }))
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
    let ctx = context
    const r1 = await engine.executePhase('onBeforeRequest', ctx)
    ctx = r1.context
    const r2 = await engine.executePhase('onRequest', ctx)
    ctx = r2.context
    await engine.executePhase('onComplete', ctx)
  }

  const endTime = process.hrtime.bigint()
  if (global.gc != null) global.gc()
  const endMem = process.memoryUsage()

  return {
    duration: Number(endTime - startTime) / 1_000_000,
    heapDelta: endMem.heapUsed - startMem.heapUsed
  }
}

// Middleware with optimized merge
async function middlewareOptimized (iterations: number): Promise<{ duration: number, heapDelta: number }> {
  const engine = new MiddlewareEngine()
  
  engine.register(new MockOpenTelemetryMiddleware())
  engine.register(new MockAuthMiddleware())
  engine.register(new MockKibanaMiddleware())
  engine.register(new CompressionMiddleware({ enabled: true }))
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
    let ctx = context
    const r1 = await engine.executePhase('onBeforeRequest', ctx)
    ctx = r1.context
    const r2 = await engine.executePhase('onRequest', ctx)
    ctx = r2.context
    await engine.executePhase('onComplete', ctx)
  }

  const endTime = process.hrtime.bigint()
  if (global.gc != null) global.gc()
  const endMem = process.memoryUsage()

  return {
    duration: Number(endTime - startTime) / 1_000_000,
    heapDelta: endMem.heapUsed - startMem.heapUsed
  }
}

// Baseline (current Transport, no middleware)
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
    await baselineTransport(context)
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
  const iterations = 10000

  console.log('='.repeat(70))
  console.log('Transport Performance Benchmark: Baseline vs Middleware')
  console.log('='.repeat(70))
  console.log(`Iterations: ${iterations.toLocaleString()}`)
  console.log(`GC exposed: ${global.gc != null ? 'YES' : 'NO (run with --expose-gc)'}`)
  console.log(`\nMiddleware stack (5 total):`)
  console.log('  1. OpenTelemetry (priority: 5)')
  console.log('  2. Authentication (priority: 10)')
  console.log('  3. Kibana headers (priority: 15)')
  console.log('  4. Compression (priority: 20)')
  console.log('  5. Retry tracking (priority: 60)')

  console.log('\n' + '-'.repeat(70))
  console.log('Running benchmarks...')
  console.log('-'.repeat(70))

  const baseline = await runBaseline(iterations)
  console.log(`\nBaseline (Current Transport, no middleware):`)
  console.log(`   Duration: ${baseline.duration.toFixed(2)}ms`)
  console.log(`   Heap delta: ${(baseline.heapDelta / 1024 / 1024).toFixed(2)}MB`)
  console.log(`   Ops/sec: ${(iterations / (baseline.duration / 1000)).toFixed(0)}`)

  const original = await middlewareOriginal(iterations)
  console.log(`\nMiddleware with Original Merge:`)
  console.log(`   Duration: ${original.duration.toFixed(2)}ms`)
  console.log(`   Heap delta: ${(original.heapDelta / 1024 / 1024).toFixed(2)}MB`)
  console.log(`   Ops/sec: ${(iterations / (original.duration / 1000)).toFixed(0)}`)
  console.log(`   Overhead vs baseline: +${((original.duration / baseline.duration - 1) * 100).toFixed(1)}%`)

  const optimized = await middlewareOptimized(iterations)
  console.log(`\nMiddleware with Optimized Merge:`)
  console.log(`   Duration: ${optimized.duration.toFixed(2)}ms`)
  console.log(`   Heap delta: ${(optimized.heapDelta / 1024 / 1024).toFixed(2)}MB`)
  console.log(`   Ops/sec: ${(iterations / (optimized.duration / 1000)).toFixed(0)}`)
  console.log(`   Overhead vs baseline: +${((optimized.duration / baseline.duration - 1) * 100).toFixed(1)}%`)
  console.log(`   Improvement vs original: ${((original.duration / optimized.duration - 1) * 100).toFixed(1)}% faster`)

  console.log('\n' + '='.repeat(70))
  console.log('Summary:')
  console.log('='.repeat(70))
  console.log(`Baseline:              ${baseline.duration.toFixed(2)}ms (${(iterations / (baseline.duration / 1000)).toFixed(0)} ops/sec)`)
  console.log(`Original Middleware:   ${original.duration.toFixed(2)}ms (${(iterations / (original.duration / 1000)).toFixed(0)} ops/sec) +${((original.duration / baseline.duration - 1) * 100).toFixed(1)}%`)
  console.log(`Optimized Middleware:  ${optimized.duration.toFixed(2)}ms (${(iterations / (optimized.duration / 1000)).toFixed(0)} ops/sec) +${((optimized.duration / baseline.duration - 1) * 100).toFixed(1)}%`)
  console.log('='.repeat(70))
}

main().catch(console.error)

