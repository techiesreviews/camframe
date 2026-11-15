import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPreferencesStore } from '../src/preferences-store.js'
import { preferencesFromDocument } from '../src/settings.js'

function folder() {
  return mkdtempSync(join(tmpdir(), 'camframe-preferences-'))
}

function document(sceneName) {
  return JSON.stringify(
    {
      schemaVersion: 15,
      completedOnboardingVersion: 1,
      presets: [{ id: 'preset-mine', name: sceneName, settings: { shape: 'circle' } }],
    },
    null,
    2,
  )
}

test('a broken preferences.json loads the last good copy quietly, so saved Scenes survive', () => {
  const directory = folder()
  const path = join(directory, 'preferences.json')
  const store = createPreferencesStore(path)
  store.write(document('Interview'))
  store.write(document('Interview, moved'))
  // A crash or power cut in the middle of an old in-place write leaves a cut-off file.
  writeFileSync(path, document('Interview, moved').slice(0, 40), 'utf8')

  const loaded = preferencesFromDocument(store.read())
  assert.deepEqual(
    loaded.presets.map((scene) => scene.name),
    ['Interview'],
  )
})

test('a save replaces preferences.json in one step and never writes onto it directly', () => {
  const directory = folder()
  const path = join(directory, 'preferences.json')
  const writes = []
  const recording = {
    ...fs,
    openSync: (file, ...rest) => {
      writes.push(file)
      return fs.openSync(file, ...rest)
    },
    writeFileSync: (file, ...rest) => {
      writes.push(file)
      return fs.writeFileSync(file, ...rest)
    },
  }
  const store = createPreferencesStore(path, recording)
  store.write(document('One'))
  store.write(document('Two'))

  assert.equal(writes.includes(path), false, 'preferences.json itself is only ever renamed into place')
  assert.equal(readFileSync(path, 'utf8'), document('Two'))
  assert.deepEqual(readdirSync(directory).sort(), ['preferences.json', 'preferences.last-good.json'])
})

// An fs that fails when it writes the temporary file for `target`: half the text lands, then it throws.
function failingWriteTo(target) {
  let watched
  return {
    ...fs,
    openSync: (file, ...rest) => {
      const descriptor = fs.openSync(file, ...rest)
      if (file === `${target}.tmp`) watched = descriptor
      return descriptor
    },
    // A closed descriptor's number is handed out again, so stop watching it.
    closeSync: (descriptor) => {
      if (descriptor === watched) watched = undefined
      return fs.closeSync(descriptor)
    },
    writeFileSync: (where, text, ...rest) => {
      if (where !== watched) return fs.writeFileSync(where, text, ...rest)
      fs.writeSync(where, String(text).slice(0, 20))
      throw new Error('power cut')
    },
  }
}

test('a crash while writing preferences.json leaves the previous file whole', () => {
  const directory = folder()
  const path = join(directory, 'preferences.json')
  const lastGood = join(directory, 'preferences.last-good.json')
  createPreferencesStore(path).write(document('Before'))

  assert.throws(() => createPreferencesStore(path, failingWriteTo(path)).write(document('After')), /power cut/)
  assert.equal(readFileSync(path, 'utf8'), document('Before'))
  assert.equal(readFileSync(lastGood, 'utf8'), document('Before'))
  assert.equal(createPreferencesStore(path).read(), document('Before'))
})

test('a failure while refreshing the last good copy still saves preferences.json', () => {
  const directory = folder()
  const path = join(directory, 'preferences.json')
  const lastGood = join(directory, 'preferences.last-good.json')
  const store = createPreferencesStore(path)
  store.write(document('One'))
  store.write(document('Two'))

  createPreferencesStore(path, failingWriteTo(lastGood)).write(document('Three'))
  assert.equal(readFileSync(path, 'utf8'), document('Three'))
  assert.equal(readFileSync(lastGood, 'utf8'), document('One'), 'the old copy stays whole')
})

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test(`when another program blocks the rename (${code}), the save writes in place rather than being lost`, () => {
    const directory = folder()
    const path = join(directory, 'preferences.json')
    const lastGood = join(directory, 'preferences.last-good.json')
    createPreferencesStore(path).write(document('Before'))
    const blocked = {
      ...fs,
      renameSync: (from, to) => {
        if (to === path) throw Object.assign(new Error('blocked'), { code })
        return fs.renameSync(from, to)
      },
    }

    createPreferencesStore(path, blocked).write(document('After'))
    assert.equal(readFileSync(path, 'utf8'), document('After'))
    assert.equal(readFileSync(lastGood, 'utf8'), document('Before'))
    assert.equal(existsSync(`${path}.tmp`), false)
  })
}

test('any other rename failure is not hidden', () => {
  const directory = folder()
  const path = join(directory, 'preferences.json')
  createPreferencesStore(path).write(document('Before'))
  const full = {
    ...fs,
    renameSync: (from, to) => {
      if (to === path) throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
      return fs.renameSync(from, to)
    },
  }

  assert.throws(() => createPreferencesStore(path, full).write(document('After')), /no space/)
  assert.equal(readFileSync(path, 'utf8'), document('Before'))
})

test('an unreadable preferences.json loads the last good copy, and with no copy starts from defaults', () => {
  const directory = folder()
  const path = join(directory, 'preferences.json')
  const store = createPreferencesStore(path)
  store.write(document('Kept'))
  const locked = {
    ...fs,
    readFileSync: (file, ...rest) => {
      if (file === path) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      return fs.readFileSync(file, ...rest)
    },
  }
  assert.equal(createPreferencesStore(path, locked).read(), undefined, 'no last good copy yet')

  store.write(document('Newer'))
  assert.equal(createPreferencesStore(path, locked).read(), document('Kept'))

  // Saving while preferences.json is unreadable leaves the last good copy alone.
  createPreferencesStore(path, locked).write(document('Third'))
  assert.equal(readFileSync(join(directory, 'preferences.last-good.json'), 'utf8'), document('Kept'))
  assert.equal(readFileSync(path, 'utf8'), document('Third'))
})

test('each save keeps the previous complete file as the last good copy', () => {
  const directory = folder()
  const path = join(directory, 'preferences.json')
  const lastGood = join(directory, 'preferences.last-good.json')
  const store = createPreferencesStore(path)
  store.write(document('First'))
  assert.equal(existsSync(lastGood), false, 'the very first save has no earlier file to keep')
  store.write(document('Second'))
  assert.equal(readFileSync(lastGood, 'utf8'), document('First'))
})

test('a broken file never replaces the last good copy', () => {
  const directory = folder()
  const path = join(directory, 'preferences.json')
  const lastGood = join(directory, 'preferences.last-good.json')
  const store = createPreferencesStore(path)
  store.write(document('Good'))
  store.write(document('Newer'))
  writeFileSync(path, '{"schemaVersion": 15, "pres', 'utf8')

  store.write(document('Fresh start'))
  assert.equal(readFileSync(lastGood, 'utf8'), document('Good'))
  assert.equal(store.read(), document('Fresh start'))
})

test('no file means no saved Preferences, even when a last good copy is left', () => {
  const directory = folder()
  const path = join(directory, 'preferences.json')
  const store = createPreferencesStore(path)
  assert.equal(store.read(), undefined)
  store.write(document('Old'))
  store.write(document('Older'))
  // Deleting or renaming preferences.json on purpose starts fresh, as before.
  fs.rmSync(path)
  assert.equal(store.read(), undefined)
})

test('a broken file with no last good copy still starts from defaults, as before', () => {
  const directory = folder()
  const path = join(directory, 'preferences.json')
  writeFileSync(path, '{"schemaVer', 'utf8')
  const text = createPreferencesStore(path).read()
  assert.equal(text, '{"schemaVer')
  assert.deepEqual(preferencesFromDocument(text).presets, preferencesFromDocument(undefined).presets)
})
