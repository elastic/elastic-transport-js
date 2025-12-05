#!/usr/bin/env node
/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync, spawnSync } from 'node:child_process'

function generateComparison(baseDir, prDir) {
  const result = spawnSync(
    'node',
    ['scripts/compare-benchmark-json.mjs', baseDir, prDir],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  )

  return {
    markdown: result.stdout?.trim() || '## Error\n\nUnable to generate comparison.',
    error: result.stderr?.trim()
  }
}

async function main() {
  const { markdown, error } = generateComparison(
    'benchmark-output/base',
    'benchmark-output/pr'
  )

  if (error) console.error(error)

  try {
    execSync(
      `buildkite-agent meta-data set pr_comment:benchmark:head '## Performance benchmark'`,
      { encoding: 'utf8' }
    )

    const escapedMarkdown = markdown.replace(/'/g, "'\\''")

    const commentBody = `
<details>
<summary>Benchmark details (Ubuntu)</summary>

${escapedMarkdown}

</details>
`
    execSync(
      `buildkite-agent meta-data set pr_comment:benchmark:body '${commentBody.replace(/'/g, "'\\''")}'`,
      { encoding: 'utf8' }
    )
  } catch (metaError) {
    console.error('Could not post PR comment:', metaError.message)
    console.log('\n--- Benchmark Results ---')
    console.log(markdown)
    console.log('--- End Results ---\n')
  }
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
