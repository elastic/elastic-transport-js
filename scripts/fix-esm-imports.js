#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

const fs = require('fs')
const path = require('path')

/**
 * Recursively process all .js files in the ESM output directory
 * and add .js extensions to relative imports
 */
function processDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      processDirectory(fullPath)
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      try {
        processFile(fullPath)
      } catch (err) {
        console.error(`Error processing ${fullPath}:`, err.message)
        // Continue processing other files
      }
    }
  }
}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8')
  let modified = false
  const dir = path.dirname(filePath)

  // Match import/export statements with relative paths
  // Matches: from './something' or from "../something" or from './dir/something'
  content = content.replace(
    /(from\s+['"])(\.[^'"]+)(['"])/g,
    (match, prefix, importPath, suffix) => {
      // Skip if already has .js extension
      if (importPath.endsWith('.js')) {
        return match
      }

      // Resolve the import path relative to the current file
      const resolvedPath = path.resolve(dir, importPath)
      
      // Check if it's a directory (with index.js)
      try {
        const stat = fs.statSync(resolvedPath)
        if (stat.isDirectory() && fs.existsSync(path.join(resolvedPath, 'index.js'))) {
          modified = true
          return `${prefix}${importPath}/index.js${suffix}`
        }
      } catch (err) {
        // Path doesn't exist or error accessing it, just add .js
      }
      
      // Otherwise just add .js
      modified = true
      return `${prefix}${importPath}.js${suffix}`
    }
  )

  // Replace require() calls with import.meta.url based createRequire for ESM
  // Better approach: replace require() with createRequire
  if (content.includes("require('../package.json')") || content.includes('require("../package.json")')) {
    // Add import for createRequire if not present
    if (!content.includes('createRequire')) {
      // Find the last import statement
      const lastImportIndex = content.lastIndexOf('import ')
      
      if (lastImportIndex !== -1) {
        const newlineAfterImport = content.indexOf('\n', lastImportIndex)
        
        if (newlineAfterImport !== -1) {
          const beforeImport = content.substring(0, newlineAfterImport + 1)
          const afterImport = content.substring(newlineAfterImport + 1)
          
          content = beforeImport + "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\n" + afterImport
          modified = true
        }
      } else {
        // No imports found, add at the top after the header comment
        const commentEnd = content.indexOf('*/')
        if (commentEnd !== -1) {
          const beforeComment = content.substring(0, commentEnd + 2)
          const afterComment = content.substring(commentEnd + 2)
          content = beforeComment + "\nimport { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\n" + afterComment
          modified = true
        }
      }
    }
    
    // Fix the path to package.json - from lib/esm, it's ../../package.json
    content = content.replace(
      /require\(['"]\.\.\/package\.json['"]\)/g,
      "require('../../package.json')"
    )
    modified = true
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8')
    console.log(`Updated: ${filePath}`)
  }
}

const esmDir = path.join(__dirname, '..', 'lib', 'esm')
console.log(`Processing ESM files in: ${esmDir}`)
processDirectory(esmDir)
console.log('Done!')
