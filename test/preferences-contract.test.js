import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { preferencesFromDocument, sanitizeSettings } from '../src/settings.js'

function fixture(name) {
  return JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'preferences', name), 'utf8'))
}

function documentTextFor(entry) {
  if (Object.hasOwn(entry, 'documentText')) return entry.documentText
  if (Object.hasOwn(entry, 'document')) return JSON.stringify(entry.document)
  return undefined
}

for (const entry of fixture('sanitize.json').cases) {
  test(`Preferences sanitize contract: ${entry.name}`, () => {
    assert.deepEqual(sanitizeSettings(structuredClone(entry.input)), entry.expected)
  })
}

for (const entry of fixture('load.json').cases) {
  test(`Preferences load contract: ${entry.name}`, () => {
    assert.deepEqual(preferencesFromDocument(documentTextFor(entry)), entry.expected)
  })
}
