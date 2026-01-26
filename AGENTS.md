# Agent Context for elastic-transport-js

This document provides important context for AI agents working on this repository to avoid common pitfalls and understand the codebase architecture.

## Critical: ESM Windows Compatibility

### The Problem
The test `test/unit/esm-import.test.mjs` fails on Windows with "1..0 # no tests found" when module-level code executes during import. This prevents tests from being registered and causes the test runner to exit with code 1.

### Root Cause
Windows handles ESM module initialization differently than Linux/macOS. Any code that executes at module load time (outside of function/class definitions) can fail on Windows, especially:

1. **Calling functions at module level** - Including `Debug()`, `Object.keys().map()`, `promisify()`, etc.
2. **Path operations with `import.meta.url`** - Windows file URLs use `file:///D:/...` format which can cause path resolution issues
3. **Dynamic require() via createRequire()** - Can fail if called at module load time
4. **Complex object transformations** - Like `.map()`, `.reduce()`, etc. on enums or constants

### Solutions Implemented

#### 1. Centralized Debug Module (`src/debug.ts`)
Instead of each module calling `Debug('elasticsearch')` at module level, we have a single lazy-initialized debug module:

```typescript
// src/debug.ts
let debugInstance: debug.Debugger | undefined

export function debug (formatter: any, ...args: any[]): void {
  if (debugInstance === undefined) {
    debugInstance = Debug('elasticsearch')
  }
  debugInstance(formatter, ...args)
}
```

**Usage**: `import { debug } from './debug'` then call `debug('message')` directly.

#### 2. Lazy Initialization Pattern
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

#### 3. Lazy Undici Loading
The `undici` package is loaded dynamically to avoid Windows initialization issues:

```typescript
let undiciModule: typeof import('undici') | null = null
async function getUndici(): Promise<typeof import('undici')> {
  if (undiciModule === null) {
    undiciModule = await import('undici')
  }
  return undiciModule
}
```

### Files with Lazy Initialization

- **src/debug.ts** - Centralized debug logger
- **src/connection/UndiciConnection.ts** - Lazy undici import + debug
- **src/connection/HttpConnection.ts** - Lazy debug
- **src/connection/BaseConnection.ts** - Lazy status validation
- **src/Transport.ts** - Lazy debug, gzip/unzip, version, user-agent
- **src/Serializer.ts** - Lazy debug
- **src/pool/BaseConnectionPool.ts** - Lazy debug
- **src/pool/ClusterConnectionPool.ts** - Lazy debug
- **src/Diagnostic.ts** - Lazy event validation

### What's Safe at Module Level

These patterns are generally safe and don't cause Windows ESM issues:

1. **Simple constant declarations** - `const MAX_SIZE = 100`
2. **Destructuring from imports** - `const { createGzip } = zlib`
3. **Type imports** - `import type { Pool } from 'undici'`
4. **Class/function definitions** - No execution, just definitions
5. **Simple object/array literals** - `const obj = { key: 'value' }`

### Testing

Always test changes that might affect module loading:

```bash
# This test specifically checks ESM imports work on Windows
npm run test:unit  # Includes test/unit/esm-import.test.mjs

# The test imports all major exports to trigger module loading
node test/unit/esm-import.test.mjs
```

## Project Structure

### Key Directories

- **src/** - TypeScript source files
- **lib/cjs/** - Compiled CommonJS output
- **lib/esm/** - Compiled ES Module output (check this for actual runtime code)
- **test/unit/** - Unit tests (includes .test.ts and .test.mjs files)
- **test/acceptance/** - Integration/acceptance tests

### Build System

The project uses TypeScript with dual output (CJS + ESM):

```bash
npm run build          # Full build with lint
npm run build:cjs      # CommonJS output only
npm run build:esm      # ESM output only
npm run build:esm-fix  # Post-process ESM output
```

**Important**: Always check `lib/esm/*.js` files after changes to see what actually executes at module load time.

### Test Configuration

`package.json` tap configuration uses directory patterns instead of glob patterns:

```json
{
  "tap": {
    "files": [
      "test/unit/",
      "test/acceptance/"
    ]
  }
}
```

This ensures `.test.mjs` files are discovered alongside `.test.ts` files.

## Common Patterns

### Async Pool Initialization (UndiciConnection)

The `UndiciConnection` class initializes its pool asynchronously to avoid blocking module load:

```typescript
class UndiciConnection {
  pool!: Pool
  private readonly poolPromise: Promise<Pool>

  constructor(opts) {
    // Synchronous validation here
    this.poolPromise = this.initializePool(opts)
  }

  private async initializePool(opts) {
    const { Pool } = await getUndici()
    // Pool setup...
    this.pool = new Pool(...)
    return this.pool
  }

  async request(params) {
    await this.poolPromise  // Ensure pool is ready
    return this.pool.request(params)
  }
}
```

### Memoized Getters

For values that are expensive to compute but only needed once:

```typescript
let cachedValue: string | undefined

function getValue(): string {
  if (cachedValue === undefined) {
    cachedValue = expensiveComputation()
  }
  return cachedValue
}
```

## Debugging Windows Issues

If tests fail on Windows but pass on Linux:

1. **Check `lib/esm/*.js` compiled output** - Look for code executing at module level (outside functions/classes)
2. **Look for `createRequire(import.meta.url)`** - This is auto-generated for ESM `require()` calls and can fail on Windows
3. **Check for `Object.keys().map()` or similar**  - Should be inside functions, not at module level
4. **Look for function calls in const declarations** - Like `const x = fn()` at module level
5. **Test locally if possible** - Windows-specific issues are hard to debug remotely

## Development Workflow

1. Make changes to `src/**/*.ts` files
2. Run `npm run build` to compile
3. Check `lib/esm/**/*.js` for module-level code execution
4. Run `npm run test:unit` to verify all tests pass including ESM import test
5. If ESM test fails, look for new module-level code execution

## Dependencies

### Critical Dependencies

- **debug** - Used throughout for logging; must be lazy-loaded
- **undici** - HTTP client; must be dynamically imported
- **@opentelemetry/api** - Tracing; generally safe but monitor for side effects

### Transitive Dependencies

The ESM build uses `createRequire()` to load `package.json`, which is fine as long as it's done in a function, not at module level.

## Known Issues

1. **User-Agent header test** - May be sensitive to timing with lazy initialization (1 failing test out of 1459)
2. **Windows path handling** - Always use forward slashes in test file paths, Node.js normalizes them

## Best Practices for Future Changes

1. **Never add module-level function calls** - Always use lazy initialization
2. **Test ESM import after changes** - Run `node test/unit/esm-import.test.mjs`
3. **Check compiled output** - Look at `lib/esm/*.js` to see runtime behavior
4. **Document Windows compatibility** - Note in PR if changes affect module loading
5. **Use the debug module** - Import from `./debug` not `debug` package directly

## Resources

- [Node.js ESM Documentation](https://nodejs.org/api/esm.html)
- [Windows file: URL format](https://docs.microsoft.com/en-us/windows/win32/fileio/naming-a-file#win32-file-namespaces)
- [TypeScript Module Resolution](https://www.typescriptlang.org/docs/handbook/module-resolution.html)
