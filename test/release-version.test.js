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
  const next = lines.findIndex((line, index) => index > timeline && line.startsWith('## '))
  const end = next < 0 ? lines.length : next
  const separator = lines.findIndex((line, index) => index > timeline && index < end && line.startsWith('| ---'))
  return { found: timeline >= 0 && separator > timeline, row: lines[separator + 1] ?? '' }
}

// The Product version line must sit under "## Baseline represented here", not anywhere in the README.
function baselineNamesVersion(readme, forVersion) {
  const lines = readme.split('\n')
  const start = lines.indexOf('## Baseline represented here')
  if (start < 0) return false
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return lines.slice(start + 1, end < 0 ? undefined : end).includes(`- Product version: \`${forVersion}\``)
}

// The dated runs of a version: every `<date>-v<version>-*.md` name, in sorted order so the answer never depends on
// the order the file system lists them. One is enough when its `- **Version:**` line is exactly the version (not
// 0.6.10 or 0.6.1-rc.1 for 0.6.1) and the newest row links it.
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const namesVersion = (text, forVersion) => new RegExp(`^- \\*\\*Version:\\*\\* ${escapeRegExp(forVersion)}\\s*$`, 'm').test(text)
const datedRuns = (names, forVersion) =>
  names.filter((name) => /^\d{4}-\d{2}-\d{2}-/.test(name) && name.includes(`-v${forVersion}-`)).sort()
// The tag hold. A tag build must be for exactly v<version>, and the newest linked run in force (not "> Superseded ...")
// that has a Decision line must say exactly `- **Decision:** Go` (not No-go, not "Go pending ..."); on the same date a
// No-go beats a Go. Non-tag builds skip it.
const decisionLine = /^- \*\*Decision:\*\* (.*?)\s*$/m
const tagHold = (ref, forVersion, names, readRun, row) => {
  if (!ref.startsWith('refs/tags/')) return 'skip'
  if (ref !== `refs/tags/v${forVersion}`) return `tag ${ref} is not v${forVersion}`
  const decisions = datedRuns(names, forVersion)
    .filter((name) => row.includes(`verification/runs/${name}`) && namesVersion(readRun(name), forVersion) && !/^> Superseded/m.test(readRun(name)))
    .map((name) => [name, readRun(name).match(decisionLine)?.[1] ?? 'no Decision line'])
  // The newest date counts; on the same date a decision that is not Go beats a Go (filename order never decides).
  const day = decisions.map(([name]) => name.slice(0, 10)).sort().at(-1)
  const today = decisions.filter(([name]) => name.slice(0, 10) === day)
  const blocking = today.find(([, decision]) => decision !== 'Go')
  return !blocking && today.length > 0 ? 'ok' : `the newest linked run's decision is ${blocking ? `"${blocking[1]}" (${blocking[0]})` : 'missing'}, not Go`
}
const linkedRun = (names, forVersion, readRun, row) =>
  datedRuns(names, forVersion).find((name) => namesVersion(readRun(name), forVersion) && row.includes(`verification/runs/${name}`))

test('package-lock.json carries the package version', () => {
  const lock = JSON.parse(read('package-lock.json'))
  assert.equal(lock.version, version)
  assert.equal(lock.packages[''].version, version)
})

test('the docs baseline and the newest release row name the package version', () => {
  assert.ok(baselineNamesVersion(read('docs/README.md'), version), `Product version ${version} under "Baseline represented here"`)
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
    '2026-11-07-v9.9.9-x.md': '- **Version:** 9.9.90',
    '2026-11-08-v9.9.9-rc.md': '- **Version:** 9.9.9-rc.1',
    'v9.9.9-release.md': '- **Version:** 9.9.9',
    '2026-11-09-v9.9.90-release.md': '- **Version:** 9.9.9',
  }
  const names = Object.keys(files)
  const readFixture = (name) => files[name]
  const link = (...runs) => `| 9.9.9 | outcome | See ${runs.map((run) => `\`verification/runs/${run}\``).join(' and ')} |`
  const both = link('2026-11-05-v9.9.9-artifacts.md', '2026-11-04-v9.9.9-release.md')
  // Both runs linked: the sorted-first one wins, whatever order the files are listed in.
  assert.equal(linkedRun(names, '9.9.9', readFixture, both), '2026-11-04-v9.9.9-release.md')
  assert.equal(linkedRun([...names].reverse(), '9.9.9', readFixture, both), '2026-11-04-v9.9.9-release.md')
  assert.equal(linkedRun(names, '9.9.9', readFixture, link('2026-11-05-v9.9.9-artifacts.md')), '2026-11-05-v9.9.9-artifacts.md', 'only the second run linked')
  assert.equal(linkedRun(names, '9.9.9', readFixture, link('2026-11-06-v9.9.9-notes.md')), undefined, 'a linked run that names another version')
  assert.equal(linkedRun(names, '9.9.9', readFixture, link('2026-11-07-v9.9.9-x.md')), undefined, 'a linked run that names 9.9.90')
  assert.equal(linkedRun(names, '9.9.9', readFixture, link('2026-11-08-v9.9.9-rc.md')), undefined, 'a linked run that names 9.9.9-rc.1')
  assert.equal(linkedRun(names, '9.9.9', readFixture, link('v9.9.9-release.md')), undefined, 'an undated run name')
  assert.equal(linkedRun(names, '9.9.9', readFixture, link('2026-11-09-v9.9.90-release.md')), undefined, 'a run name for v9.9.90')
  assert.equal(linkedRun(names, '9.9.9', readFixture, '| 9.9.9 | outcome | no link |'), undefined, 'no linked run')
})

test('the first release row is read from the Release timeline only', () => {
  const table = (rows) => ['# History', '', '## Release timeline', '', '| Version | Outcome |', '| --- | --- |', ...rows, ''].join('\n')
  assert.deepEqual(firstReleaseRow(table(['| 9.9.9 | a |', '| 9.9.8 | b |'])), { found: true, row: '| 9.9.9 | a |' })
  assert.equal(firstReleaseRow(table(['| Unreleased | a |', '| 9.9.9 | b |'])).row, '| Unreleased | a |', 'an Unreleased row on top is the first row')
  assert.equal(firstReleaseRow('# History\n\n| --- | --- |\n| 9.9.9 | a |').found, false, 'no Release timeline heading')
  assert.equal(firstReleaseRow('# History\n\n## Release timeline\n\nNo table yet.').found, false, 'no header separator after the heading')
  assert.equal(firstReleaseRow('## Release timeline\n\nNo table yet.\n\n## Other\n\n| --- | --- |\n| 9.9.9 | a |').found, false, 'a table in the next section is not the timeline')
  assert.deepEqual(firstReleaseRow('## Release timeline\n\n| --- | --- |\n| 9.9.9 | a |\n\n## Other\n\n| --- | --- |\n| 1.0.0 | b |'), { found: true, row: '| 9.9.9 | a |' }, 'the timeline table wins over a later section\'s table')
  assert.equal(firstReleaseRow('## Release timeline\n| --- | --- |').row, '', 'separator on the last line gives an empty row, not a crash')
})

test('the Product version is read from the Baseline section only', () => {
  const readme = (...sections) => sections.join('\n')
  const baseline = (line) => `## Baseline represented here\n\n${line}\n- Git baseline inspected: x\n`
  const other = '## Other section\n\n- Product version: `9.9.9`\n'
  assert.equal(baselineNamesVersion(readme(baseline('- Product version: `9.9.9`'), other), '9.9.9'), true)
  assert.equal(baselineNamesVersion(readme(other, baseline('- Product version: `9.9.8`')), '9.9.9'), false, 'only another section names it')
  assert.equal(baselineNamesVersion(readme(baseline('- Product version: `9.9.9`'), other), '9.9.90'), false, 'a longer version is not the version')
  assert.equal(baselineNamesVersion(readme(other), '9.9.9'), false, 'no Baseline section')
  assert.equal(baselineNamesVersion(readme(other, baseline('- Product version: `9.9.9`')), '9.9.9'), true, 'Baseline last in the file')
})

test('a version tag build is for v<version> and the newest linked run says Go', (t) => {
  const runs = readdirSync(join(root, 'docs', 'verification', 'runs'))
  const { row } = firstReleaseRow(read('docs/product-history.md'))
  const result = tagHold(process.env.GITHUB_REF ?? '', version, runs, (name) => read(`docs/verification/runs/${name}`), row)
  if (result === 'skip') return t.skip('not a tag build')
  assert.equal(result, 'ok')
})

test('the tag hold passes only for the newest linked run in force saying exactly Go on exactly v<version>', () => {
  const files = {
    '2026-11-03-v9.9.9-go-old.md': '- **Version:** 9.9.9\n- **Decision:** Go',
    '2026-11-04-v9.9.9-nogo.md': '- **Version:** 9.9.9\n- **Decision:** No-go',
    '2026-11-05-v9.9.9-pending.md': '- **Version:** 9.9.9\n- **Decision:** Go pending the release workflow run',
    '2026-11-06-v9.9.9-go.md': '- **Version:** 9.9.9\n- **Decision:** Go',
    '2026-11-07-v9.9.9-other.md': '- **Version:** 9.9.8\n- **Decision:** Go',
    '2026-11-08-v9.9.9-old.md': '> Superseded by another run.\n- **Version:** 9.9.9\n- **Decision:** No-go',
    '2026-11-09-v9.9.9-release.md': '- **Version:** 9.9.9\n- **Decision:** Go',
    '2026-11-09-v9.9.9-no-go.md': '- **Version:** 9.9.9\n- **Decision:** No-go',
    '2026-11-11-v9.9.9-bad.md': '- **Version:** 9.9.9\n**Decision:** No-go',
    '2026-11-12-v9.9.9-docs.md': '- **Version:** 9.9.9\n- **Decision:** Documentation baseline only',
    '2026-11-12-v9.9.9-go.md': '- **Version:** 9.9.9\n- **Decision:** Go',
    '2026-11-10-v9.9.9-go-void.md': '> Superseded by another run.\n- **Version:** 9.9.9\n- **Decision:** Go',
  }
  const names = Object.keys(files)
  const readFixture = (name) => files[name]
  const link = (...runs) => `| 9.9.9 | outcome | See ${runs.map((run) => `\`verification/runs/${run}\``).join(' and ')} |`
  const hold = (ref, ...runs) => tagHold(ref, '9.9.9', names, readFixture, link(...runs))
  const tag = 'refs/tags/v9.9.9'
  assert.equal(hold(tag, '2026-11-04-v9.9.9-nogo.md'), "the newest linked run's decision is \"No-go\" (2026-11-04-v9.9.9-nogo.md), not Go", 'a No-go run only')
  assert.match(hold(tag, '2026-11-05-v9.9.9-pending.md'), /Go pending/, 'a "Go pending" run only')
  assert.equal(hold(tag, '2026-11-04-v9.9.9-nogo.md', '2026-11-06-v9.9.9-go.md'), 'ok', 'a No-go run beside a newer Go run')
  assert.match(hold(tag, '2026-11-03-v9.9.9-go-old.md', '2026-11-04-v9.9.9-nogo.md'), /No-go/, 'an older Go run replaced by a newer No-go run')
  assert.match(hold(tag, '2026-11-07-v9.9.9-other.md'), /missing/, 'a Go run that names another version')
  assert.equal(hold(tag, '2026-11-06-v9.9.9-go.md', '2026-11-08-v9.9.9-old.md'), 'ok', 'a superseded run does not count')
  assert.match(hold(tag, '2026-11-09-v9.9.9-release.md', '2026-11-09-v9.9.9-no-go.md'), /No-go/, 'same date: a No-go beats a Go, whatever the filenames')
  assert.match(hold(tag, '2026-11-09-v9.9.9-no-go.md', '2026-11-09-v9.9.9-release.md'), /No-go/, 'same date, the other link order')
  assert.equal(hold(tag, '2026-11-06-v9.9.9-go.md', '2026-11-10-v9.9.9-go-void.md'), 'ok', 'a superseded Go is ignored, not counted as newer')
  assert.match(hold(tag, '2026-11-04-v9.9.9-nogo.md', '2026-11-10-v9.9.9-go-void.md'), /No-go/, 'a superseded Go does not release a No-go')
  assert.match(hold(tag, '2026-11-06-v9.9.9-go.md', '2026-11-11-v9.9.9-bad.md'), /no Decision line/, 'a newer run with a badly written Decision line blocks an older Go')
  assert.match(hold(tag, '2026-11-12-v9.9.9-docs.md', '2026-11-12-v9.9.9-go.md'), /Documentation baseline only/, 'same date: Documentation baseline only beats a Go')
  assert.match(hold(tag), /missing/, 'a Go run the row does not link')
  assert.match(hold('refs/tags/v9.9.90', '2026-11-06-v9.9.9-go.md'), /not v9\.9\.9/, 'a longer tag')
  assert.match(hold('refs/tags/v9.9.9-rc.1', '2026-11-06-v9.9.9-go.md'), /not v9\.9\.9/, 'a release candidate tag')
  assert.equal(hold('refs/heads/main', '2026-11-04-v9.9.9-nogo.md'), 'skip', 'a branch build')
})
