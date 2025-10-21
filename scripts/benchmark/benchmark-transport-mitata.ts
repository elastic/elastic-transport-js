/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { bench, run, group } from 'mitata'
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

// Baseline: Current Transport behavior WITH compression
async function baselineTransport (context: MiddlewareContext): Promise<void> {
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

group('Transport Performance', () => {
  bench('baseline (no middleware)', async () => {
    await baselineTransport(context)
  })

  bench('with middleware stack', async () => {
    let ctx = context
    const r1 = await engine.executePhase('onBeforeRequest', ctx)
    ctx = r1.context
    const r2 = await engine.executePhase('onRequest', ctx)
    ctx = r2.context
    await engine.executePhase('onComplete', ctx)
  })
})

group('Headers Only (no compression)', () => {
  const noBodyContext: MiddlewareContext = {
    request: {
      method: 'GET',
      path: '/test/_search',
      headers: {}
    },
    options: {},
    shared: new Map()
  }

  bench('inline headers', () => {
    const headers = {
      ...noBodyContext.request.headers,
      'x-trace-id': 'trace-123',
      authorization: 'Bearer token',
      'x-elastic-product-origin': 'kibana'
    }
    void headers
  })

  bench('middleware headers', async () => {
    let ctx = noBodyContext
    const r1 = await engine.executePhase('onBeforeRequest', ctx)
    ctx = r1.context
  })
})

console.log('='.repeat(70))
console.log('Elastic Transport Benchmark (Mitata)')
console.log('='.repeat(70))
console.log(`Node.js version: ${process.version}`)
console.log(`Mitata provides statistical analysis with:`)
console.log('  - Mean, Median, p75, p99, p999')
console.log('  - Standard deviation')
console.log('  - Iterations per second')
console.log('  - Warmup cycles for JIT optimization')
console.log('='.repeat(70))

run({
  units: false,
  silent: false,
  avg: true,
  json: false,
  colors: true,
  min_max: true,
  percentiles: true
})

