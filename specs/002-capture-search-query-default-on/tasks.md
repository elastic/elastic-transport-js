# Tasks: OTel db.query.text Capture with Sanitization

**Input**: Design documents from `/specs/002-capture-search-query-default-on/`
**Specs**: [001](../../001-otel-search-query-capture/spec.md) · [002](spec.md) (combined)
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/otel-api.md ✅

**Tests**: Tests are MANDATORY for this project. Every code change MUST include added or updated unit tests in `test/unit/`. A task set is not complete until `npm test` passes cleanly.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US7)
- Exact file paths included in all task descriptions

---

## Phase 1: Setup

*No project initialization needed — TypeScript project and test infrastructure already exist.*

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Interface and constant changes in `src/Transport.ts` that every user story's logic and tests depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T001 Add `captureSearchQuery?: boolean` field (default `false`) to the `OpenTelemetryOptions` interface in `src/Transport.ts`, with docstring per `contracts/otel-api.md` including the security warning
- [ ] T002 Add module-level constants `SEARCH_LIKE_ENDPOINTS` (11 endpoints), `STRING_QUERY_ENDPOINTS` (`esql.async_query`, `esql.query`, `sql.query`), `NDJSON_ENDPOINTS` (`msearch`, `fleet.msearch`), and `SEARCH_QUERY_MAX_LENGTH` (`2048`) to `src/Transport.ts` per the sets defined in `data-model.md`
- [ ] T003 Read `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY` env var in the `Transport` constructor in `src/Transport.ts` and fold it into `this[kOtelOptions]` using the same `Object.assign` pattern as `OTEL_ELASTICSEARCH_ENABLED`; built-in default for `captureSearchQuery` is `false`

**Checkpoint**: Foundation ready — `captureSearchQuery` is part of the interface, constants exist, env var is read. No behavioral change yet. Run `npm test` to confirm all existing tests still pass.

---

## Phase 3: Foundational — Sanitization Functions (Blocking Prerequisite)

**Purpose**: All sanitization functions must exist before any transport integration can be implemented or tested.

- [ ] T004 Implement `sanitizeJsonBody(body: string): string | null` in `src/security.ts`: two-pass regex replacing all JSON string tokens (keys and values) with `"?"` (pass 1), then numbers, booleans, and nulls with `?` (pass 2); return `null` for null/undefined/empty input; never throw
- [ ] T005 [P] Implement `sanitizeStringQuery(body: string): string | null` in `src/security.ts`: parse body as JSON, extract `query` field string; if `query` contains `?` (parameterized), return the query string only (parameter values from `params`/`parameters` are intentionally excluded); if `query` has no `?` (non-parameterized), return `null`; return `null` for missing `query` field, non-string `query`, null/undefined/empty input, or JSON.parse failure; never throw
- [ ] T006 [P] Implement `sanitizeNdjsonBody(body: string): string | null` in `src/security.ts`: detect line ending (`\r\n` or `\n`); record trailing newline; split into lines; sanitize odd-indexed lines (0-based) via `sanitizeJsonBody()`; pass even-indexed header lines through verbatim; rejoin with original line ending and re-append trailing newline; return `null` for null/undefined/empty input; never throw

**Checkpoint**: All three sanitization functions implemented. Run `npm test` to confirm no regressions.

---

## Phase 4: User Story 1 — Opt In to Capturing Search Queries (001-P1) 🎯 MVP

**Goal**: With `captureSearchQuery: true` set, calling any of the 11 search-like endpoints sets `db.query.text` on the span. DSL endpoints have all literals replaced with `?`. Parameterized string-query endpoints include the query string without parameter values. Non-parameterized string-query endpoints do not set `db.query.text`.

**Independent Test**: Configure transport with `captureSearchQuery: true`, issue a `search` request with a body containing literal values, and verify the span contains `db.query.text` with literals replaced by `?`.

### Sanitization unit tests (test/unit/security.test.ts)

- [ ] T007 [P] [US1] Add unit tests for `sanitizeJsonBody()` in `test/unit/security.test.ts` covering: string values replaced; string keys replaced; integers, floats, negative numbers, exponents replaced; `true`, `false`, `null` replaced; ISO dates in strings replaced; nested objects and arrays; body with no literals unchanged; empty string → `null`; malformed JSON produces partial sanitization without throwing
- [ ] T008 [P] [US1] Add unit tests for `sanitizeStringQuery()` in `test/unit/security.test.ts` covering: parameterized query (with `?`) → returns query string only (no `params`/`parameters` values); non-parameterized query (no `?`) → `null`; body with no `query` field → `null`; `query` field is not a string → `null`; empty body → `null`; malformed JSON → `null` without throwing
- [ ] T009 [P] [US1] Add unit tests for `sanitizeNdjsonBody()` in `test/unit/security.test.ts` covering: header lines (even-indexed) reproduced verbatim; query lines (odd-indexed) sanitized via `sanitizeJsonBody()`; trailing newline preserved; empty header `{}` passes through unchanged; multiple search pairs; body with no query literals unchanged; empty string → `null`

### Transport integration (src/Transport.ts + test/unit/transport.test.ts)

- [ ] T010 [US1] Implement the `db.query.text` capture block in `request()` in `src/Transport.ts`: resolve `captureSearchQuery` from merged OTel options (`otelOptions.captureSearchQuery ?? false`); check `SEARCH_LIKE_ENDPOINTS.has(params.meta?.name)`; select body from `params.bulkBody` (ndjson endpoints) or `params.body` (all others); guard `null`/`''`/stream via `isStream()`; serialize with `this[kSerializer].ndserialize()` or `this[kSerializer].serialize()` or use raw string when `shouldSerialize()` is false; dispatch to `sanitizeNdjsonBody()`, `sanitizeStringQuery()`, or `sanitizeJsonBody()` based on endpoint set membership; skip if sanitization returns `null`; truncate sanitized result to `SEARCH_QUERY_MAX_LENGTH` with `.slice()`; set `attributes['db.query.text']`
- [ ] T011 [US1] Add OTel span tests to `test/unit/transport.test.ts` verifying `db.query.text` is set for each of the 11 search-like endpoints (`async_search.submit`, `esql.async_query`, `esql.query`, `fleet.msearch`, `fleet.search`, `knn_search`, `msearch`, `rollup.rollup_search`, `search`, `search_mvt`, `sql.query`) when `captureSearchQuery: true` and a body is present
- [ ] T012 [P] [US1] Add OTel span test to `test/unit/transport.test.ts` verifying `db.query.text` contains the sanitized body (literals → `?`, not raw body) for a `search` request with `captureSearchQuery: true` and a JSON body containing string and numeric literals
- [ ] T013 [P] [US1] Add OTel span test to `test/unit/transport.test.ts` verifying that for an `msearch` ndjson body with `captureSearchQuery: true`, `db.query.text` reproduces header lines verbatim and sanitizes query lines (literals → `?`)
- [ ] T014 [P] [US1] Add OTel span tests to `test/unit/transport.test.ts` verifying that for `esql.query` and `sql.query` with `captureSearchQuery: true`: a parameterized query (contains `?`) sets `db.query.text` to the query string without parameter values; a non-parameterized query (no `?`) does NOT set `db.query.text`
- [ ] T015 [P] [US1] Add OTel span test to `test/unit/transport.test.ts` verifying `db.query.text` is silently truncated to exactly 2048 characters when the sanitized body exceeds that length (`captureSearchQuery: true`; sanitization runs on the full body first)

**Checkpoint**: US1 complete — all 11 endpoints produce `db.query.text` spans when opted in. Run `npm test` to confirm T007–T015 pass.

---

## Phase 5: User Story 2 — Default Behavior: No Query Captured (001-P1)

**Goal**: Without any `captureSearchQuery` configuration, no `db.query.text` is ever set on any span — preserving existing behavior and protecting users who haven't explicitly opted in.

**Independent Test**: Configure transport with default OTel settings (no `captureSearchQuery`), issue a `search` request with a body, and verify the span does NOT contain `db.query.text`.

- [ ] T016 [US2] Add OTel span tests to `test/unit/transport.test.ts` verifying `db.query.text` is absent: (a) with no `captureSearchQuery` setting (default `false`); (b) with `openTelemetry: { captureSearchQuery: false }` explicitly set in the constructor

**Checkpoint**: US2 complete — default-off behavior confirmed. Run `npm test`.

---

## Phase 6: User Story 3 — Non-Search Endpoints Are Never Captured (001-P2)

**Goal**: Non-search endpoints (`index`, `bulk`, `get`, etc.) never produce a `db.query.text` attribute regardless of `captureSearchQuery` value.

**Independent Test**: With `captureSearchQuery: true`, issue `index` and `bulk` requests with bodies and verify neither span contains `db.query.text`.

- [ ] T017 [US3] Add OTel span tests to `test/unit/transport.test.ts` verifying `db.query.text` is absent for `index`, `bulk`, and `get` endpoints with `captureSearchQuery: true` and a body present

**Checkpoint**: US3 complete — non-search endpoints are unaffected. Run `npm test`.

---

## Phase 7: User Story 4 — Search Request Without a Body (001-P2)

**Goal**: A search-like endpoint called without a body (or with a stream body) does not set `db.query.text`.

**Independent Test**: With `captureSearchQuery: true`, issue a `search` request with no body and verify the span does not include `db.query.text`.

- [ ] T018 [US4] Add OTel span tests to `test/unit/transport.test.ts` verifying `db.query.text` is absent when a search-like endpoint is called with `captureSearchQuery: true` and: (a) `null` body, (b) `undefined` body, (c) a readable stream as the request body

**Checkpoint**: US4 complete — absent and streaming bodies are guarded. Run `npm test`.

---

## Phase 8: User Story 5 — Per-Request Override (002-P1)

**Goal**: A single request can override the transport-level `captureSearchQuery` setting via per-request `openTelemetry` options without affecting subsequent requests.

**Independent Test**: With `captureSearchQuery: true`, issue two consecutive `search` requests — one with per-request `captureSearchQuery: false` and one without. Verify only the second includes `db.query.text`.

- [ ] T019 [US5] Add OTel span tests to `test/unit/transport.test.ts` verifying: (a) a search-like request with per-request `openTelemetry: { captureSearchQuery: false }` does NOT include `db.query.text`; (b) the immediately following request with no per-request override DOES include `db.query.text`; (c) a request with per-request `openTelemetry: { captureSearchQuery: true }` when the constructor default is `false` DOES include `db.query.text`

**Checkpoint**: US5 complete — per-request override works in both directions. Run `npm test`.

---

## Phase 9: User Story 6 — Runtime Disable via Environment Variable (002-P1)

**Goal**: Setting `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY=false` disables query capture at runtime without a code change, regardless of constructor config.

**Independent Test**: With `captureSearchQuery: true` in code and `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY=false` in env, issue a search-like request and verify no `db.query.text` is set.

- [ ] T020 [US6] Add OTel span tests to `test/unit/transport.test.ts` verifying: (a) `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY=false` (lowercase) overrides `captureSearchQuery: true` in constructor — no `db.query.text`; (b) `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY=FALSE` (uppercase) also disables — no `db.query.text`; (c) `OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY` absent with `captureSearchQuery: true` — `db.query.text` IS set

**Checkpoint**: US6 complete — env var disable works case-insensitively. Run `npm test`.

---

## Phase 10: User Story 7 — Truncation of Long Query Bodies (002-P2)

**Goal**: After sanitization, `db.query.text` values exceeding 2048 characters are silently truncated with no error or warning.

**Independent Test**: Issue a `search` request with `captureSearchQuery: true` and a body that produces a sanitized string longer than 2048 characters. Verify `db.query.text` is exactly 2048 characters and no error is raised.

- [ ] T021 [US7] Add OTel span tests to `test/unit/transport.test.ts` verifying: (a) a sanitized body longer than 2048 chars sets `db.query.text` to exactly 2048 characters; (b) a sanitized body of exactly 2048 chars is stored without truncation; (c) no error, warning, or span event is emitted when truncation occurs; (d) truncation happens AFTER sanitization (construct a body where a literal straddles the 2048-char boundary and confirm no raw value appears in the output)

**Checkpoint**: US7 complete — truncation is bounded and silent. Run `npm test`.

---

## Phase 11: Polish & Cross-Cutting Concerns

- [ ] T022 [P] Add OTel span test to `test/unit/transport.test.ts` verifying that when sanitization fails on an unparseable body, `db.query.text` is silently omitted with no span event or error attribute added (`captureSearchQuery: true`)
- [ ] T023 Add release notes entry to `CHANGELOG.md` documenting: (a) new opt-in `db.query.text` OTel span attribute; (b) how to enable (`captureSearchQuery: true` or per-request override); (c) how to disable at runtime (`OTEL_ELASTICSEARCH_CAPTURE_SEARCH_QUERY=false`); (d) sanitization behavior — DSL literals replaced with `?`; parameterized string queries included without parameter values; non-parameterized string queries omitted; (e) security warning that sanitization does not guarantee prevention of all sensitive data leaks
- [ ] T024 Run `npm test` (build + lint + full test suite) and confirm clean exit with no failures

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational Phase 2**: No dependencies — start immediately
- **Foundational Phase 3**: Depends on Phase 2 — sanitization functions can be implemented once interface/constants are in place; BLOCKS Phase 4+
- **US1 (Phase 4)**: Depends on Phases 2 + 3 — BLOCKS all other user stories
- **US2 (Phase 5)**: Depends on Phase 4 — tests the false-path of the same capture block
- **US3–US4 (Phases 6–7)**: Depend on Phase 4; can proceed in parallel with US2
- **US5 (Phase 8)**: Depends on Phase 4
- **US6 (Phase 9)**: Depends on Phase 4
- **US7 (Phase 10)**: Covered by T015 in Phase 4; Phase 10 adds additional edge-case verification
- **Polish (Phase 11)**: Depends on all user story phases

### Within Phase 4

- T004 must complete before T010 and before T007 tests can run
- T005 and T006 can run in parallel with T004 (coordinate to avoid file conflicts)
- T007, T008, T009 can all run in parallel once their respective functions exist
- T010 depends on T004–T006
- T011–T015 depend on T010

### Parallel Opportunities

- T005 and T006 can run in parallel with T004 (different functions, same file — coordinate)
- T007, T008, T009 can all run in parallel (different describe blocks in same test file — coordinate)
- T012, T013, T014, T015 can all run in parallel after T010
- T017 and T018 can run in parallel
- T019, T020, T021 can run in parallel after T015

---

## Parallel Example: Phase 4 (US1)

```
# Once T004 is complete, launch in parallel:
Task T005: "Implement sanitizeStringQuery() in src/security.ts"
Task T006: "Implement sanitizeNdjsonBody() in src/security.ts"

# Once T004–T006 are complete, launch all security tests in parallel:
Task T007: "Unit tests for sanitizeJsonBody() in test/unit/security.test.ts"
Task T008: "Unit tests for sanitizeStringQuery() in test/unit/security.test.ts"
Task T009: "Unit tests for sanitizeNdjsonBody() in test/unit/security.test.ts"

# Once T010 is complete, launch all transport OTel tests in parallel:
Task T012: "Sanitization verified test in test/unit/transport.test.ts"
Task T013: "ndjson msearch/fleet.msearch test in test/unit/transport.test.ts"
Task T014: "String-query parameterized/non-parameterized tests in test/unit/transport.test.ts"
Task T015: "Truncation test in test/unit/transport.test.ts"
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 2: Foundational — interface, constants, env var wiring (T001–T003)
2. Complete Phase 3: Sanitization functions (T004–T006)
3. Complete Phase 4: US1 — transport integration + all sanitization tests (T007–T015)
4. **STOP and VALIDATE**: All 11 endpoints produce sanitized `db.query.text` spans when opted in. Run `npm test`.
5. This is a shippable increment — opt-in query capture with full sanitization.

### Incremental Delivery

1. Phases 2–3 → interface, constants, and all sanitization functions in place
2. US1 (Phase 4) → opt-in capture + sanitization + truncation → MVP shippable
3. US2 (Phase 5) → default-off behavior verified
4. US3 + US4 (Phases 6–7) → scope guards verified (non-search, no-body, stream)
5. US5 + US6 (Phases 8–9) → per-request override and env var disable verified
6. US7 (Phase 10) → truncation edge cases verified
7. Polish (Phase 11) → CHANGELOG, edge-case tests, final `npm test`

### All Tasks as a Single Track (Sequential)

T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011 → T012 → T013 → T014 → T015 → T016 → T017 → T018 → T019 → T020 → T021 → T022 → T023 → T024

---

## Notes

- **All sanitization logic lives in `src/security.ts`** — Transport.ts only dispatches to it
- **All `db.query.text` logic lives in one block in `request()`** — T010 is the single Transport implementation task
- `sanitizeStringQuery()` replaces the former `sanitizeEsqlBody()` — it handles `esql.async_query`, `esql.query`, and `sql.query` via parameterization detection rather than regex-based literal replacement
- Non-parameterized string queries return `null` from `sanitizeStringQuery()` and therefore never set `db.query.text` — T014 tests both branches
- T011 (all 11 endpoints) is the broadest test; T012–T015 verify specific behavioral properties
- US5–US7 phases are primarily test tasks — the implementation block (T010) handles all paths once the foundational wiring in T001–T003 is complete
- The `[P]` marker on sanitization function tasks (T005, T006) assumes coordination to avoid simultaneous edits to the same file section; run sequentially if working solo
