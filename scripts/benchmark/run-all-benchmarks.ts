import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const benchmarks = [
  'benchmark-transport-real.js',
  'benchmark-gc-tracking.js'
]

const resultsDir = path.join(process.cwd(), 'benchmark-results')

if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true })
}

console.log('Running all benchmarks...\n')

for (const benchmark of benchmarks) {
  const benchmarkPath = path.join(__dirname, benchmark)
  
  if (!fs.existsSync(benchmarkPath)) {
    console.warn(`⚠️  Skipping ${benchmark} - file not found`)
    continue
  }

  console.log(`\n${'='.repeat(70)}`)
  console.log(`Running: ${benchmark}`)
  console.log('='.repeat(70))
  
  try {
    if (benchmark.includes('gc-tracking')) {
      execSync(
        `node --expose-gc ${benchmarkPath} > ${path.join(resultsDir, 'gc-tracking-results.json')}`,
        { stdio: 'inherit', cwd: process.cwd() }
      )
    } else {
      execSync(`node ${benchmarkPath}`, { stdio: 'inherit', cwd: process.cwd() })
    }
    console.log(`✓ ${benchmark} completed`)
  } catch (error) {
    console.error(`✗ ${benchmark} failed:`, error)
    process.exit(1)
  }
}

console.log('\n' + '='.repeat(70))
console.log('All benchmarks completed!')
console.log(`Results saved to: ${resultsDir}`)
console.log('='.repeat(70))

