# Implementation Plan: OTel db.query.text Capture with Sanitization

**Branch**: `002-capture-search-query-default-on` | **Date**: 2026-03-11
**Specs**: [001 spec](../../001-otel-search-query-capture/spec.md) · [002 spec](spec.md)
**Input**: Combined plan covering specs 001 and 002. Spec 001 established the endpoint list and opt-in mechanism; spec 002 extended it with env var control, truncation, and per-request override. This plan implements the full end state.

## Summary

Add `captureSearchQuery: boolean` (default `false`) to `OpenTelemetryOptions`. When enabled, the transport sanitizes the request body and records it as the `db.query.text` OTel span attribute for 11 designated search-like endpoints. Two sanitization strategies are used: for JSON/NDJSON DSL endpoints, all primitive/literal values are recursively replaced with `?`; for string-query endpoints (`esql.async_query`, `esql.query`, `sql.query`), if the query is parameterized the query string is included with parameter values omitted, otherwise `db.query.text` is not set. The sanitized result is truncated to 2048 characters. An opt-out env var (`OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY=false`) follows the same pattern as the existing `OTEL_ELASTICSEARCH_ENABLED` var.

Changes touch two source files: `src/security.ts` (new sanitization functions) and `src/Transport.ts` (interface + `request()` logic). Tests are added to `test/unit/security.test.ts` and `test/unit/transport.test.ts`. No new runtime dependencies are introduced.

## Technical Context

**Language/Version**: TypeScript; compiled to CommonJS (`lib/`) and ESM (`esm/`)
**Runtime**: Node.js ≥20
**Primary Dependencies**: `@opentelemetry/api` (existing)
**Storage**: N/A
**Testing**: `tap` via `npm test` (build → lint → unit tests)
**Target Platform**: Library (`@elastic/transport`); Linux / macOS / Windows
**Project Type**: Library
**Performance Goals**: Zero additional network I/O; sanitization is pure string/regex replacement; truncation at 2048 chars bounds memory allocation per span
**Constraints**: No new runtime dependencies (Constitution II); additive interface change only (Constitution I); `npm test` must exit cleanly (Constitution III)
**Scale/Scope**: Per-request attribute computation on the hot path for 11 designated endpoints only

## Constitution Check

| Principle | Status | Notes |
|---|---|---|
| I. No Breaking Changes | ✅ PASS | `captureSearchQuery` is a new optional field defaulting to `false`. No public API removed or renamed. No behavioral change for existing users. |
| II. Minimal Runtime Dependencies | ✅ PASS | No new packages added to `dependencies`. Sanitization uses pure regex/string ops. Uses `@opentelemetry/api` (already a dependency). |
| III. Test-Driven Quality | ✅ PASS | New unit tests required: sanitization tests in `security.test.ts`, OTel integration tests in `transport.test.ts`. Written alongside implementation. |
| IV. API Documentation | ✅ PASS | `captureSearchQuery` on `OpenTelemetryOptions` and all sanitization functions require complete docstrings with security warning (see `contracts/otel-api.md`). |
| V. Elasticsearch-Aligned Versioning | ✅ PASS | New backward-compatible capability → minor version bump. |

## Project Structure

### Documentation (this feature)

```text
specs/002-capture-search-query-default-on/
├── plan.md                  # This file ✅
├── spec.md                  # Feature 002 specification ✅
├── research.md              # Phase 0 output ✅
├── data-model.md            # Phase 1 output ✅
├── contracts/
│   └── otel-api.md          # Phase 1 output ✅
└── tasks.md                 # Phase 2 output (/speckit.tasks — not yet created)

specs/001-otel-search-query-capture/
└── spec.md                  # Feature 001 specification (reference only) ✅
```

### Source Code (repository root)

```text
src/
├── security.ts              # ADD: sanitizeJsonBody(), sanitizeStringQuery(),
│                            #      sanitizeNdjsonBody() — all exported
└── Transport.ts             # MODIFY: OpenTelemetryOptions interface (+captureSearchQuery),
                             #   SEARCH_LIKE_ENDPOINTS / STRING_QUERY_ENDPOINTS /
                             #   NDJSON_ENDPOINTS / SEARCH_QUERY_MAX_LENGTH constants,
                             #   constructor env var reading,
                             #   request() db.query.text logic block

test/unit/
├── security.test.ts         # ADD: sanitization tests (new describe block)
└── transport.test.ts        # ADD: OTel db.query.text test cases
```

## Phase 0: Research

**Status**: ✅ Complete — see [research.md](research.md)

| Unknown | Decision |
|---|---|
| Where to read the body | `request()` from `params.body`/`params.bulkBody` via `isStream()` and `shouldSerialize()` helpers |
| JSON sanitization strategy | Two-pass regex: strings first, then numbers/booleans/nulls |
| String-query sanitization strategy | Parse body JSON, extract `query` field; if parameterized (contains `?` placeholders) set `db.query.text` to query string; else omit |
| ndjson sanitization strategy | Split lines; sanitize odd-indexed (query) lines as JSON; even-indexed (header) lines verbatim; preserve trailing newline |
| Sanitize-then-truncate ordering | Sanitize full body first, then `.slice(0, 2048)` — no raw literal near boundary |
| Env var precedence model | Mirror `OTEL_ELASTICSEARCH_ENABLED`: read at construction, `Object.assign` merge, per-request override wins |
| Security module placement | Add to existing `src/security.ts`; tests in existing `test/unit/security.test.ts` |
| Impact on existing tests | Zero — existing OTel tests use `meta.name: 'hello'`, not in search-like set |

## Phase 1: Design & Contracts

**Status**: ✅ Complete

### Data Model

See [data-model.md](data-model.md). Summary:

- `OpenTelemetryOptions` gains `captureSearchQuery?: boolean` (default `false`)
- Three module-level constants partition the 11 endpoints: `SEARCH_LIKE_ENDPOINTS`, `STRING_QUERY_ENDPOINTS`, `NDJSON_ENDPOINTS`
- Sanitization dispatch: string-query endpoints → `sanitizeStringQuery()`; ndjson endpoints → `sanitizeNdjsonBody()`; all others → `sanitizeJsonBody()`
- `SEARCH_QUERY_MAX_LENGTH = 2048`; truncation applied after sanitization

### Interface Contracts

See [contracts/otel-api.md](contracts/otel-api.md). Summary:

- `OpenTelemetryOptions.captureSearchQuery?: boolean` (default `false`) with security-warning docstring
- Three new exports in `src/security.ts`: `sanitizeJsonBody()`, `sanitizeStringQuery()`, `sanitizeNdjsonBody()`
- `db.query.text` span attribute: sanitized body string, max 2048 chars, set only when capture enabled + endpoint matches + body present + sanitization succeeds

### Implementation Sketch

#### `src/security.ts` additions

```typescript
export function sanitizeJsonBody(body: string): string | null {
  if (body == null || body === '') return null
  // Pass 1: replace all JSON string literals (keys and values)
  let result = body.replace(/"(?:[^"\\]|\\.)*"/g, '"?"')
  // Pass 2: replace numbers, booleans, nulls (strings already neutralized)
  result = result.replace(/\b(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g, '?')
  return result
}

/**
 * For string-query endpoints (ES|QL, SQL): if the query is parameterized
 * (contains '?' placeholders), returns the query string with parameter
 * values omitted. If non-parameterized, returns null so db.query.text
 * is not set.
 *
 * @param body - Serialized JSON string of the request body
 */
export function sanitizeStringQuery(body: string): string | null {
  if (body == null || body === '') return null
  try {
    const parsed = JSON.parse(body)
    const query: unknown = parsed?.query
    if (typeof query !== 'string' || !query.includes('?')) return null
    // Return the query string only — parameter values are intentionally omitted
    return query
  } catch {
    return null
  }
}

export function sanitizeNdjsonBody(body: string): string | null {
  if (body == null || body === '') return null
  const lineEnding = body.includes('\r\n') ? '\r\n' : '\n'
  const hasTrailing = body.endsWith(lineEnding)
  const lines = body.split(lineEnding)
  if (hasTrailing && lines[lines.length - 1] === '') lines.pop()
  const sanitized = lines.map((line, i) =>
    i % 2 === 1 ? (sanitizeJsonBody(line) ?? line) : line
  )
  return sanitized.join(lineEnding) + (hasTrailing ? lineEnding : '')
}
```

#### `src/Transport.ts` modifications

```typescript
// 1. Module-level constants (after imports)
const STRING_QUERY_ENDPOINTS = new Set(['esql.query', 'esql.async_query', 'sql.query'])
const NDJSON_ENDPOINTS = new Set(['msearch', 'fleet.msearch'])
const SEARCH_LIKE_ENDPOINTS = new Set([
  'async_search.submit',
  'esql.async_query', 'esql.query',
  'fleet.msearch', 'fleet.search',
  'knn_search',
  'msearch',
  'rollup.rollup_search',
  'search', 'search_mvt',
  'sql.query'
])
const SEARCH_QUERY_MAX_LENGTH = 2048

// 2. OpenTelemetryOptions interface — add field (with docstring per contracts/otel-api.md)
captureSearchQuery?: boolean  // default false

// 3. Constructor — read env var alongside existing OTEL_ELASTICSEARCH_ENABLED pattern
const captureSearchQueryEnv = process.env.OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY
const captureSearchQueryDefault = captureSearchQueryEnv != null
  ? captureSearchQueryEnv.toLowerCase() !== 'false'
  : false
this[kOtelOptions] = Object.assign({}, {
  enabled: otelEnabledDefault,
  suppressInternalInstrumentation: false,
  captureSearchQuery: captureSearchQueryDefault
}, opts.openTelemetry ?? {})

// 4. request() — add db.query.text block after attributes object is built,
//    before startActiveSpan call
const captureSearchQuery = otelOptions.captureSearchQuery ?? false
if (captureSearchQuery && SEARCH_LIKE_ENDPOINTS.has(params.meta?.name)) {
  const isNdjson = NDJSON_ENDPOINTS.has(params.meta.name)
  const rawBody = isNdjson
    ? (params.bulkBody ?? null)
    : (params.body ?? null)

  if (rawBody != null && rawBody !== '' && !isStream(rawBody)) {
    let serialized: string
    if (isNdjson) {
      serialized = shouldSerialize(rawBody)
        ? this[kSerializer].ndserialize(rawBody as Array<Record<string, any>>)
        : rawBody as string
    } else {
      serialized = shouldSerialize(rawBody)
        ? this[kSerializer].serialize(rawBody)
        : rawBody as string
    }

    let sanitized: string | null
    if (STRING_QUERY_ENDPOINTS.has(params.meta.name)) {
      sanitized = sanitizeStringQuery(serialized)
    } else if (isNdjson) {
      sanitized = sanitizeNdjsonBody(serialized)
    } else {
      sanitized = sanitizeJsonBody(serialized)
    }

    if (sanitized != null) {
      if (sanitized.length > SEARCH_QUERY_MAX_LENGTH) {
        sanitized = sanitized.slice(0, SEARCH_QUERY_MAX_LENGTH)
      }
      attributes['db.query.text'] = sanitized
    }
  }
}
```

#### `test/unit/security.test.ts` — new test cases

- `sanitizeJsonBody`: string literals replaced; number types (int, float, neg, exp); booleans + null; nested objects and arrays; empty string → null; ISO dates in strings; no-literal body unchanged; malformed JSON partial sanitization (no throw)
- `sanitizeStringQuery`: parameterized query (with `?`) → returns query string only; non-parameterized → null; no `query` field → null; empty body → null; no throw on malformed JSON
- `sanitizeNdjsonBody`: header lines preserved; query lines sanitized; trailing newline preserved; empty header (`{}`) passes through; multiple search pairs; body with no literals unchanged

#### `test/unit/transport.test.ts` — new OTel test cases

- `db.query.text` absent by default (no `captureSearchQuery` config)
- `db.query.text` set for each of the 11 search-like endpoints when `captureSearchQuery: true`
- `db.query.text` sanitized: literals in DSL body become `?`
- `db.query.text` absent when `captureSearchQuery: false` (constructor)
- `db.query.text` absent when `captureSearchQuery: false` (per-request)
- `db.query.text` absent when `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY=false`
- `db.query.text` absent for non-search endpoint (`index`, `bulk`)
- `db.query.text` absent when body is null/absent
- `db.query.text` absent when body is a stream
- `db.query.text` truncated to exactly 2048 chars for oversized sanitized body
- `db.query.text` correct for ndjson body (`msearch`, `fleet.msearch`): headers verbatim, query lines sanitized
- `db.query.text` set for parameterized `esql.query` → query string without param values
- `db.query.text` absent for non-parameterized `esql.query`
- `db.query.text` set for parameterized `sql.query` → query string without param values
- `db.query.text` absent for non-parameterized `sql.query`
