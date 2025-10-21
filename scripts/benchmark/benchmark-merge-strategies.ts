/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Benchmark comparing different object merging strategies
 * https://medium.com/@abbas.ashraf19/8-best-methods-for-merging-nested-objects-in-javascript-ff3c813016d9
 */

import { bench, run, group } from 'mitata'
import { MiddlewareContext } from '../../src/middleware/types'

const baseContext: MiddlewareContext = {
  request: {
    method: 'POST',
    path: '/test/_search',
    body: 'test data',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'elastic-transport-js'
    }
  },
  options: {
    timeout: 30000
  },
  shared: new Map([
    ['requestId', '123'],
    ['startTime', Date.now()]
  ])
}

const updates = {
  request: {
    headers: {
      'authorization': 'Bearer token',
      'x-trace-id': 'trace-123'
    }
  },
  shared: new Map([
    ['otelSpan', { traceId: 'abc' }]
  ])
}

// Strategy 1: Spread Operator (Current approach)
function mergeSpread (current: MiddlewareContext, updates: any): MiddlewareContext {
  return {
    ...current,
    request: {
      ...current.request,
      ...updates.request,
      headers: {
        ...current.request.headers,
        ...updates.request.headers
      }
    },
    shared: new Map([...current.shared, ...updates.shared])
  }
}

// Strategy 2: Object.assign
function mergeObjectAssign (current: MiddlewareContext, updates: any): MiddlewareContext {
  return {
    request: Object.assign({}, current.request, {
      headers: Object.assign({}, current.request.headers, updates.request.headers)
    }),
    options: current.options,
    shared: new Map([...current.shared, ...updates.shared])
  }
}

// Strategy 3: Conditional merge (current optimized approach)
function mergeConditional (current: MiddlewareContext, updates: any): MiddlewareContext {
  if (updates.request == null && updates.shared == null) {
    return current;
  }

  let mergedRequest = current.request
  if (updates.request != null) {
    const mergedHeaders = updates.request.headers != null
      ? { ...current.request.headers, ...updates.request.headers }
      : current.request.headers

    mergedRequest = { ...current.request, ...updates.request, headers: mergedHeaders }
  }

  return {
    ...current,
    request: mergedRequest,
    shared: updates.shared != null ? new Map([...current.shared, ...updates.shared]) : current.shared
  }
}

// Strategy 4: Manual property assignment
function mergeManual (current: MiddlewareContext, updates: any): MiddlewareContext {
  const result: MiddlewareContext = {
    request: {
      method: current.request.method,
      path: current.request.path,
      body: updates.request?.body ?? current.request.body,
      headers: { ...current.request.headers }
    },
    options: current.options,
    shared: new Map(current.shared)
  }

  if (updates.request?.headers != null) {
    Object.assign(result.request.headers, updates.request.headers)
  }

  if (updates.shared != null) {
    updates.shared.forEach((value: any, key: any) => {
      result.shared.set(key, value)
    })
  }

  return result
}

// Strategy 5: structuredClone (ES2023)
function mergeStructuredClone (current: MiddlewareContext, updates: any): MiddlewareContext {
  const cloned = {
    ...structuredClone({ request: current.request, options: current.options }),
    shared: new Map(current.shared)
  } as MiddlewareContext

  if (updates.request?.headers != null) {
    Object.assign(cloned.request.headers, updates.request.headers)
  }

  if (updates.shared != null) {
    updates.shared.forEach((value: any, key: any) => {
      cloned.shared.set(key, value)
    })
  }

  return cloned
}

// Strategy 6: Immutable update pattern
function mergeImmutable (current: MiddlewareContext, updates: any): MiddlewareContext {
  return {
    ...current,
    request: {
      ...current.request,
      ...(updates.request ?? {}),
      headers: {
        ...current.request.headers,
        ...(updates.request?.headers ?? {})
      }
    },
    shared: new Map([
      ...current.shared.entries(),
      ...(updates.shared?.entries() ?? [])
    ])
  }
}

// Strategy 7: Object.create with prototype chain
function mergePrototype (current: MiddlewareContext, updates: any): MiddlewareContext {
  const headers = Object.create(current.request.headers)
  if (updates.request?.headers != null) {
    Object.assign(headers, updates.request.headers)
  }

  const request = Object.create(current.request)
  request.headers = headers
  if (updates.request != null) {
    Object.assign(request, updates.request)
  }

  return {
    request,
    options: current.options,
    shared: new Map([...current.shared, ...(updates.shared ?? [])])
  }
}

// Strategy 8: Optimized with header-only fast path
function mergeOptimizedFastPath (current: MiddlewareContext, updates: any): MiddlewareContext {
  if (updates.request?.headers != null &&
      updates.request.body == null &&
      updates.request.method == null &&
      updates.request.path == null &&
      updates.shared == null) {
    return {
      ...current,
      request: {
        ...current.request,
        headers: {
          ...current.request.headers,
          ...updates.request.headers
        }
      }
    }
  }

  return mergeConditional(current, updates)
}

console.log('='.repeat(70))
console.log('Merge Strategy Comparison')
console.log('='.repeat(70))
console.log('Testing 8 different approaches to merging MiddlewareContext')
console.log('='.repeat(70))

group('Full Context Merge (headers + shared)', () => {
  bench('1. Spread operator (current naive)', () => {
    mergeSpread(baseContext, updates)
  })

  bench('2. Object.assign', () => {
    mergeObjectAssign(baseContext, updates)
  })

  bench('3. Conditional merge (current optimized)', () => {
    mergeConditional(baseContext, updates)
  })

  bench('4. Manual assignment', () => {
    mergeManual(baseContext, updates)
  })

  bench('5. structuredClone', () => {
    mergeStructuredClone(baseContext, updates)
  })

  bench('6. Immutable pattern', () => {
    mergeImmutable(baseContext, updates)
  })

  bench('7. Prototype chain', () => {
    mergePrototype(baseContext, updates)
  })

  bench('8. Optimized fast path', () => {
    mergeOptimizedFastPath(baseContext, updates)
  })
})

group('Headers-Only Merge (most common case)', () => {
  const headersOnlyUpdate = {
    request: {
      headers: {
        'x-custom': 'value'
      }
    },
    shared: new Map()
  }

  bench('1. Spread operator', () => {
    mergeSpread(baseContext, headersOnlyUpdate)
  })

  bench('3. Conditional merge', () => {
    mergeConditional(baseContext, headersOnlyUpdate)
  })

  bench('4. Manual assignment', () => {
    mergeManual(baseContext, headersOnlyUpdate)
  })

  bench('8. Optimized fast path', () => {
    mergeOptimizedFastPath(baseContext, headersOnlyUpdate)
  })
})

group('No-op Merge (early return test)', () => {
  const noUpdate = {
    request: {},
    shared: new Map()
  }

  bench('1. Spread operator (no early return)', () => {
    mergeSpread(baseContext, noUpdate)
  })

  bench('3. Conditional merge (has early return)', () => {
    mergeConditional(baseContext, noUpdate)
  })

  bench('8. Optimized fast path (has early return)', () => {
    mergeOptimizedFastPath(baseContext, noUpdate)
  })
})

run({
  units: false,
  silent: false,
  avg: true,
  json: false,
  colors: true,
  min_max: true,
  percentiles: true
}).then(() => {
  console.log('\n' + '='.repeat(70))
  console.log('Analysis')
  console.log('='.repeat(70))
})

