# Data Model: captureSearchQuery + db.query.text Sanitization

**Feature**: 001 + 002 (combined plan)
**Date**: 2026-03-11

---

## Configuration Interface

### `OpenTelemetryOptions` (updated)

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` (or env var) | Existing — enables/disables all OTel instrumentation |
| `suppressInternalInstrumentation` | `boolean` | `false` | Existing — suppresses tracing context propagation internally |
| `captureSearchQuery` | `boolean` | `false` (or env var) | **New** — when `true`, sets `db.query.text` on spans for search-like endpoints |

All fields remain optional. The interface is additive and backward-compatible.

---

## Environment Variables

| Variable | Values | Effect |
|---|---|---|
| `OTEL_ELASTICSEARCH_ENABLED` | `'false'` → disabled; anything else → defers to code | Existing |
| `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY` | `'false'` → disabled; anything else → defers to `captureSearchQuery` code config | **New** |

Both variables are read once at Transport construction time. Comparison is case-insensitive.

---

## OTel Span Attribute

| Attribute | Type | Set when | Value |
|---|---|---|---|
| `db.query.text` | `string` | `captureSearchQuery` is `true`, endpoint is search-like, body is present and not a stream, sanitization returns non-null | Sanitized query string, truncated to 2048 chars |

---

## Search-Like Endpoint Set

| Operation name | Body type | Sanitization path |
|---|---|---|
| `async_search.submit` | JSON (`params.body`) | `sanitizeJsonBody()` |
| `esql.async_query` | String query (`params.body`) | `sanitizeStringQuery()` |
| `esql.query` | String query (`params.body`) | `sanitizeStringQuery()` |
| `fleet.msearch` | ndjson (`params.bulkBody`) | `sanitizeNdjsonBody()` |
| `fleet.search` | JSON (`params.body`) | `sanitizeJsonBody()` |
| `knn_search` | JSON (`params.body`) | `sanitizeJsonBody()` |
| `msearch` | ndjson (`params.bulkBody`) | `sanitizeNdjsonBody()` |
| `rollup.rollup_search` | JSON (`params.body`) | `sanitizeJsonBody()` |
| `search` | JSON (`params.body`) | `sanitizeJsonBody()` |
| `search_mvt` | JSON (`params.body`) | `sanitizeJsonBody()` |
| `sql.query` | String query (`params.body`) | `sanitizeStringQuery()` |

---

## Option Resolution Order

For `captureSearchQuery`, the resolved value at request time follows this precedence (highest to lowest):

```
1. Per-request:  options.openTelemetry?.captureSearchQuery
2. Constructor:  opts.openTelemetry?.captureSearchQuery
3. Env var:      OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY ('false' → false, else skip)
4. Built-in:     false
```

This mirrors the identical resolution order used for the existing `enabled` flag.

---

## Sanitization Functions (src/security.ts)

### `sanitizeJsonBody(body: string): string | null`

| Input | Output |
|---|---|
| Well-formed JSON string | Sanitized string: all string literals (keys + values) → `"?"`, numbers/booleans/nulls → `?` |
| Pre-serialized JSON string | Same as above |
| Malformed JSON | Best-effort partial sanitization (regex still runs); never throws |
| `null` / `undefined` / `''` | `null` — caller must omit `db.query.text` |

**Two-pass regex**:
1. `/"(?:[^"\\]|\\.)*"/g` → `'"?"'` (all JSON string tokens including keys)
2. `/\b(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g` → `'?'` (numbers, booleans, nulls)

### `sanitizeStringQuery(body: string): string | null`

| Input | Output |
|---|---|
| JSON body with parameterized `query` field (contains `?`) | The `query` string value only — parameter values from `params`/`parameters` field are intentionally excluded |
| JSON body with non-parameterized `query` field (no `?`) | `null` — `db.query.text` MUST NOT be set |
| No `query` field present | `null` |
| `null` / `undefined` / `''` | `null` |
| Malformed JSON | `null` (JSON.parse error caught); never throws |

**Strategy**: Parse body JSON, extract `query` field string, check for `?` placeholder. If present, return the query string (omitting `params`/`parameters` values). If absent, return null.

### `sanitizeNdjsonBody(body: string): string | null`

| Input | Output |
|---|---|
| ndjson string (msearch format) | Even-indexed lines verbatim; odd-indexed lines sanitized via `sanitizeJsonBody()` |
| `null` / `undefined` / `''` | `null` — caller must omit `db.query.text` |

**Algorithm**:
1. Detect line ending (`\r\n` or `\n`)
2. Record presence of trailing line ending (must be preserved)
3. Split into lines; remove empty trailing element from split artifact
4. For each line at odd index: apply `sanitizeJsonBody()`; even-index lines pass through unchanged
5. Join with original line ending; re-append trailing line ending if present

---

## Body Serialization + Sanitization Decision Table

| Body form | Serialization | Sanitization fn |
|---|---|---|
| `params.body` is a plain object | `kSerializer.serialize(params.body)` | based on endpoint type |
| `params.body` is already a string | Use as-is | based on endpoint type |
| `params.bulkBody` is an array | `kSerializer.ndserialize(params.bulkBody)` | `sanitizeNdjsonBody()` |
| `params.bulkBody` is already a string | Use as-is | `sanitizeNdjsonBody()` |
| Either is a stream | Skip — `db.query.text` NOT set | — |
| Body is `null` / `undefined` / `''` | Skip | — |
| Sanitization returns `null` | Skip — `db.query.text` NOT set | — |
| Sanitized string length > 2048 | Truncate with `.slice(0, 2048)` | — |

---

## Constants (src/Transport.ts, module level)

| Constant | Value | Purpose |
|---|---|---|
| `SEARCH_LIKE_ENDPOINTS` | `new Set([...11 names...])` | O(1) endpoint membership check |
| `STRING_QUERY_ENDPOINTS` | `new Set(['esql.async_query', 'esql.query', 'sql.query'])` | Route to string-query sanitizer |
| `NDJSON_ENDPOINTS` | `new Set(['msearch', 'fleet.msearch'])` | Route to ndjson sanitizer |
| `SEARCH_QUERY_MAX_LENGTH` | `2048` | Truncation limit |
