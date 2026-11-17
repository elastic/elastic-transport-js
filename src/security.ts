/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { DiagnosticResult } from './types'
import { RedactionOptions } from './Transport'

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
  // `seen` maps each Object to its redacted copy (null while in progress), so shared references are redacted once
  // and circular references become null
  const seen = new Map()
  return doRedact(obj)

  function doRedact (value: any): any {
    // pull auth info out of URL objects
    if (value instanceof URL) return `${value.origin}${value.pathname}${value.search}`
    if (typeof value !== 'object' || value == null) return value
    if (Array.isArray(value)) return value.map(v => doRedact(v))
    if (seen.has(value)) return seen.get(value)
    seen.set(value, null)
    // Object.fromEntries defines own keys, so a `__proto__` key can't replace the prototype
    const result = Object.fromEntries(Object.entries(value).map(([key, v]) =>
      [key, toRedact.includes(key.toLowerCase()) ? '[redacted]' : doRedact(v)]))
    seen.set(value, result)
    return result
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

/** Serializes a value, keeping object keys but replacing literals: strings -> `"?"`, others -> `?`. */
function sanitizeValue (val: unknown): string {
  if (val === null || typeof val === 'number' || typeof val === 'boolean') return '?'
  if (typeof val === 'string') return '"?"'
  if (Array.isArray(val)) return '[' + val.map(sanitizeValue).join(',') + ']'
  if (typeof val === 'object') {
    const entries = Object.entries(val as Record<string, unknown>)
    return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + sanitizeValue(v)).join(',') + '}'
  }
  return '?'
}

/** Replaces literal values in a JSON body with placeholders, keeping keys. Null on empty/invalid input; never throws. */
export function sanitizeJsonBody (body: string | null | undefined): string | null {
  if (body == null || body === '') return null
  try {
    return sanitizeValue(JSON.parse(body))
  } catch {
    return null
  }
}

/** Extracts an ES|QL/SQL `query` field, but only when parameterized (contains `?`). Null otherwise; never throws. */
export function sanitizeStringQuery (body: string | null | undefined): string | null {
  if (body == null || body === '') return null
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const query = (parsed as Record<string, unknown>).query
    if (typeof query !== 'string') return null
    if (!query.includes('?')) return null
    return query
  } catch {
    return null
  }
}

/**
 * Sanitizes an msearch NDJSON body: even lines are headers (verbatim), odd lines are
 * query bodies (run through sanitizeJsonBody). Preserves EOL style and trailing newline.
 * Null on empty input or if any query line fails to sanitize; never throws.
 */
export function sanitizeNdjsonBody (body: string | null | undefined): string | null {
  if (body == null || body === '') return null
  try {
    const eol = body.includes('\r\n') ? '\r\n' : '\n'
    const hasTrailingNewline = body.endsWith('\n')
    let lines = body.split(eol)
    if (hasTrailingNewline && lines[lines.length - 1] === '') {
      lines = lines.slice(0, -1)
    }
    const processed: string[] = []
    for (let i = 0; i < lines.length; i++) {
      if (i % 2 === 0) {
        processed.push(lines[i])
      } else {
        const sanitized = sanitizeJsonBody(lines[i])
        if (sanitized === null) return null
        processed.push(sanitized)
      }
    }
    const joined = processed.join(eol)
    return hasTrailingNewline ? joined + eol : joined
  } catch {
    return null
  }
}
