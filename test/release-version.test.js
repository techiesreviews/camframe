import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// A release bumps the version in several files by hand; this static check fails a partial bump before packaging.

const root = join(import.meta.dirname, '..')
const read = (file) => readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n')
const { version } = JSON.parse(read('package.json'))

test('package-lock.json carries the package version', () => {
  const lock = JSON.parse(read('package-lock.json'))
  assert.equal(lock.version, version)
  assert.equal(lock.packages[''].version, version)
})

test('the docs baseline and the newest release row name the package version', () => {
  assert.ok(read('docs/README.md').includes(`- Product version: \`${version}\``))
  // The first row under the Release timeline's header separator, so an "Unreleased" row placed on top fails too.
  const lines = read('docs/product-history.md').split('\n')
  const timeline = lines.indexOf('## Release timeline')
  const separator = lines.findIndex((line, index) => index > timeline && line.startsWith('| ---'))
  const firstRow = lines[separator + 1]
  assert.ok(timeline >= 0 && separator > timeline, 'Release timeline table found')
  assert.ok(firstRow.startsWith(`| ${version} |`), `first release row: ${firstRow.slice(0, 20)}`)
})

test('the version has a dated verification run', () => {
  const runs = readdirSync(join(root, 'docs', 'verification', 'runs'))
  assert.ok(runs.some((name) => /^\d{4}-\d{2}-\d{2}-/.test(name) && name.includes(`-v${version}-`)), `a run named *-v${version}-*.md`)
})
