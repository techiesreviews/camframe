import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// A release bumps the version in several files by hand; this static check fails a partial bump before packaging.

const root = join(import.meta.dirname, '..')
const read = (file) => readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n')
const { version } = JSON.parse(read('package.json'))

// The first row under the Release timeline's header separator, so an "Unreleased" row placed on top fails too.
function firstReleaseRow(history) {
  const lines = history.split('\n')
  const timeline = lines.indexOf('## Release timeline')
  const separator = lines.findIndex((line, index) => index > timeline && line.startsWith('| ---'))
  return { found: timeline >= 0 && separator > timeline, row: lines[separator + 1] ?? '' }
}

// The dated runs of a version: every `<date>-v<version>-*.md` name, in sorted order so the answer never depends on
// the order the file system lists them. One is enough when it names the version and the newest row links it.
const datedRuns = (names, forVersion) =>
  names.filter((name) => /^\d{4}-\d{2}-\d{2}-/.test(name) && name.includes(`-v${forVersion}-`)).sort()
const linkedRun = (names, forVersion, readRun, row) =>
  datedRuns(names, forVersion).find((name) => readRun(name).includes(`- **Version:** ${forVersion}`) && row.includes(`verification/runs/${name}`))

test('package-lock.json carries the package version', () => {
  const lock = JSON.parse(read('package-lock.json'))
  assert.equal(lock.version, version)
  assert.equal(lock.packages[''].version, version)
})

test('the docs baseline and the newest release row name the package version', () => {
  assert.ok(read('docs/README.md').includes(`- Product version: \`${version}\``))
  const { found, row } = firstReleaseRow(read('docs/product-history.md'))
  assert.ok(found, 'Release timeline table found')
  assert.ok(row.startsWith(`| ${version} |`), `first release row: ${row.slice(0, 20)}`)
})

test('the version has a dated verification run that names it and that the newest release row links', () => {
  const runs = readdirSync(join(root, 'docs', 'verification', 'runs'))
  assert.ok(datedRuns(runs, version).length > 0, `a run named *-v${version}-*.md`)
  const { row } = firstReleaseRow(read('docs/product-history.md'))
  const run = linkedRun(runs, version, (name) => read(`docs/verification/runs/${name}`), row)
  assert.ok(run, `a *-v${version}-*.md run with "- **Version:** ${version}" that the newest release row links`)
})

test('a second dated run for the same version does not break the check, in any listing order', () => {
  const files = {
    '2026-11-04-v9.9.9-release.md': '- **Version:** 9.9.9',
    '2026-11-05-v9.9.9-artifacts.md': '- **Version:** 9.9.9',
    '2026-11-06-v9.9.9-notes.md': '- **Version:** 9.9.8',
  }
  const names = Object.keys(files)
  const read = (name) => files[name]
  const row = '| 9.9.9 | outcome | See `verification/runs/2026-11-04-v9.9.9-release.md` |'
  assert.equal(linkedRun(names, '9.9.9', read, row), '2026-11-04-v9.9.9-release.md')
  assert.equal(linkedRun([...names].reverse(), '9.9.9', read, row), '2026-11-04-v9.9.9-release.md')
  assert.equal(linkedRun(names, '9.9.9', read, '| 9.9.9 | outcome | See `verification/runs/2026-11-06-v9.9.9-notes.md` |'), undefined, 'a linked run that names another version')
  assert.equal(linkedRun(names, '9.9.9', read, '| 9.9.9 | outcome | no link |'), undefined, 'no linked run')
})
