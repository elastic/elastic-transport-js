/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { DiagnosticResult } from './types.js'
import { RedactionOptions } from './Transport.js'

const secretKeys = [
  'authorization',
  'password',
  'apikey',
  'x-elastic-app-auth'
]

/**
 * Clones an object and recursively loops through all keys, redacting their values if the key matches any of a list of strings.
 * @param obj: Object to clone and redact
 * @param additionalKeys: Extra keys that can be matched for redaction. Does not overwrite the default set.
 */
export function redactObject (obj: Record<string, any>, additionalKeys: string[] = []): Record<string, any> {
  const toRedact = [...secretKeys, ...additionalKeys].map(key => key.toLowerCase())
  // `seen` stores each Object it sees, so we can prevent infinite recursion due to circular references
  const seen = new Map()
  return doRedact(obj)

  function doRedact (obj: Record<string, any>): Record<string, any> {
    if (typeof obj !== 'object' || obj == null) return obj

    const newObj: Record<string, any> = {}
    Object.entries(obj).forEach(([key, value]) => {
      // pull auth info out of URL objects
      if (value instanceof URL) {
        value = `${value.origin}${value.pathname}${value.search}`
      } else if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          // if it's an array, redact each item
          value = value.map(v => doRedact(v))
        } else {
          if (seen.get(value) !== true) {
            // if this Object hasn't been seen, recursively redact it
            seen.set(value, true)
            value = doRedact(value)
          } else {
            // if it has been seen, set the value that goes in newObj to null
            // this is what prevents the circular references
            value = null
          }
        }
      }

      // check if redaction is needed for this key
      if (toRedact.includes(key.toLowerCase())) {
        newObj[key] = '[redacted]'
      } else {
        newObj[key] = value
      }
    })
    return newObj
  }
}

/**
 * Redacts a DiagnosticResult object using the provided options.
 * - 'off' does nothing
 * - 'remove' removes most optional properties, replaces non-optional properties with the simplest possible alternative
 * - 'replace' runs `redactObject`, which replaces secret keys with `[redacted]`
 */
export function redactDiagnostic (diag: DiagnosticResult, options: RedactionOptions): DiagnosticResult {
  switch (options.type) {
    case 'off':
      break
    case 'remove':
      delete diag.headers
      delete diag.meta.sniff
      delete diag.meta.request.params.headers
      diag.meta.request.options = {}
      diag.meta.connection = null
      break
    case 'replace':
      diag = redactObject(diag, options.additionalKeys ?? []) as DiagnosticResult
      break
  }

  return diag
}
