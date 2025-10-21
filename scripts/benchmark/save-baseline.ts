/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Save current benchmark results as baseline
 * Usage: npx tsx scripts/benchmark/save-baseline.ts
 */

import * as fs from 'fs'
import * as path from 'path'

const RESULTS_DIR = path.join(__dirname, '../../benchmark-results')
const BASELINE_DIR = path.join(__dirname, 'baselines')
const NODE_VERSION = process.env.NODE_VERSION ?? process.version.slice(1).split('.')[0]

if (!fs.existsSync(BASELINE_DIR)) {
  fs.mkdirSync(BASELINE_DIR, { recursive: true })
  console.log(`Created baseline directory: ${BASELINE_DIR}`)
}

if (!fs.existsSync(RESULTS_DIR)) {
  console.error('No benchmark results found. Run: npm run benchmark')
  process.exit(1)
}

const files = fs.readdirSync(RESULTS_DIR)
const jsonFiles = files.filter(f => f.endsWith('.json') && f.includes(`node${NODE_VERSION}`))

if (jsonFiles.length === 0) {
  console.error(`'No JSON results found for Node ver ${NODE_VERSION}`)
  process.exit(1)
}

console.log(`Saving baselines for Node version ${NODE_VERSION}...`)

jsonFiles.forEach(file => {
  const srcPath = path.join(RESULTS_DIR, file)
  const destPath = path.join(BASELINE_DIR, file)

  fs.copyFileSync(srcPath, destPath)
  console.log(`Saved ${file} as baseline`)
})

console.log('\n Baselines saved successfully!')
console.log(`Location: ${BASELINE_DIR}`)
console.log('\n These baselines will be used for performance regression comparison.')
console.log('   Commit these files to the repository to track performance over time.')

