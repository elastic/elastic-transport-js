import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

const baselinesDir = path.join(__dirname, 'baselines')
const resultsDir = path.join(process.cwd(), 'benchmark-results')
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0]
const baselineName = process.argv[2] || `baseline-${timestamp}`

if (!fs.existsSync(baselinesDir)) {
  fs.mkdirSync(baselinesDir, { recursive: true })
}

console.log('Running benchmarks to generate baseline...\n')

execSync('npm run benchmark:all', { stdio: 'inherit' })

const baselineDir = path.join(baselinesDir, baselineName)
fs.mkdirSync(baselineDir, { recursive: true })

if (fs.existsSync(resultsDir)) {
  const files = fs.readdirSync(resultsDir)
  for (const file of files) {
    const src = path.join(resultsDir, file)
    const dest = path.join(baselineDir, file)
    fs.copyFileSync(src, dest)
    console.log(`Saved ${file} to ${baselineName}/`)
  }
}

console.log(`\n✓ Baseline saved: ${baselineName}`)
console.log(`Location: ${baselineDir}`)

