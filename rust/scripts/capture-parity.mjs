// Capture the unchanged 0.9.0 Electron app beside the native Rust captures. Synthetic camera
// sources differ; this compares the real controls, geometry and native window behavior.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { preferencesFromDocument } from '../../src/settings.js'

const root = resolve(import.meta.dirname, '../..')
const out = resolve(process.argv[2] ?? '.scratch/parity')
const native = process.argv[3] && resolve(process.argv[3])
await mkdir(out, { recursive: true })
// The baseline must really be 0.9.0, rather than a copy edited to resemble the rewrite.
execFileSync('git', ['diff', '--exit-code', 'v0.9.0', '--', 'src/', 'package.json'], { cwd: root })
const binary = join(root, 'rust/target/release', process.platform === 'win32' ? 'compare-parity.exe' : 'compare-parity')
const scenarios = [
  ['bubble', {}, null], ['menu', {}, null],
  ['small-menu', { shape: 'portrait', size: 180 }, null],
  ['large-menu', { shape: 'landscape', size: 640 }, null],
  ['camera', {}, 'camera'], ['style', {}, 'appearance'],
  ['style-glow', { frameEffect: 'glow' }, 'appearance'],
  ['style-blur', { frameEffect: 'blur' }, 'appearance'],
  ['scenes', {}, 'presets'], ['scenes-list', { sceneView: 'list' }, 'presets'],
  ['fullscreen', {}, null],
]
const manifest = []
for (const [name, patch, tab] of scenarios) {
  const userData = join(out, `electron-${name}-settings`)
  await mkdir(userData, { recursive: true })
  await writeFile(join(userData, 'preferences.json'), JSON.stringify({
    ...preferencesFromDocument(null), ...patch, schemaVersion: 15,
    position: { x: 200, y: 150 }, completedOnboardingVersion: 1,
  }))
  const env = { ...process.env, CAMFRAME_E2E: '1', CAMFRAME_E2E_USER_DATA_DIR: userData }
  delete env.ELECTRON_RUN_AS_NODE
  let app
  try {
    app = await electron.launch({ executablePath: electronExecutable, cwd: root, args: ['.'], env, timeout: 30_000 })
    const page = await app.firstWindow()
    await page.locator('#overlay').waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.querySelector('#camera').readyState >= 2)
    await page.locator('#camera-surface').hover({ force: true })
    if (tab) {
      await page.locator('#controls-button').click({ force: true })
      await page.locator(`[data-settings-tab="${tab}"]`).click()
    }
    if (name === 'fullscreen') {
      await page.locator('#fullscreen-button').click({ force: true })
      await page.waitForFunction(() => document.querySelector('#overlay').dataset.fullscreen === 'true')
    }
    if (name === 'bubble' || name === 'fullscreen') await page.mouse.move(0, 0)
    await page.waitForTimeout(650)
    const base64 = await app.evaluate(async ({ BrowserWindow }) => {
      const overlay = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'CamFrame overlay')
      const image = await overlay.capturePage()
      return image.toPNG().toString('base64')
    })
    const baseline = join(out, `${name}-090.png`)
    await writeFile(baseline, Buffer.from(base64, 'base64'))
    const nativeName = name === 'bubble' ? 'circle.png' : name === 'menu' ? 'hover.png' : name === 'fullscreen' ? 'fullscreen.png' : `${name}-panel.png`
    if (native) {
      const comparison = join(out, `${name}-side-by-side.png`)
      execFileSync(binary, [baseline, join(native, nativeName), comparison, name === 'fullscreen' ? '0' : '40'], { stdio: 'inherit' })
      manifest.push({ name, baseline, native: join(native, nativeName), comparison, left: 'CamFrame 0.9.0 Electron', right: 'Rust GPUI' })
    }
  } finally {
    await app?.close()
  }
}
assert.equal(manifest.length, native ? scenarios.length : 0)
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`RESULT: ok parity ${scenarios.length} Electron 0.9.0 captures${native ? ' and native side-by-side comparisons' : ''} ${out}`)
