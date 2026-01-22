#!/usr/bin/env node
/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

const fs = require('fs')
const path = require('path')

// Fix the package.json require in Transport.js for ESM
const transportPath = path.join(__dirname, '..', 'lib', 'esm', 'Transport.js')

if (!fs.existsSync(transportPath)) {
  console.log('Transport.js not found, skipping fix')
  process.exit(0)
}

let content = fs.readFileSync(transportPath, 'utf8')

// Add createRequire import and setup if not present
if (!content.includes('createRequire') && content.includes("require('../package.json')")) {
  // Find the last import statement
  const lastImportIndex = content.lastIndexOf('import ')
  const newlineAfterImport = content.indexOf('\n', lastImportIndex)

  if (newlineAfterImport !== -1) {
    const beforeImport = content.substring(0, newlineAfterImport + 1)
    const afterImport = content.substring(newlineAfterImport + 1)

    content = beforeImport + "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\n" + afterImport
  }

  // Fix the path to package.json - from lib/esm, it's ../../package.json
  content = content.replace(
    /require\(['"]\.\.\/package\.json['"]\)/g,
    "require('../../package.json')"
  )

  fs.writeFileSync(transportPath, content, 'utf8')
  console.log(`Fixed package.json loading in ${transportPath}`)
} else {
  console.log('No fixes needed for Transport.js')
}
