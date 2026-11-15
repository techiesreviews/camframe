import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ADR 0027 pins the release toolchain exactly. The versions are kept by hand in three places; this check fails when
// one of them drifts.

const root = join(import.meta.dirname, '..')
const read = (file) => readFileSync(join(root, file), 'utf8')
const TOOLS = ['electron', 'electron-builder', 'playwright-core', 'vite']
const LABELS = { electron: 'Electron', 'electron-builder': 'Electron Builder', 'playwright-core': 'Playwright Core', vite: 'Vite' }

test('every release tool is pinned to one exact version in package.json, package-lock.json and the rebuild guide', () => {
  const { devDependencies } = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))
  const guide = read('docs/rebuild-guide.md')
    .split(/\r?\n/)
    .find((line) => line.startsWith('- Exactly pinned top-level tools:'))
  assert.ok(guide, 'docs/rebuild-guide.md names the pinned tools')

  for (const name of TOOLS) {
    const pinned = devDependencies[name]
    assert.match(pinned ?? '', /^\d+\.\d+\.\d+$/, `${name} is an exact version, not a range or a tag`)
    assert.equal(lock.packages[''].devDependencies[name], pinned, `package-lock.json asks for ${name} ${pinned}`)
    assert.equal(lock.packages[`node_modules/${name}`]?.version, pinned, `package-lock.json installs ${name} ${pinned}`)
    assert.ok(guide.includes(`${LABELS[name]} \`${pinned}\``), `the rebuild guide names ${LABELS[name]} ${pinned}`)
  }
})
