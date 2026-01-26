---
name: esm-compatibility-windows
description: Guide for ensuring JS modules will be compatible with Windows. Use this when adding new code to any TypeScript module that could evaluate immediately at import time.
---

## The Problem

The test `test/unit/esm-import.test.mjs` fails on Windows with "1..0 # no tests found" when module-level code executes during import. This prevents tests from being registered and causes the test runner to exit with code 1.

## Root Cause

Windows handles ESM module initialization differently than Linux/macOS. Any code that executes at module load time (outside of function/class definitions) can fail on Windows, especially:

1. **Calling functions at module level** - Including `Debug()`, `Object.keys().map()`, `promisify()`, etc.
2. **Path operations with `import.meta.url`** - Windows file URLs use `file:///D:/...` format which can cause path resolution issues
3. **Dynamic require() via createRequire()** - Can fail if called at module load time
4. **Complex object transformations** - Like `.map()`, `.reduce()`, etc. on enums or constants

## Solution

All module-level expressions that call functions or perform transformations must be lazy-loaded:

```typescript
// BAD - Executes at module load time
const debug = Debug('elasticsearch')
const supportedEvents = Object.keys(events).map(k => events[k])
const gzip = promisify(zlib.gzip)

// GOOD - Executes only when needed
let debug: debug.Debugger | undefined
function getDebug() {
  if (debug === undefined) {
    debug = Debug('elasticsearch')
  }
  return debug
}
```

## What's Safe at Module Level

These patterns are generally safe and don't cause Windows ESM issues:

1. **Simple constant declarations** - `const MAX_SIZE = 100`
2. **Destructuring from imports** - `const { createGzip } = zlib`
3. **Type imports** - `import type { Pool } from 'undici'`
4. **Class/function definitions** - No execution, just definitions
5. **Simple object/array literals** - `const obj = { key: 'value' }`

**Important**: Always check `esm/*.js` files after changes to see what actually executes at module load time.

## Resources

- [Node.js ESM Documentation](https://nodejs.org/api/esm.html)
- [Windows file: URL format](https://docs.microsoft.com/en-us/windows/win32/fileio/naming-a-file#win32-file-namespaces)
- [TypeScript Module Resolution](https://www.typescriptlang.org/docs/handbook/module-resolution.html)
