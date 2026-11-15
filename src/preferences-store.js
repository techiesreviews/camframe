import * as nodeFs from 'node:fs'
import { dirname } from 'node:path'

// Numbers each temporary file, so two saves never share one (see `replace`).
let sequence = 0

// Where Preferences live on disk: `preferences.json`, written in one step, plus the last good copy.
//
// A save writes a temporary file, flushes it to disk, then renames it over `preferences.json`, so a
// crash or power cut leaves either the old file or the new one, never a cut-off one. Before each
// save the current file, when it is complete, becomes `preferences.last-good.json`. A broken
// `preferences.json` then loads that copy quietly instead of starting from defaults (bug B4).
// A missing `preferences.json` still means "no saved Preferences", so deleting or renaming it on
// purpose starts fresh even when a last good copy is left.
export function createPreferencesStore(path, fs = nodeFs, platform = process.platform) {
  const lastGoodPath = `${path.replace(/\.json$/, '')}.last-good.json`

  function load(file) {
    try {
      return { text: fs.readFileSync(file, 'utf8') }
    } catch (error) {
      return { missing: error?.code === 'ENOENT' }
    }
  }

  // `inPlaceWhenBlocked`: when Windows blocks the rename, write straight onto `file` instead. Only
  // for `preferences.json`, whose save must not be lost; the last good copy is never written in
  // place, because a cut-off write would destroy the one complete copy left.
  function replace(file, text, { inPlaceWhenBlocked = false } = {}) {
    // CamFrame can run twice (it has no single-instance lock), so each save gets its own temporary
    // file, named by process and save; a shared name would let one copy rename the other's half.
    sequence += 1
    const temporary = `${file}.${process.pid}-${sequence}.tmp`
    let renamed = false
    try {
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
        renamed = true
      } catch (error) {
        // Windows refuses the rename while another program (an antivirus or the search indexer)
        // holds the file open. The last good copy is on disk by now (unless refreshing it just
        // failed), so write in place rather than lose the save.
        const blocked = platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(error?.code)
        if (!inPlaceWhenBlocked || !blocked) throw error
        fs.writeFileSync(file, text, 'utf8')
      }
    } finally {
      // A failed save tidies up its own temporary file when it can. The program that blocked the
      // rename may hold this file too; a leftover is harmless (nothing reads it), so a refused
      // removal never hides the save's own result.
      if (!renamed) {
        try {
          fs.rmSync(temporary, { force: true })
        } catch {
          // Left for a later tidy-up.
        }
      }
    }
    if (renamed) flushFolder(file)
  }

  // On Linux a rename reaches the disk only when its folder is flushed too; until then a power cut
  // can bring back an earlier file. macOS takes the same flush but only into the drive's cache (a
  // full flush needs F_FULLFSYNC, which Node lacks). Windows cannot open a folder for this, and NTFS
  // journals the rename itself. Best effort: the save is already complete in the file system.
  function flushFolder(file) {
    if (platform === 'win32') return
    let descriptor
    try {
      descriptor = fs.openSync(dirname(file), 'r')
      fs.fsyncSync(descriptor)
    } catch {
      // Some file systems refuse to flush a folder; the rename stands either way.
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor)
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
      replace(path, text, { inPlaceWhenBlocked: true })
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
