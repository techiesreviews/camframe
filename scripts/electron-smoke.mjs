import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer, request as httpRequest } from 'node:http'
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

function prompterCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: 47833,
        method,
        path,
        agent: false,
        headers: { Origin: 'https://prompter.techies.tools', 'Content-Type': 'application/json' },
      },
      (response) => {
        let text = ''
        response.on('data', (chunk) => {
          text += chunk
        })
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }))
      },
    )
    request.on('error', reject)
    if (body) request.write(JSON.stringify(body))
    request.end()
  })
}

// The smoke drives the real link port, so a CamFrame already running with the link on would get
// these cues (and move its Overlay). Stop before launching instead.
function portFree(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

test('real Electron: Prompter link cues switch Full screen, spots, and Scenes', async () => {
  assert.ok(
    await portFree(47833),
    'Port 47833 is busy (is CamFrame running with the Prompter link on?). Quit it and run the smoke again.',
  )
  await mkdir(artifactDirectory, { recursive: true })
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'camframe-electron-smoke-'))
  await writeFile(
    join(userDataDirectory, 'preferences.json'),
    JSON.stringify({
      schemaVersion: 13,
      completedOnboardingVersion: 1,
      prompterLink: true,
      prompterMargin: 40,
      position: { x: 200, y: 200 },
      presets: [
        { id: 'preset-demo', name: 'Demo', settings: { size: 240, shape: 'rounded', position: { x: 120, y: 140 } } },
      ],
    }),
  )
  let application

  try {
    application = await launchCamFrame(userDataDirectory)
    const page = await application.firstWindow()
    await page.locator('#overlay').waitFor({ state: 'visible' })
    await page.waitForFunction(() => window.camFrame && true)

    const status = await prompterCall('GET', '/camframe/status')
    assert.equal(status.status, 200)
    assert.deepEqual(status.body.scenes, ['Demo'])

    const display = await application.evaluate(({ BrowserWindow, screen }) => {
      const overlay = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'CamFrame overlay')
      return screen.getDisplayMatching(overlay.getBounds())
    })

    assert.equal((await prompterCall('POST', '/camframe/cue', { size: 'full' })).status, 200)
    await page.waitForFunction(() => document.querySelector('#overlay')?.dataset.fullscreen === 'true')
    await page.waitForTimeout(400)
    assert.deepEqual(await overlayBounds(application), display.bounds)

    assert.equal((await prompterCall('POST', '/camframe/cue', { size: 'small', position: 'bottom-right' })).status, 200)
    await page.waitForFunction(() => document.querySelector('#overlay')?.dataset.fullscreen === 'false')
    await page.waitForTimeout(400)
    const corner = await overlayBounds(application)
    const workArea = display.workArea
    assert.equal(corner.x + corner.width - 18, workArea.x + workArea.width - 40)
    assert.equal(corner.y + corner.height - 18, workArea.y + workArea.height - 40)
    await captureOverlay(application, '04-prompter-bottom-right.png')

    const scene = await prompterCall('POST', '/camframe/cue', { scene: 'demo' })
    assert.equal(scene.status, 200)
    await page.waitForTimeout(400)
    const sceneBounds = await overlayBounds(application)
    assert.deepEqual({ x: sceneBounds.x, y: sceneBounds.y, width: sceneBounds.width }, { x: 120, y: 140, width: 240 + 36 })
    assert.equal((await page.evaluate(() => window.camFrame.getState())).activePresetId, 'preset-demo')

    // A placed cue saves the new position in Preferences and clears the active Scene.
    assert.equal((await prompterCall('POST', '/camframe/cue', { size: 'small', position: 'top-left' })).status, 200)
    await page.waitForTimeout(400)
    const topLeft = await overlayBounds(application)
    const placedState = await page.evaluate(() => window.camFrame.getState())
    assert.equal(placedState.activePresetId, '')
    assert.deepEqual(placedState.position, { x: topLeft.x, y: topLeft.y })
    const saved = JSON.parse(await readFile(join(userDataDirectory, 'preferences.json'), 'utf8'))
    assert.deepEqual(saved.position, { x: topLeft.x, y: topLeft.y })

    const missing = await prompterCall('POST', '/camframe/cue', { scene: 'Outro' })
    assert.equal(missing.status, 404)

    await page.evaluate(() => window.camFrame.updateState({ prompterLink: false }))
    await page.waitForTimeout(200)
    await assert.rejects(prompterCall('GET', '/camframe/status'), /ECONNREFUSED/)
  } finally {
    await application?.close().catch(() => {})
    const expectedPrefix = `${resolve(tmpdir())}${sep}camframe-electron-smoke-`
    if (resolve(userDataDirectory).startsWith(expectedPrefix)) {
      await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
    }
  }
})
