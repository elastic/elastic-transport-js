# AGENTS.md

## Setup commands

Always use `npm` commands, not `yarn`, `pnpm` or any other third-party packaging tool.

- Install dependencies: `npm install`
- Run all tests: `npm test`
- Run just unit tests: `npm run test:unit`
- Run just the linter: `npm run lint`
- Fix linter issues: `npm run lint:fix`
- Build TypeScript (outputs both ESM and CommonJS): `npm run build`

## Testing

**The entire test suite (`npm test`) must pass and exit cleanly before you commit code.**

## Project Structure

- **src/** - TypeScript source files
- **lib/** - Compiled CommonJS output
- **esm/** - Compiled ES Module output (was lib/esm before)
- **test/unit/** - Unit tests
- **test/acceptance/** - Integration/acceptance tests

## Development Workflow

1. Make changes to `src/**/*.ts` files
2. Run `npm run build` to compile
3. Run `npm run test` to verify all tests pass

## Best Practices for Future Changes

- **Use the debug module** - Import from `./debug` not `debug` package directly

## Windows Compatibility

### Build Scripts

**Important**: Windows cmd.exe handles `echo` differently than Unix shells. When using `echo` to create JSON files:

```bash
# ❌ BAD - Creates invalid JSON on Windows with single quotes
echo '{"type":"module"}' > file.json

# ✅ GOOD - Use Node.js for cross-platform JSON file creation  
node -e "require('fs').writeFileSync('file.json', JSON.stringify({type:'module'}, null, 2))"
```

The `echo` command on Windows includes the surrounding quotes in the output, resulting in `'{"type":"module"}'` which is invalid JSON.

## Adding new agent instructions

All markdown instructions authored for other agents must be as concise as possible.

If a specific action you learned to do better will be useful to other agents doing the same task in the future, create a new skill in `.github/skills/`.

If you learned something that will be useful to any contributor to this project, update `AGENTS.md`.

