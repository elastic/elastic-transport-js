# Research: captureSearchQuery + db.query.text Sanitization

**Feature**: 001 + 002 (combined plan)
**Date**: 2026-03-11

---

## 1. Where to read the request body for `db.query.text`

**Decision**: Read `params.body` / `params.bulkBody` directly in `request()`, before `_request()` is called, using the existing `isStream()` and `shouldSerialize()` helpers already present in `Transport.ts`.

**Rationale**: The `request()` method is where OTel span attributes are assembled. Both `params.body` and `params.bulkBody` are available at this point. Serialization mirrors the logic already in `_request()`:
- `params.body` is an object → `this[kSerializer].serialize(params.body)` → then sanitize
- `params.body` is already a string → use as-is → then sanitize
- `params.bulkBody` is an array → `this[kSerializer].ndserialize(params.bulkBody)` → then sanitize as ndjson
- `params.bulkBody` is already a string → use as-is → then sanitize as ndjson
- Either is a stream → skip entirely

Sanitization operates on the serialized string, not the raw object, so the two steps are cleanly separated.

**Alternatives considered**:
- Threading the serialized body back up from `_request()`: rejected — changes `_request()` signature for a non-core concern.
- Re-serializing inside `_request()` post-send: rejected — span attribute must be set before `startActiveSpan`.

---

## 2. JSON body sanitization strategy

**Decision**: Two-pass regex replacement on the serialized JSON string.

**Pass 1** — replace all JSON string literals (values and keys) with `"?"`:
```
/"(?:[^"\\]|\\.)*"/g  →  '"?"'
```
This regex correctly handles escaped quotes (`\"`), backslash sequences (`\\`), and unicode escapes (`\uXXXX`). It replaces both string values and string keys — keys may contain user-controlled field names, so replacing them is desirable for sanitization.

**Pass 2** — replace numbers, booleans, and nulls (all strings are already neutralized):
```
/\b(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g  →  '?'
```
This covers negative numbers, floats, exponents, `true`, `false`, and `null`.

**Safety**: both `replace()` calls never throw. If the input is malformed JSON, unmatched literals survive — that is acceptable. If any exception is somehow raised, the caller catches it and omits `db.query.text`.

**Alternatives considered**:
- A full token scanner: rejected — ~60 extra lines, zero correctness benefit for well-formed input, harder to audit.
- Single-pass: rejected — numbers inside string values would be incorrectly matched before strings are neutralized.

---

## 3. String-query endpoint sanitization strategy

**Decision**: For endpoints whose queries are expressed as strings (`esql.async_query`, `esql.query`, `sql.query`), parse the request body JSON and extract the `query` field. If the query string contains `?` placeholders (indicating it is parameterized), set `db.query.text` to that query string. If the query has no `?` placeholders (non-parameterized, literals are inline), do NOT set `db.query.text`.

**Rationale**: Non-parameterized string queries embed raw user data inline (e.g. `WHERE first_name == 'John'`), making safe sanitization impossible without a full language parser. Omitting `db.query.text` in this case is the safest default. Parameterized queries already have placeholder syntax; the query string itself contains no raw values, so it is safe to capture as-is.

**Implementation**:
```typescript
export function sanitizeStringQuery(body: string): string | null {
  if (body == null || body === '') return null
  try {
    const parsed = JSON.parse(body)
    const query: unknown = parsed?.query
    if (typeof query !== 'string' || !query.includes('?')) return null
    return query
  } catch {
    return null
  }
}
```

**Safety**: `JSON.parse` exceptions are caught; function always returns `string | null`. No regex needed.

**Alternatives considered**:
- Regex-based ES|QL literal replacement: rejected — requires a custom multi-pass regex per ES|QL syntax; fragile, hard to maintain, and introduces false confidence that all literals are caught.
- Full ES|QL/SQL parser: rejected — no available zero-dependency parser; introduces new runtime deps (violates Constitution II).

---

## 4. ndjson body sanitization strategy (msearch, fleet.msearch)

**Decision**: Split on line endings, sanitize only odd-indexed lines (0-based) as JSON strings using the JSON sanitizer (research item 2), preserve even-indexed header lines verbatim, reassemble preserving original line endings and trailing newline.

**Confirmed conventions**:
- Even-indexed lines (0, 2, 4…) are header objects: `{"index":"my-idx","routing":"key"}` — contain routing metadata, not query data. Left unsanitized.
- Odd-indexed lines (1, 3, 5…) are query body objects — sanitized with JSON sanitizer.
- A trailing newline is **required** by the Elasticsearch API and must be preserved.
- An empty header (`{}`) is valid and common.
- `fleet.msearch` follows the same ndjson line convention as `msearch`.

**Algorithm**:
```
1. Detect line ending (\r\n or \n)
2. Record whether input ends with the line ending
3. Split into lines; pop the empty trailing element if present
4. For each line: if odd index → sanitizeJson(line), else pass through
5. Join with original line ending
6. Re-append trailing line ending if it was present
```

**Safety**: if a query line contains invalid JSON, `sanitizeJson()` returns it partially sanitized (or unchanged on total parse failure) — never throws.

---

## 5. Env var precedence model

**Decision**: Mirror the existing `OTEL_ELASTICSEARCH_ENABLED` pattern exactly.

At construction time, read `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY`:
- `'false'` (case-insensitive) → base default is `false`
- Absent or any other value → base default is `false` (the built-in default)

Then `Object.assign` merges constructor `opts.openTelemetry?.captureSearchQuery` over the env-var result. Per-request `options.openTelemetry?.captureSearchQuery` merges over that in `request()`.

```
Precedence (highest → lowest):
  per-request options.openTelemetry.captureSearchQuery
  → constructor opts.openTelemetry.captureSearchQuery
  → OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY env var
  → false (built-in default)
```

Note: the env var can only disable capture (set to `'false'`); it cannot enable capture on its own if the code-level default is `false`. Setting the env var to any value other than `'false'` defers to the code-level config.

**Alternatives considered**:
- Env var as absolute override ignoring code config: rejected — inconsistent with existing env var behavior; breaks per-request suppression.

---

## 6. Sanitize-then-truncate ordering

**Decision**: Sanitize the full body first, then truncate to 2048 characters.

**Rationale**: Sanitizing before truncation guarantees no raw literal ever appears near the 2048-char boundary. The performance cost of sanitizing a body that may be truncated is acceptable — `db.query.text` is only set for 11 designated endpoints, and the 2048-char cap bounds worst-case work. Sanitization is pure string replacement with no I/O.

---

## 7. Security module placement

**Decision**: Add `sanitizeJsonBody()`, `sanitizeStringQuery()`, and `sanitizeNdjsonBody()` as new exported functions in the existing `src/security.ts`. No new source file is needed.

**Rationale**: `src/security.ts` already exports `redactObject` and `redactDiagnostic`. Sanitization is a security/privacy concern that belongs in the same module. `test/unit/security.test.ts` already exists and is the natural home for new sanitization unit tests.

**Alternatives considered**:
- New `src/sanitize.ts` file: rejected — creates fragmentation; the existing security module is the right home.

---

## 8. Impact on existing tests

**Decision**: No existing test will be broken. Current OTel tests use `meta: { name: 'hello' }`, which is not in `SEARCH_LIKE_ENDPOINTS`. No existing span attribute assertion includes `db.query.text`. The default of `false` means no behavioral change for existing OTel users.

New tests are added to:
- `test/unit/security.test.ts` — sanitization unit tests (all literal types, all three body formats, edge cases)
- `test/unit/transport.test.ts` — OTel integration tests for `db.query.text` capture, suppression, env var, per-request override, stream guard, truncation
