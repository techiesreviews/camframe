import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The GitHub checks run the unit tests on every pull request and on pushes to dev, with no secrets and nothing published.

const checks = readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'checks.yml'), 'utf8').replace(/\r\n/g, '\n')

test('checks.yml runs npm test on pull requests and on pushes to dev', () => {
  assert.match(checks, /^on:\n {2}push:\n {4}branches: \[dev\]\n {2}pull_request:\n/m)
  assert.ok(checks.split('\n').some((line) => line.trim() === '- run: npm test'))
})

test('checks.yml has a read-only token, no secrets and no build or publish step', () => {
  assert.match(checks, /^permissions:\n {2}contents: read$/m)
  assert.doesNotMatch(checks, /secrets\.|contents: write|electron-builder|npm run (dist|pack)|gh release/)
})
