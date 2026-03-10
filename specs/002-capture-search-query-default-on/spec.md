# Feature spec: Extended OTel Search Query Capture (Env Var, Truncation, Per-Request Override)

**Feature Branch**: `002-capture-search-query-default-on`
**Created**: 2026-03-10
**Status**: Draft
**Input**: User description: "Extend the captureSearchQuery feature with: an OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY environment variable that disables capture at runtime; result truncation to 2048 characters; and per-request override of captureSearchQuery via existing per-request openTelemetry options."

## Clarifications

### Session 2026-03-10

- Q: Should `db.query.text` be truncated if the serialized body exceeds a maximum length, and if so at what limit and is the limit user-configurable? → A: Truncate at a fixed limit of 2048 characters; not user-configurable
- Q: Should an environment variable allow ops teams to disable query capture at runtime without a code change? → A: Yes — add `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY` env var; value `false` disables capture, absence defers to the `captureSearchQuery` code-level config
- Q: Should sanitization run on the full body before truncation, or should the body be truncated first and then sanitized? → A: Sanitize the full body first, then truncate the sanitized result to 2048 characters — this ensures no raw literal ever appears near the truncation boundary
- Q: When sanitization fails on an unparseable body, should the failure be surfaced as a span event or diagnostic log? → A: Silently omit `db.query.text` with no warning, event, or diagnostic emitted

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Per-Request Override of Query Capture (Priority: P1)

A developer with `captureSearchQuery: true` configured globally wants to suppress query capture for a specific sensitive request without changing the global configuration. They pass `captureSearchQuery: false` in the per-request OTel options for that one call only. Only that request omits `db.query.text`; subsequent requests use the global setting.

**Why this priority**: Enables fine-grained control without forcing a global config change for one-off sensitive operations.

**Independent Test**: With `captureSearchQuery: true`, issue two `search` requests — one with per-request `openTelemetry: { captureSearchQuery: false }` and one without. Verify only the second includes `db.query.text`.

**Acceptance Scenarios**:

1. **given** a transport with `captureSearchQuery: true`, **when** a search-like request is issued with per-request `openTelemetry: { captureSearchQuery: false }`, **then** that span does NOT include `db.query.text`
2. **given** the same transport, **when** the next request is issued with no per-request override, **then** that span DOES include `db.query.text`
3. **given** a transport with `captureSearchQuery: false`, **when** a search-like request is issued with per-request `openTelemetry: { captureSearchQuery: true }`, **then** that span DOES include `db.query.text`

---

### User Story 2 - Runtime Disable via Environment Variable (Priority: P1)

An operations team deploys a service with query capture enabled in code. They discover they need to disable capture in a production environment without redeploying. They set `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY=false` in the environment. All subsequent spans omit `db.query.text` regardless of the code-level setting.

**Why this priority**: Runtime control without redeployment is essential for production incident response.

**Independent Test**: Set `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY=false` in the environment with `captureSearchQuery: true` in code, issue a `search` request, and verify the span does NOT include `db.query.text`.

**Acceptance Scenarios**:

1. **given** `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY=false` in the environment and `captureSearchQuery: true` in code, **when** any search-like endpoint is called, **then** the OTel span does NOT include `db.query.text`
2. **given** `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY` is absent from the environment and `captureSearchQuery: true` in code, **when** a search-like endpoint is called with a body, **then** the OTel span DOES include `db.query.text`
3. **given** `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY=FALSE` (uppercase) in the environment, **when** a search-like endpoint is called, **then** the OTel span does NOT include `db.query.text` (value is case-insensitive)

---

### User Story 3 - Truncation of Long Query Bodies (Priority: P2)

A developer captures a very large query body. After sanitization, the result is truncated to 2048 characters. No error or warning is raised; the span attribute simply contains the truncated string.

**Why this priority**: Prevents runaway span attribute size while keeping the feature predictable.

**Independent Test**: Issue a `search` request with a query body that, after sanitization, exceeds 2048 characters. Verify the `db.query.text` attribute is exactly 2048 characters and no error is raised.

**Acceptance Scenarios**:

1. **given** a transport with `captureSearchQuery: true`, **when** a search-like endpoint is called with a body that produces a sanitized string longer than 2048 characters, **then** `db.query.text` is set to the first 2048 characters of the sanitized string and no error or warning is emitted
2. **given** the same transport, **when** a search-like endpoint is called with a body whose sanitized form is 2048 characters or fewer, **then** `db.query.text` is set to the full sanitized string without truncation

---

### Edge Cases

- What happens when the `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY` env var is set to a value other than `false` (e.g. `true`, `1`, `yes`)? Only the exact value `false` (case-insensitive) disables capture; all other values defer to the code-level `captureSearchQuery` config.
- What happens when a query body cannot be parsed for sanitization? `db.query.text` MUST NOT be set — an unparseable body is omitted silently with no warning, span event, or diagnostic emitted.
- What happens when `captureSearchQuery: false` is set both globally and per-request? The result is the same — no `db.query.text` is set.
- What happens when the serialized body is exactly 2048 characters after sanitization? No truncation occurs; the full 2048-character string is stored.
- What happens when both the env var and per-request override are present? The env var `false` takes precedence over per-request `captureSearchQuery: true`, consistent with env vars overriding code-level config.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `captureSearchQuery` option in `OpenTelemetryOptions` MUST default to `false`. The docstring for this option MUST include a prominent warning that while sanitization is applied, it does not guarantee prevention of sensitive data leaks.
- **FR-002**: The `captureSearchQuery` option MUST be overridable per-request via the existing per-request `openTelemetry` options, consistent with how `enabled` and `suppressInternalInstrumentation` work. Per-request overrides take precedence over the transport-level setting.
- **FR-003**: The transport MUST support an `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY` environment variable. When set to `false` (case-insensitive), query capture MUST be disabled regardless of the code-level `captureSearchQuery` config. When absent or set to any other value, the code-level config governs.
- **FR-004**: The `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY` env var MUST take precedence over both the transport-level and per-request `captureSearchQuery` settings when set to `false`.
- **FR-005**: After sanitization, the `db.query.text` value MUST be truncated to a maximum of 2048 characters. Truncation MUST occur after sanitization (never before), ensuring no raw literal value ever appears near the truncation boundary.
- **FR-006**: Truncation MUST be silent — no warning, span event, or diagnostic is emitted when truncation occurs. The truncation limit is not user-configurable.
- **FR-007**: The sanitization function MUST be safe to call on any input and MUST NOT throw. An unrecognizable or unparseable body causes `db.query.text` to be omitted rather than recording an unsanitized value.
- **FR-008**: The supported search-like endpoint list is: `async_search.submit`, `esql.async_query`, `esql.query`, `fleet.msearch`, `fleet.search`, `knn_search`, `msearch`, `rollup.rollup_search`, `search`, `search_mvt`, `sql.query`
- **FR-009**: Sanitization uses exactly two strategies: (1) for JSON/NDJSON DSL queries, recursive replacement of all primitive/literal values with `?`; (2) for string-query endpoints (`esql.async_query`, `esql.query`, `sql.query`), if the query is parameterized include the query string with parameter values omitted, otherwise do NOT set `db.query.text`.
- **FR-010**: Sanitization of URL query string parameters is explicitly out of scope; only the request body is subject to sanitization and capture.

### Key Entities

- **Search-like endpoint list**: `async_search.submit`, `esql.async_query`, `esql.query`, `fleet.msearch`, `fleet.search`, `knn_search`, `msearch`, `rollup.rollup_search`, `search`, `search_mvt`, `sql.query`
- **String-query endpoints**: `esql.async_query`, `esql.query`, `sql.query`
- **OTel span**: The OpenTelemetry tracing span created per transport request when tracing is enabled
- **Request body**: The query payload; may be a plain object, a pre-serialized string, an ndjson array, or a stream

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Setting `captureSearchQuery: false` (or leaving it unset) reliably suppresses `db.query.text` on 100% of spans for all endpoint types
- **SC-002**: Setting `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY=false` reliably suppresses `db.query.text` on 100% of spans regardless of code-level config
- **SC-003**: Per-request `captureSearchQuery` overrides work correctly — the override affects only the targeted request with no effect on subsequent requests
- **SC-004**: All `db.query.text` attribute values are at most 2048 characters; values exceeding this limit are silently truncated with no errors emitted
- **SC-005**: 100% of existing OTel-related tests continue to pass after the change
- **SC-006**: New tests cover: env var disable, per-request override (both directions), and truncation at and beyond the 2048-character limit

## Assumptions

- The env var `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY` follows the same precedence and parsing pattern as the existing `OTEL_ELASTICSEARCH_ENABLED` env var: `false` (case-insensitive) disables, all other values (or absence) defer to the code-level config
- Per-request OTel option overrides already work via `options.openTelemetry` for `enabled` and `suppressInternalInstrumentation`; `captureSearchQuery` follows the same merge pattern
- Sanitization runs on the full body before any truncation is applied; the 2048-character limit is applied to the sanitized output only
- The sanitization function is safe to call on any string and will not throw; an unrecognizable or unparseable body causes `db.query.text` to be omitted
- Sanitization of URL query string parameters is out of scope; these are already captured separately in `url.full`
