import * as nodeFs from 'node:fs'

// Where Preferences live on disk: `preferences.json`, written in one step, plus the last good copy.
//
// A save writes a temporary file, flushes it to disk, then renames it over `preferences.json`, so a
// crash or power cut leaves either the old file or the new one, never a cut-off one. Before each
// save the current file, when it is complete, becomes `preferences.last-good.json`. A broken
// `preferences.json` then loads that copy quietly instead of starting from defaults (bug B4).
// A missing `preferences.json` still means "no saved Preferences", so deleting or renaming it on
// purpose starts fresh even when a last good copy is left.
export function createPreferencesStore(path, fs = nodeFs) {
  const lastGoodPath = `${path.replace(/\.json$/, '')}.last-good.json`

  function load(file) {
    try {
      return { text: fs.readFileSync(file, 'utf8') }
    } catch (error) {
      return { missing: error?.code === 'ENOENT' }
    }
  }

  function replace(file, text) {
    const temporary = `${file}.tmp`
    const descriptor = fs.openSync(temporary, 'w')
    try {
      // writeFileSync on a descriptor keeps writing until every byte is down; one writeSync may not.
      fs.writeFileSync(descriptor, text, 'utf8')
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
    try {
      fs.renameSync(temporary, file)
    } catch (error) {
      // Windows refuses the rename while another program (an antivirus or the search indexer) holds
      // the file open. The last good copy is already on disk, so write in place rather than lose
      // the save.
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code)) throw error
      fs.writeFileSync(file, text, 'utf8')
      fs.rmSync(temporary, { force: true })
    }
  }

  return {
    // The text to load: `preferences.json` when it is complete, else the last good copy when that
    // is, else whatever `preferences.json` held (`preferencesFromDocument` falls back to defaults).
    // Undefined when there is no `preferences.json`.
    read() {
      const current = load(path)
      if (current.missing) return undefined
      if (isDocument(current.text)) return current.text
      const lastGood = load(lastGoodPath)
      return isDocument(lastGood.text) ? lastGood.text : current.text
    },
    write(text) {
      const current = load(path)
      if (isDocument(current.text) && current.text !== text) {
        try {
          replace(lastGoodPath, current.text)
        } catch {
          // The copy is a spare: failing to refresh it must not cost the save itself.
        }
      }
      replace(path, text)
    },
  }
}

// A complete Preferences document: JSON that parses to an object.
function isDocument(text) {
  if (typeof text !== 'string') return false
  try {
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  } catch {
    return false
  }
}
