import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const projectRoot = resolve(import.meta.dirname, '..')
const electronExecutable = require('electron')
const artifactDirectory = join(projectRoot, 'qa', 'electron-smoke')

async function launchCamFrame(userDataDirectory) {
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  environment.CAMFRAME_E2E = '1'
  environment.CAMFRAME_E2E_USER_DATA_DIR = userDataDirectory

  return electron.launch({
    executablePath: electronExecutable,
    args: ['.'],
    cwd: projectRoot,
    env: environment,
    timeout: 30_000,
  })
}

async function overlayBounds(application) {
  return application.evaluate(({ BrowserWindow }) => {
    const overlay = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'CamFrame overlay')
    return overlay?.getBounds()
  })
}

async function captureOverlay(application, filename) {
  const png = await application.evaluate(async ({ BrowserWindow }) => {
    const overlay = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'CamFrame overlay')
    const image = await overlay?.capturePage()
    return image?.toPNG().toString('base64')
  })
  assert.ok(png, `Electron should capture ${filename}`)
  await writeFile(join(artifactDirectory, filename), Buffer.from(png, 'base64'))
}

test('real Electron exercises the Overlay, IPC, camera profile, and accessibility state', async () => {
  await mkdir(artifactDirectory, { recursive: true })
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'camframe-electron-smoke-'))
  const errors = []
  let application

  try {
    application = await launchCamFrame(userDataDirectory)
    const page = await application.firstWindow()
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`)
    })

    await page.locator('#overlay').waitFor({ state: 'visible' })
    await page.locator('#onboarding-panel').waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.querySelector('#inline-settings')?.dataset.activePanel === 'camera')

    assert.equal(await page.locator('#overlay-resolution-select').count(), 1)
    assert.equal(await page.locator('#fullscreen-resolution-select').count(), 0)
    assert.equal(await page.locator('#onboarding-title').textContent(), 'Choose your camera')
    await captureOverlay(application, '01-onboarding-camera.png')

    await page.locator('#onboarding-skip').click()
    await page.locator('#onboarding-panel').waitFor({ state: 'hidden' })
    await page.locator('#controls-button').click({ force: true })
    await page.locator('#inline-settings').waitFor({ state: 'visible' })
    await page.locator('#overlay-resolution-select').selectOption('1080p')
    await page.waitForTimeout(100)
    await captureOverlay(application, '02-camera-settings.png')

    const beforeProfile = await page.evaluate(() => {
      const track = document.querySelector('#camera')?.srcObject?.getVideoTracks()[0]
      return track?.getSettings() ?? null
    })
    assert.ok(beforeProfile, 'synthetic camera track should be active')

    await page.locator('#fullscreen-button').click({ force: true })
    await page.waitForFunction(() => document.querySelector('#overlay')?.dataset.fullscreen === 'true')
    await page.waitForTimeout(350)
    const fullscreenBounds = await overlayBounds(application)
    const afterProfile = await page.evaluate(() => {
      const track = document.querySelector('#camera')?.srcObject?.getVideoTracks()[0]
      return track?.getSettings() ?? null
    })
    assert.equal(afterProfile?.deviceId, beforeProfile.deviceId)
    assert.equal(afterProfile?.width, beforeProfile.width)
    assert.equal(afterProfile?.height, beforeProfile.height)
    assert.ok(fullscreenBounds?.width > 640)

    await page.evaluate(() => window.camFrame.exitFullscreen())
    await page.waitForFunction(() => document.querySelector('#overlay')?.dataset.fullscreen === 'false')
    await page.waitForTimeout(350)
    const compactBounds = await overlayBounds(application)
    assert.ok(compactBounds?.width <= 676)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => document.querySelector('#overlay')?.dataset.reducedMotion === 'true')
    await page.evaluate(() => window.camFrame.toggleFullscreen())
    await page.waitForFunction(() => document.querySelector('#overlay')?.dataset.fullscreen === 'true')
    const reducedMotionBounds = await overlayBounds(application)
    assert.deepEqual(reducedMotionBounds, fullscreenBounds)

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-reduced-motion', value: 'reduce' },
        { name: 'forced-colors', value: 'active' },
      ],
    })
    await page.waitForFunction(() => document.querySelector('#overlay')?.dataset.highContrast === 'true')
    await captureOverlay(application, '03-fullscreen-high-contrast.png')

    const persistedState = await page.evaluate(() => window.camFrame.getState())
    assert.equal(persistedState.completedOnboardingVersion, 1)
    assert.equal(persistedState.overlayResolution, '1080p')
    assert.deepEqual(errors, [])
  } finally {
    await application?.close().catch(() => {})
    const expectedPrefix = `${resolve(tmpdir())}${sep}camframe-electron-smoke-`
    if (resolve(userDataDirectory).startsWith(expectedPrefix)) {
      await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
    }
  }
})
