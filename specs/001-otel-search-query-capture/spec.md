# Feature spec: OpenTelemetry db.query.text Capture for Search-Like Endpoints

**Feature Branch**: `001-otel-search-query-capture`
**Created**: 2026-03-10
**Status**: Draft
**Input**: User description: "For search-like endpoints, client libraries and transports should log search queries in the OpenTelemetry `db.query.text` span attribute if the user opted into using the `otel.instrumentation.elasticsearch.capture-search-query` setting. The search-like endpoints that should support this are: async_search.submit, esql.async_query, esql.query, fleet.msearch, fleet.search, knn_search, msearch, rollup.rollup_search, search, search_mvt, sql.query."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Opt In to Capturing Search Queries (Priority: P1)

A developer has OpenTelemetry tracing enabled and wants visibility into the actual queries being sent to Elasticsearch from their application. They enable the capture-search-query opt-in setting when configuring the transport. From that point on, whenever their application calls a search-like endpoint (e.g. `search`, `esql.query`, `msearch`), the request body is sanitized and included in the resulting OTel span as the `db.query.text` attribute. For JSON/NDJSON DSL queries, sanitization recursively replaces all primitive/literal values with `?` placeholders so query structure is visible without exposing actual data values. For string-based query endpoints (`esql.async_query`, `esql.query`, `sql.query`), parameterized queries are included with parameter values omitted; non-parameterized string queries are not captured at all. The developer can then see the shape of queries in their tracing backend alongside other span data.

**Why this priority**: This is the core value of the feature — without it, nothing else matters. It is the opt-in path that enables query visibility in traces.

**Independent Test**: Configure the transport with `captureSearchQuery: true`, issue a `search` request with a body containing literal values, and verify the resulting OTel span contains a `db.query.text` attribute with the sanitized request body (literals replaced with `?`).

**Acceptance Scenarios**:

1. **given** a transport configured with `captureSearchQuery: true` and OTel tracing enabled, **when** a `search` request with a query body is issued, **then** the OTel span for that request includes a `db.query.text` attribute containing the sanitized request body (all literals replaced with `?`)
2. **given** a transport configured with `captureSearchQuery: true`, **when** an `esql.query` request is issued with a parameterized ES|QL query string, **then** the OTel span includes a `db.query.text` attribute containing the query string with parameter values omitted
3. **given** a transport configured with `captureSearchQuery: true`, **when** an `esql.query` request is issued with a non-parameterized ES|QL query string, **then** the OTel span does NOT include a `db.query.text` attribute
4. **given** a transport configured with `captureSearchQuery: true`, **when** a `sql.query` request is issued with a parameterized SQL query string, **then** the OTel span includes a `db.query.text` attribute containing the query string with parameter values omitted
5. **given** a transport configured with `captureSearchQuery: true`, **when** any of the designated DSL search-like endpoints is called with a JSON body, **then** the resulting OTel span includes `db.query.text` with all literals replaced by `?`

---

### User Story 2 - Default Behavior: No Query Captured (Priority: P1)

A developer using the transport without explicitly enabling the capture-search-query setting (the default) issues search requests. Their OTel spans should not include a `db.query.text` attribute — preserving the existing behavior and ensuring no unintended query data leaks into traces.

**Why this priority**: The default-off behavior protects users who haven't explicitly chosen to share query contents in telemetry data.

**Independent Test**: Configure the transport without `captureSearchQuery` (or set it to `false`), issue a `search` request, and verify the resulting OTel span does not contain a `db.query.text` attribute.

**Acceptance Scenarios**:

1. **given** a transport with default OTel configuration (no `captureSearchQuery` setting), **when** a `search` request is issued, **then** the OTel span does NOT include a `db.query.text` attribute
2. **given** a transport with `captureSearchQuery: false`, **when** a search-like endpoint is called, **then** the OTel span does NOT include a `db.query.text` attribute

---

### User Story 3 - Non-Search Endpoints Are Unaffected (Priority: P2)

A developer has enabled `captureSearchQuery`. They call a non-search endpoint such as `index`, `get`, or `bulk`. Even though query capture is enabled, these endpoints should not have their request bodies captured in `db.query.text`, because they are not search-like operations.

**Why this priority**: Scoping the feature to only the designated endpoints ensures predictable behavior and avoids unintentionally capturing sensitive write payloads.

**Independent Test**: Enable `captureSearchQuery: true`, issue a `bulk` or `index` request, and verify the span does not include `db.query.text`.

**Acceptance Scenarios**:

1. **given** a transport with `captureSearchQuery: true`, **when** a non-search-like endpoint (e.g. `index`, `bulk`, `get`) is called, **then** the OTel span does NOT include a `db.query.text` attribute

---

### User Story 4 - Search Request Without a Body (Priority: P2)

A developer has enabled `captureSearchQuery`. They call a search-like endpoint without a request body (e.g. a `search` with all parameters in the URL). There is no query body to capture, so `db.query.text` should not be set.

**Why this priority**: Edge case safety — prevents empty or null values from being added to spans.

**Independent Test**: Enable `captureSearchQuery: true`, issue a `search` request with no body, and verify the span does not include `db.query.text`.

**Acceptance Scenarios**:

1. **given** a transport with `captureSearchQuery: true`, **when** a search-like endpoint is called with no request body, **then** the OTel span does NOT include a `db.query.text` attribute

---

### Edge Cases

- What happens when OTel is globally disabled but `captureSearchQuery` is set to `true`? No span is created, so no `db.query.text` is set — this is already handled by the existing OTel enable/disable flow.
- What happens when the request body is a stream rather than a serializable object? The `db.query.text` attribute should not be set for streaming bodies, since the content cannot be safely serialized mid-flight.
- What happens when the body is an ndjson body (as in `msearch`)? The attribute should contain the ndjson representation with all primitive/literal values in the query lines replaced with `?`.
- What happens when a query body contains no literals (e.g. only structural keys and operators)? Sanitization is a no-op and the body passes through unchanged.
- What happens when sanitization fails for an unexpected body shape? Sanitization MUST NOT throw — if the body cannot be sanitized, `db.query.text` MUST NOT be set.
- What happens when `captureSearchQuery` is toggled per-request via request-level OTel options? Per-request overrides should take precedence over the transport-level default, consistent with how the existing `enabled` flag works.
- What happens when URL query parameters (e.g. `?q=user.id:kimchy`) are present alongside a request body? URL query parameters are out of scope for `db.query.text` — only the request body is captured.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The transport MUST expose a new opt-in configuration option named `captureSearchQuery` (boolean, default `false`) within the existing `OpenTelemetryOptions` structure. The docstring for this option MUST include a prominent warning that while sanitization is applied, it does not guarantee prevention of sensitive data leaks.
- **FR-002**: When `captureSearchQuery` is `true` and OTel tracing is enabled, the transport MUST set the `db.query.text` span attribute on OTel spans for the following endpoints: `async_search.submit`, `esql.async_query`, `esql.query`, `fleet.msearch`, `fleet.search`, `knn_search`, `msearch`, `rollup.rollup_search`, `search`, `search_mvt`, `sql.query`
- **FR-003**: For JSON and NDJSON DSL query endpoints, the `db.query.text` attribute value MUST be produced by recursively replacing all primitive/literal values in the request body with `?`. Literals include, but are not limited to: strings, numbers, dates and times, booleans, intervals, binary values, and hexadecimal values.
- **FR-004**: For string-query endpoints (`esql.async_query`, `esql.query`, `sql.query`): if the query string is parameterized, `db.query.text` MUST be set to the query string with parameter values omitted; if the query string is NOT parameterized, `db.query.text` MUST NOT be set.
- **FR-005**: When `captureSearchQuery` is `false` (or unset), the transport MUST NOT set `db.query.text` on any span
- **FR-006**: When a search-like endpoint is called but the request has no body, the transport MUST NOT set `db.query.text` on the span
- **FR-007**: For streaming request bodies, the transport MUST NOT set `db.query.text` (streams cannot be safely read mid-pipeline without side effects)
- **FR-008**: The `captureSearchQuery` option MUST be overridable at the per-request level via the existing per-request `openTelemetry` options, consistent with how other OTel options work
- **FR-009**: The `db.query.text` attribute MUST conform to the Elasticsearch OpenTelemetry semantic conventions (https://opentelemetry.io/docs/specs/semconv/database/elasticsearch/)
- **FR-010**: Endpoints NOT in the designated search-like list MUST NOT have `db.query.text` set, even when `captureSearchQuery` is `true`
- **FR-011**: Sanitization of URL query string parameters (e.g. `?q=...`) is explicitly out of scope; only the request body is subject to sanitization and capture
- **FR-012**: The sanitization logic MUST be implemented as a standalone exported function in a dedicated security module, with its own unit test suite covering all supported literal types and edge cases

### Key Entities

- **Search-like endpoint list**: The fixed, enumerated set of endpoint names for which `db.query.text` capture is applicable: `async_search.submit`, `esql.async_query`, `esql.query`, `fleet.msearch`, `fleet.search`, `knn_search`, `msearch`, `rollup.rollup_search`, `search`, `search_mvt`, `sql.query`
- **String-query endpoints**: The subset of search-like endpoints whose query is expressed as a string rather than a JSON DSL body: `esql.async_query`, `esql.query`, `sql.query`
- **OTel span**: The OpenTelemetry tracing span created per transport request when tracing is enabled; `db.query.text` is an attribute on this span
- **Request body**: The query payload sent with the request; may be a plain object, a pre-serialized string, an ndjson array, or a stream

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 11 designated search-like endpoints produce OTel spans with a populated `db.query.text` attribute when `captureSearchQuery` is enabled and an eligible body is present; the attribute value contains no raw literal values for DSL endpoints, and no parameter values for string-query endpoints
- **SC-002**: Zero non-search endpoints produce spans with a `db.query.text` attribute, regardless of the `captureSearchQuery` setting
- **SC-003**: The `captureSearchQuery` setting defaults to `false`; enabling it requires an explicit opt-in with no behavior change for existing users
- **SC-004**: 100% of existing OTel-related tests continue to pass after the change, with no regression in current span attribute behavior
- **SC-005**: New tests cover all 11 search-like endpoints (opt-in enabled) and verify absence of `db.query.text` when opt-in is disabled
- **SC-006**: The sanitization function correctly replaces all literal types (string, numeric, date/time, boolean, interval, binary, hexadecimal) with `?` for DSL bodies, and correctly handles parameterized vs. non-parameterized string queries, passing all of its own dedicated unit tests

## Assumptions

- The endpoint name used to identify search-like operations is the `params.meta.name` field already available on the request parameters in the transport, which matches the operation names in the designated list
- The serialized body string is passed through a sanitization step before being written to `db.query.text`; for JSON/NDJSON bodies, the sanitization function operates on the parsed object or ndjson lines recursively; for string-query bodies, it operates on the query string directly
- Per-request OTel option overrides (via `options.openTelemetry`) already work for `enabled` and `suppressInternalInstrumentation`; `captureSearchQuery` will follow the same merge pattern
- The configuration option name in code (`captureSearchQuery`) maps to the setting identifier `otel.instrumentation.elasticsearch.capture-search-query` referenced in the Elasticsearch OTel semantic conventions
- The sanitization function is safe to call on any input and will not throw; an unrecognizable or unparseable body causes `db.query.text` to be omitted rather than recording an unsanitized value
- Sanitization of URL query string parameters (e.g. `?q=user.id:kimchy`) is out of scope; these are already captured separately in `url.full`
