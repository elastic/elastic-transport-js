# Contract: OpenTelemetryOptions + Security Module Public API

**Feature**: 001 + 002 (combined plan)
**Date**: 2026-03-11
**Type**: TypeScript public interfaces (library)

---

## Updated `OpenTelemetryOptions` Interface

```typescript
/**
 * Options for OpenTelemetry instrumentation.
 * All fields are optional; defaults apply when omitted.
 */
export interface OpenTelemetryOptions {
  /**
   * Enable or disable all OTel instrumentation.
   * Can also be controlled via the OTEL_ELASTICSEARCH_ENABLED environment variable.
   * @default true
   */
  enabled?: boolean

  /**
   * Suppress propagation of OTel tracing context to internal spans.
   * @default false
   */
  suppressInternalInstrumentation?: boolean

  /**
   * When true, the sanitized request body is recorded as the `db.query.text`
   * OTel span attribute for search-like endpoints.
   *
   * For JSON and NDJSON DSL query endpoints, all primitive literal values in
   * the body are recursively replaced with `?` before capture.
   *
   * For string-query endpoints (esql.async_query, esql.query, sql.query),
   * only parameterized queries (containing `?` placeholders) are captured —
   * the query string is recorded without parameter values. Non-parameterized
   * string queries are never captured.
   *
   * Bodies longer than 2048 characters (after sanitization) are silently
   * truncated. URL query string parameters are not captured.
   *
   * Can also be controlled via the OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY
   * environment variable (set to "false" to disable).
   *
   * **WARNING**: Sanitization reduces the risk of sensitive data appearing in
   * traces, but does not guarantee that no sensitive data will be captured.
   * Non-parameterized string queries are omitted entirely for this reason.
   * Review your queries and enable this option only after confirming it is
   * appropriate for your data and compliance requirements.
   *
   * @default false
   */
  captureSearchQuery?: boolean
}
```

### Backward Compatibility

- `captureSearchQuery` is optional and defaults to `false` — no behavioral change for existing users.
- No existing field is removed, renamed, or changed in type.

---

## Security Module Exports (src/security.ts additions)

```typescript
/**
 * Sanitizes a serialized JSON query body by replacing all literal values
 * (string keys and values, numbers, booleans, nulls) with `?`.
 * The structural shape of the JSON is preserved.
 *
 * Returns the sanitized string, or null if sanitization cannot be applied
 * (e.g., the input is null/undefined/empty). Never throws.
 *
 * **WARNING**: sanitization reduces but does not eliminate the risk of
 * sensitive data appearing in traces.
 *
 * @param body - Serialized JSON string to sanitize
 */
export function sanitizeJsonBody(body: string): string | null

/**
 * Sanitizes a string-query request body (ES|QL, SQL) by extracting and
 * returning the `query` field if the query is parameterized (contains `?`
 * placeholders). Parameter values from the `params` / `parameters` field
 * are intentionally excluded.
 *
 * Returns null if the query is non-parameterized (no `?` in query string),
 * if no `query` field is present, or if the input cannot be parsed.
 * Never throws.
 *
 * Non-parameterized queries are omitted because they may contain raw user
 * data inline (e.g. WHERE name == 'Alice') that cannot be safely redacted
 * without a full language parser.
 *
 * @param body - Serialized JSON string of the request body
 */
export function sanitizeStringQuery(body: string): string | null

/**
 * Sanitizes an ndjson body (as used by msearch and fleet.msearch) by
 * applying JSON literal sanitization to query lines only (odd-indexed lines,
 * 0-based). Header lines (even-indexed) are preserved verbatim, including
 * index and routing metadata. The trailing newline required by the
 * Elasticsearch API is preserved.
 *
 * Returns the sanitized ndjson string, or null if the input is
 * null/undefined/empty. Never throws.
 *
 * **WARNING**: sanitization reduces but does not eliminate the risk of
 * sensitive data appearing in traces.
 *
 * @param body - ndjson string to sanitize
 */
export function sanitizeNdjsonBody(body: string): string | null
```

---

## `db.query.text` Span Attribute Contract

| Property | Value |
|---|---|
| Attribute name | `db.query.text` |
| Type | `string` |
| DSL endpoint sanitization | All literal values replaced with `?` before capture |
| String-query endpoint sanitization | Parameterized: query string only (no param values); non-parameterized: not set |
| Max length | 2048 characters after sanitization (silently truncated if longer) |
| Truncation order | Sanitize first, then truncate |
| URL query params | Not included — body only |
| Set when | `captureSearchQuery` is `true` AND endpoint is search-like AND body is present, non-empty, and non-streaming AND sanitization returns non-null |
| Not set when | `captureSearchQuery` is `false` or unset; endpoint not in search-like list; body absent/empty/stream; sanitization returns null (including non-parameterized string queries) |

**Conformance**: This attribute conforms to the [Elasticsearch OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/database/elasticsearch/).

---

## Usage Examples

**Opt in to query capture (sanitized):**
```typescript
const transport = new Transport({
  connectionPool: pool,
  openTelemetry: { captureSearchQuery: true }
})
// db.query.text set for search-like spans, literals replaced with ?
```

**Default behavior (no query capture):**
```typescript
const transport = new Transport({ connectionPool: pool })
// captureSearchQuery defaults to false — no db.query.text set
```

**Opt out for a single request:**
```typescript
await transport.request(params, {
  openTelemetry: { captureSearchQuery: false }
})
```

**Disable at runtime via environment variable:**
```
OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY=false
```
