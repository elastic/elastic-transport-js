/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * POC Example: How to use the middleware system
 */

import { MiddlewareEngine } from './MiddlewareEngine'
import { CompressionMiddleware } from './CompressionMiddleware'
import { MiddlewareContext } from './types'

// Example usage of the POC middleware system
export async function pocExample (): Promise<MiddlewareContext> {
  const engine = new MiddlewareEngine()

  // Register compression middleware
  engine.register(new CompressionMiddleware({ enabled: true }))

  // Create example context
  const context: MiddlewareContext = {
    request: {
      method: 'POST',
      path: '/test/_search',
      body: 'large request body that should be compressed',
      headers: {}
    },
    options: {},
    shared: new Map()
  }

  console.log('Original context:', context)

  // Execute middleware phases
  console.log('\n=== Executing onBeforeRequest ===')
  const beforeResult = await engine.executePhase('onBeforeRequest', context)
  console.log('After onBeforeRequest:', beforeResult.context.request.headers)

  console.log('\n=== Executing onRequest ===')
  const requestResult = await engine.executePhase('onRequest', beforeResult.context)
  console.log('After onRequest - body compressed:', Buffer.isBuffer(requestResult.context.request.body))
  console.log('Content-Encoding header:', requestResult.context.request.headers['content-encoding'])

  console.log('\n=== Executing onComplete ===')
  await engine.executePhase('onComplete', requestResult.context)

  return requestResult.context
}

// Example test
export function exampleTest (): void {
  const middleware = new CompressionMiddleware({ enabled: true })

  const testContext: MiddlewareContext = {
    request: {
      method: 'POST',
      path: '/test',
      body: 'test data',
      headers: {}
    },
    options: {},
    shared: new Map()
  }

  // Pure function testing
  const result = middleware.onBeforeRequest(testContext)

  // Original context unchanged (immutable)
  console.assert(testContext.request.headers['accept-encoding'] == null)

  // Result contains new context with changes
  if (result != null && 'context' in result && result.context != null) {
    const context = result.context as { request?: { headers?: Record<string, string> } }
    console.assert(context.request?.headers?.['accept-encoding'] === 'gzip,deflate')
    console.log('✅ Test passed: Compression middleware adds headers functionally')
  }
}
