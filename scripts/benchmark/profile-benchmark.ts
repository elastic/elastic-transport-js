/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Profiling wrapper for benchmarks
 * Supports multiple profiling tools: --prof, 0x, clinic.js
 */

import { execSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const BENCHMARK_DIR = path.join(__dirname)
const PROFILE_OUTPUT_DIR = path.join(__dirname, '../../profile-results')

interface ProfilerConfig {
  name: string
  command: string[]
  postProcess?: string
  outputFiles: string[]
  description: string
}

const PROFILERS: Record<string, ProfilerConfig> = {
  prof: {
    name: 'Node.js --prof',
    command: ['node', '--prof', '--no-logfile-per-isolate', '--import', 'tsx'],
    postProcess: 'node --prof-process isolate-*.log > profile-results/prof-output.txt && rm isolate-*.log',
    outputFiles: ['prof-output.txt'],
    description: 'Built-in V8 profiler - tick-based sampling'
  },
  
  flame: {
    name: '0x Flamegraph',
    command: ['npx', '0x', '--output-dir=profile-results/flame', '--'],
    postProcess: undefined,
    outputFiles: ['flame/flamegraph.html'],
    description: 'Interactive flamegraph visualization'
  },
  
  clinicDoctor: {
    name: 'Clinic.js Doctor',
    command: ['npx', 'clinic', 'doctor', '--dest=profile-results/clinic-doctor', '--on-port=exit', '--'],
    postProcess: undefined,
    outputFiles: ['clinic-doctor/*.html'],
    description: 'Overall performance health check'
  },
  
  clinicFlame: {
    name: 'Clinic.js Flame',
    command: ['npx', 'clinic', 'flame', '--dest=profile-results/clinic-flame', '--on-port=exit', '--'],
    postProcess: undefined,
    outputFiles: ['clinic-flame/*.html'],
    description: 'CPU flamegraph with clinic.js'
  },
  
  clinicBubble: {
    name: 'Clinic.js Bubbleprof',
    command: ['npx', 'clinic', 'bubbleprof', '--dest=profile-results/clinic-bubble', '--on-port=exit', '--'],
    postProcess: undefined,
    outputFiles: ['clinic-bubble/*.html'],
    description: 'Async operations visualization'
  },
  
  inspect: {
    name: 'Chrome DevTools',
    command: ['node', '--inspect'],
    postProcess: undefined,
    outputFiles: [],
    description: 'Chrome DevTools profiler (manual - open chrome://inspect)'
  }
}

function ensureOutputDir(): void {
  if (!fs.existsSync(PROFILE_OUTPUT_DIR)) {
    fs.mkdirSync(PROFILE_OUTPUT_DIR, { recursive: true })
  }
}

function buildCommand(profilerConfig: ProfilerConfig, benchmarkScript: string): string[] {
  const scriptPath = benchmarkScript
  
  // For profilers that already include node command (e.g., node --prof)
  if (profilerConfig.command[0] === 'node') {
    return [...profilerConfig.command, scriptPath]
  }
  
  // For TypeScript files with profilers that use -- separator (0x, clinic)
  if (benchmarkScript.endsWith('.ts')) {
    // Check if command ends with '--' separator
    if (profilerConfig.command[profilerConfig.command.length - 1] === '--') {
      return [...profilerConfig.command, 'npx', 'tsx', scriptPath]
    }
    // Otherwise, add node with tsx loader
    return [...profilerConfig.command, 'node', '--loader', 'tsx', scriptPath]
  }
  
  // For JavaScript files
  return [...profilerConfig.command, 'node', scriptPath]
}

function runProfiler(profilerName: string, benchmarkScript: string): void {
  const profiler = PROFILERS[profilerName]
  
  if (!profiler) {
    console.error(`Unknown profiler: ${profilerName}`)
    console.error(`Available profilers: ${Object.keys(PROFILERS).join(', ')}`)
    process.exit(1)
  }
  
  console.log('='.repeat(70))
  console.log(`Profiling with: ${profiler.name}`)
  console.log(`Description: ${profiler.description}`)
  console.log(`Benchmark: ${benchmarkScript}`)
  console.log('='.repeat(70))
  
  ensureOutputDir()
  
  const commandArgs = buildCommand(profiler, benchmarkScript)
  const [cmd, ...args] = commandArgs
  
  console.log(`\nRunning: ${commandArgs.join(' ')}\n`)
  
  try {
    if (profilerName === 'inspect') {
      console.log('\nChrome DevTools Instructions:')
      console.log('1. Open Chrome and navigate to: chrome://inspect')
      console.log('2. Click "inspect" under Remote Target')
      console.log('3. Go to "Profiler" or "Performance" tab')
      console.log('4. Start recording')
      console.log('5. The benchmark will run automatically')
      console.log('6. Stop recording when complete\n')
      
      const proc = spawn(cmd, args, {
        stdio: 'inherit',
        shell: true
      })
      
      proc.on('close', (code) => {
        if (code !== 0) {
          console.error(`Process exited with code ${code}`)
        }
      })
      
      return
    }
    
    // Regular profilers
    execSync(commandArgs.join(' '), {
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd()
    })
    
    // Post-processing
    if (profiler.postProcess) {
      console.log('\n📊 Post-processing profile data...')
      execSync(profiler.postProcess, {
        stdio: 'inherit',
        shell: true
      })
    }
    
    console.log('\n' + '='.repeat(70))
    console.log('Profiling complete!')
    console.log('='.repeat(70))
    
    if (profiler.outputFiles.length > 0) {
      console.log('\nOutput files:')
      profiler.outputFiles.forEach(file => {
        const fullPath = path.join(PROFILE_OUTPUT_DIR, file)
        console.log(`   ${fullPath}`)
      })
    }
    
  } catch (error: any) {
    console.error(`\nProfiling failed: ${error.message}`)
    
    if (error.message.includes('0x') || error.message.includes('clinic')) {
      console.log('\nTip: Install profiling tools:')
      console.log('   npm install -g 0x clinic')
    }
    
    process.exit(1)
  }
}

function listProfilers(): void {
  console.log('Available profilers:\n')
  
  Object.entries(PROFILERS).forEach(([key, profiler]) => {
    console.log(`  ${key.padEnd(15)} - ${profiler.description}`)
  })
  
  console.log('\nUsage:')
  console.log('  npx tsx scripts/benchmark/profile-benchmark.ts <profiler> <benchmark-file>')
  console.log('\nExamples:')
  console.log('  npx tsx scripts/benchmark/profile-benchmark.ts prof benchmark-transport.ts')
  console.log('  npx tsx scripts/benchmark/profile-benchmark.ts flame benchmark-transport.ts')
  console.log('  npx tsx scripts/benchmark/profile-benchmark.ts clinicFlame benchmark-gc.ts')
}

function main(): void {
  const args = process.argv.slice(2)
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    listProfilers()
    process.exit(0)
  }
  
  if (args.length < 2) {
    console.error('Error: Missing arguments')
    console.error('Usage: profile-benchmark.ts <profiler> <benchmark-file>\n')
    listProfilers()
    process.exit(1)
  }
  
  const [profilerName, benchmarkScript] = args
  
  runProfiler(profilerName, benchmarkScript)
}

main()

