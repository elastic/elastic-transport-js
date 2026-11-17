/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runs the Hegel property suite and files one GitHub issue per failing property.
 *
 * Each failure is keyed by `<file> › <test name>`, stored as a hidden marker in the
 * issue body. Existing issues are never duplicated: open ones get a comment only when
 * the minimal example is new, closed ones are reopened.
 *
 * Usage (after `npm run build`, with `gh` authenticated):
 *   node scripts/property-test-issues.mjs [--dry-run]
 */

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const LABEL = 'property-test'
const MAX_NEW_ISSUES = 5
const marker = key => `<!-- property-test-key: ${key} -->`

/**
 * Pairs top-level `not ok` lines from a directly-run tap file with the Hegel failure
 * reports (written to stderr in the same order). Tests marked TODO are skipped.
 * If the counts disagree (e.g. a non-Hegel crash), examples are dropped rather than misattributed.
 */
export function parseFailures (file, tapOutput, stderr) {
  const names = []
  for (const line of tapOutput.split('\n')) {
    const m = line.match(/^not ok \d+ - (.*?)(?: # (.*))?$/)
    if (m != null && !/^TODO\b/i.test(m[2] ?? '')) names.push(m[1])
  }
  // every Hegel report ends with its `.reproduceFailure("<blob>")` line
  const examples = []
  let current = []
  for (const line of stderr.split('\n')) {
    current.push(line)
    const m = line.match(/\.reproduceFailure\("([^"]+)"\)/)
    if (m != null) {
      examples.push({ example: current.join('\n').trim(), blob: m[1] })
      current = []
    }
  }
  const paired = examples.length === names.length
  return names.map((name, i) => ({
    key: `${file} › ${name}`,
    example: paired ? examples[i].example : null,
    blob: paired ? examples[i].blob : null
  }))
}

/** Decides what to do per failure given existing issues ({ number, state, key, text }). */
export function planActions (failures, issues, maxNew) {
  const actions = []
  let created = 0
  for (const failure of failures) {
    const issue = issues.find(i => i.key === failure.key)
    if (issue == null) {
      if (created++ < maxNew) actions.push({ type: 'create', failure })
    } else if (issue.state === 'CLOSED') {
      actions.push({ type: 'reopen', failure, issue })
    } else if (failure.blob != null && !issue.text.includes(failure.blob)) {
      actions.push({ type: 'comment', failure, issue })
    }
  }
  return actions
}

function gh (...args) {
  return execFileSync('gh', args, { encoding: 'utf8' })
}

function report (failure) {
  const server = process.env.GITHUB_SERVER_URL
  const run = server != null ? `${server}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : 'local run'
  return [
    `Property \`${failure.key}\` failed with \`HEGEL_SEED=${process.env.HEGEL_SEED ?? 'unset'}\` (${run}).`,
    '',
    failure.example != null ? '```\n' + failure.example + '\n```' : 'No minimal example could be attributed; see the run log.',
    '',
    'Reproduce locally: `npm run build && HEGEL_SEED=<seed> node test/property/<file>`.'
  ].join('\n')
}

function runSuite (dir) {
  const failures = []
  let crashed = false
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort()) {
    const res = spawnSync(process.execPath, [path.join(dir, file)], { encoding: 'utf8' })
    process.stdout.write(res.stdout)
    process.stderr.write(res.stderr)
    const found = parseFailures(file, res.stdout, res.stderr)
    if (res.status !== 0 && found.length === 0) crashed = true
    failures.push(...found)
  }
  return { failures, crashed }
}

function existingIssues () {
  const list = JSON.parse(gh('issue', 'list', '--label', LABEL, '--state', 'all', '--limit', '1000', '--json', 'number,state,body'))
  return list.flatMap(issue => {
    const m = issue.body.match(/<!-- property-test-key: (.*?) -->/)
    if (m == null) return []
    const comments = JSON.parse(gh('issue', 'view', String(issue.number), '--json', 'comments')).comments
    return [{ number: issue.number, state: issue.state, key: m[1], text: issue.body + comments.map(c => c.body).join('\n') }]
  })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run')
  const { failures, crashed } = runSuite(path.join(import.meta.dirname, '..', 'test', 'property'))
  console.log(`\n${failures.length} property failure(s)`)

  if (failures.length > 0) {
    if (!dryRun) gh('label', 'create', LABEL, '--force', '--description', 'Found by the weekly Hegel property test run')
    for (const { type, failure, issue } of planActions(failures, existingIssues(), MAX_NEW_ISSUES)) {
      console.log(`${dryRun ? '[dry-run] ' : ''}${type}: ${issue != null ? `#${issue.number}` : failure.key}`)
      if (dryRun) continue
      if (type === 'create') {
        gh('issue', 'create', '--label', LABEL, '--title', `Property test failure: ${failure.key}`, '--body', `${marker(failure.key)}\n${report(failure)}`)
      } else {
        if (type === 'reopen') gh('issue', 'reopen', String(issue.number))
        gh('issue', 'comment', String(issue.number), '--body', report(failure))
      }
    }
  }
  // failures are reported as issues; only fail the job when results could not be parsed
  if (crashed) process.exit(1)
}
