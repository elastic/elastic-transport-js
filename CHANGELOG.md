# Changelog

## 9.4.0

### Features

- Reject requests that exceed configurable `maxPathLength` ([#400](https://github.com/elastic/elastic-transport-js/pull/400))
- Move OpenTelemetry tracing into a middleware; capture sanitized search queries as `db.query.text` ([#383](https://github.com/elastic/elastic-transport-js/pull/383))

### Fixes

- Prevent uncaught write EPIPE on peer close mid-request ([#402](https://github.com/elastic/elastic-transport-js/pull/402))
- Support path prefix in node URL ([#388](https://github.com/elastic/elastic-transport-js/pull/388))
- Strip credentials from OTel span attributes ([#381](https://github.com/elastic/elastic-transport-js/pull/381))
