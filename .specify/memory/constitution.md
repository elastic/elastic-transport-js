<!--
## Sync Impact Report

**Version change**: none (all placeholders) → 1.0.0 (initial ratification)

### Principles Added
- I. No Breaking Changes (NON-NEGOTIABLE)
- II. Minimal Runtime Dependencies
- III. Test-Driven Quality (NON-NEGOTIABLE)
- IV. API Documentation
- V. Elasticsearch-Aligned Versioning

### Sections Added
- Core Principles (all five)
- Technology Standards
- Development Workflow
- Governance

### Sections Removed
- None

### Templates
| File | Status |
|------|--------|
| `.specify/templates/plan-template.md` | ✅ No changes needed — Constitution Check gates remain dynamic |
| `.specify/templates/spec-template.md` | ✅ No changes needed |
| `.specify/templates/tasks-template.md` | ✅ Updated — test tasks changed from OPTIONAL to MANDATORY |
| `.specify/templates/agent-file-template.md` | ✅ No changes needed |
| `.specify/templates/checklist-template.md` | ✅ No changes needed |

### Deferred TODOs
- None — all placeholders resolved.
-->

# Elastic Node.js Transport Constitution

## Core Principles

### I. No Breaking Changes (NON-NEGOTIABLE)

The transport library MUST maintain backward compatibility at all times. Because
the major version is reserved for Elasticsearch major releases and cannot be
changed by contributors, any API removal, behavioral change, or incompatible
interface modification is strictly forbidden in minor and patch releases.

- All public API surfaces MUST remain stable across minor and patch releases.
- Deprecation MUST precede removal; removal can only occur in a new major version.
- Changes that alter observable behavior for existing callers are considered
  breaking and MUST NOT be introduced.

**Rationale**: Consumers depend on this library as a foundational transport layer.
A broken transport means a broken Elasticsearch client with no safe upgrade path.

### II. Minimal Runtime Dependencies

The library MUST keep its set of runtime (`dependencies`) packages to the minimum
required for correct operation.

- New packages MUST NOT be added to `dependencies` in `package.json`.
- `devDependencies` additions are permitted but require deliberate justification.
- Prefer in-house implementation over a new dependency when the scope is small
  and the maintenance cost is bounded.

**Rationale**: Every runtime dependency is a transitive dependency for all
consumers of `@elastic/transport`. Each addition increases supply-chain risk,
bundle size, and maintenance surface.

### III. Test-Driven Quality (NON-NEGOTIABLE)

Every code change MUST include added or updated unit tests. A change is NOT
complete until `npm test` passes cleanly.

- New functions, types, and classes MUST have accompanying unit tests in
  `test/unit/`.
- Existing tests MUST be updated if changed behavior makes them stale.
- `npm test` (build + lint + full test suite) MUST exit cleanly before any
  change is considered done.
- Tests are written alongside implementation; they are not optional follow-up work.

**Rationale**: The transport layer is critical infrastructure. Unverified changes
risk silent failures that are difficult to trace in downstream clients.

### IV. API Documentation

Every new public function, type, and class MUST have a complete docstring.
Existing public API docstrings MUST be updated whenever behavior changes.

- Docstrings MUST describe parameters, return values, and thrown errors.
- Comments on non-obvious internal logic are encouraged but MUST NOT restate
  what the code already clearly expresses.

**Rationale**: This library is consumed by other Elastic client libraries and by
third-party integrators. Clear documentation reduces integration errors and
support burden.

### V. Elasticsearch-Aligned Versioning

The major version number is reserved exclusively for Elastic Stack major releases
and MUST NOT be changed by contributors.

- Contributors MUST only increment minor or patch version numbers.
- A new minor version is appropriate for new backward-compatible functionality.
- A new patch version is appropriate for bug fixes and non-functional changes.
- All new development targets the `main` branch; backporting to prior majors or
  minors is handled externally.

**Rationale**: The versioning contract signals Elasticsearch compatibility to
consumers. Unilateral major version bumps break that signal and create confusion
about which Elasticsearch version is supported.

## Technology Standards

- **Language**: TypeScript (source in `src/`); compiled to CommonJS (`lib/`) and
  ESM (`esm/`) for dual-module publishing.
- **Runtime**: Node.js >=20.
- **Linting**: `ts-standard`; all source MUST pass `npm run lint` without errors.
- **Build**: `npm run build` MUST produce clean, error-free output.
- **OS Compatibility**: All source code and npm scripts MUST produce equivalent
  results on Linux, macOS, and Windows. Shell-specific idioms in scripts are
  forbidden; use Node.js for cross-platform file operations.

## Development Workflow

1. Make changes to `src/**/*.ts`.
2. Add or update unit tests in `test/unit/`.
3. Run `npm test` to build, lint, and execute the full test suite.
4. A change is complete only when `npm test` exits cleanly with no failures.
5. Docstrings MUST be present on all new public APIs before a change is submitted.
6. Never modify the major version number.

## Governance

This constitution supersedes all other project practices and guidelines.
Amendments require:

1. A written proposal describing the change and its rationale.
2. Consistency propagation — all templates and dependent artifacts MUST be
   updated in the same commit as the constitution change.
3. A version bump following the policy below.

**Versioning Policy**:

- MAJOR: Backward-incompatible principle removals or governance redefinitions.
- MINOR: New principle or section added, or materially expanded guidance.
- PATCH: Clarifications, wording fixes, or non-semantic refinements.

**Compliance**: All PRs and reviews MUST verify compliance with this constitution.
Non-compliance blocks merge. Refer to `AGENTS.md` for runtime development guidance.

**Version**: 1.0.0 | **Ratified**: 2026-03-10 | **Last Amended**: 2026-03-10
