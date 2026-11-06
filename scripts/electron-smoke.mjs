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

    // The toolbar button and the Inline settings switch flip the same stored setting through main.
    const linkControls = () =>
      page.evaluate(() => ({
        pressed: document.querySelector('#prompter-button').getAttribute('aria-pressed'),
        linkState: document.querySelector('#prompter-button').dataset.linkState,
        switchOn: document.querySelector('#overlay-prompter-toggle').checked,
      }))
    await page.evaluate(() => document.querySelector('#prompter-button').click())
    await page.waitForFunction(() => document.querySelector('#prompter-button').dataset.linkState === 'off')
    assert.deepEqual(await linkControls(), { pressed: 'false', linkState: 'off', switchOn: false })
    assert.equal((await page.evaluate(() => window.camFrame.getState())).prompterLink, false)
    await assert.rejects(prompterCall('GET', '/camframe/status'), /ECONNREFUSED/)

    await page.evaluate(() => document.querySelector('#prompter-button').click())
    await page.waitForFunction(() => document.querySelector('#prompter-button').dataset.linkState === 'on')
    assert.deepEqual(await linkControls(), { pressed: 'true', linkState: 'on', switchOn: true })
    assert.equal((await prompterCall('GET', '/camframe/status')).status, 200)

    // Quick presses before main answers: every press, on the button or the switch, flips the one recent
    // request, so an even batch ends where it started and an odd batch flips it. One renderer's IPC
    // messages arrive in order, so `getState()` answers after the presses' patches.
    for (const [presses, end] of [
      [['button', 'button'], true],
      [['button', 'switch', 'button'], false],
      [['button', 'button', 'button'], true],
    ]) {
      await page.evaluate((presses) => {
        const controls = { button: '#prompter-button', switch: '#overlay-prompter-toggle' }
        for (const press of presses) document.querySelector(controls[press]).click()
      }, presses)
      assert.equal((await page.evaluate(() => window.camFrame.getState())).prompterLink, end, presses.join(' → '))
      const linkState = end ? 'on' : 'off'
      await page.waitForFunction((linkState) => document.querySelector('#prompter-button').dataset.linkState === linkState, linkState)
      assert.deepEqual(await linkControls(), { pressed: String(end), linkState, switchOn: end })
      if (end) assert.equal((await prompterCall('GET', '/camframe/status')).status, 200)
      else await assert.rejects(prompterCall('GET', '/camframe/status'), /ECONNREFUSED/)
    }

    await page.evaluate(() => document.querySelector('#overlay-prompter-toggle').click())
    await page.waitForFunction(() => document.querySelector('#prompter-button').dataset.linkState === 'off')
    assert.deepEqual(await linkControls(), { pressed: 'false', linkState: 'off', switchOn: false })
    await assert.rejects(prompterCall('GET', '/camframe/status'), /ECONNREFUSED/)
  } finally {
    await application?.close().catch(() => {})
    const expectedPrefix = `${resolve(tmpdir())}${sep}camframe-electron-smoke-`
    if (resolve(userDataDirectory).startsWith(expectedPrefix)) {
      await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
    }
  }
})

test('real Electron: layout Scenes go large and back to the original small size, and persist', async () => {
  assert.ok(await portFree(47833), 'Port 47833 is busy (is CamFrame running with the Prompter link on?).')
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'camframe-electron-smoke-'))
  const look = { borderWidth: 4, frameEffect: 'glow', cameraZoom: 140, cameraPosition: { x: 40, y: 55 }, mirror: false }
  await writeFile(
    join(userDataDirectory, 'preferences.json'),
    JSON.stringify({
      schemaVersion: 13,
      completedOnboardingVersion: 1,
      prompterLink: true,
      size: 288,
      ...look,
      presets: [{ id: 'preset-demo', name: 'Demo', settings: { size: 240, shape: 'rounded', position: { x: 120, y: 140 } } }],
    }),
  )
  const chrome = { left: 18, top: 84 }
  const windowAt = (camera) => ({ x: camera.x - chrome.left, y: camera.y - chrome.top, width: camera.width + 36, height: camera.height + 102 })
  let application
  try {
    application = await launchCamFrame(userDataDirectory)
    const page = await application.firstWindow()
    await page.locator('#overlay').waitFor({ state: 'visible' })
    const status = async () => (await prompterCall('GET', '/camframe/status')).body
    // Re-reads the status until the camera has stopped moving (the move takes about 0.3 s).
    const settledOn = async (view) => {
      const deadline = Date.now() + 3000
      for (;;) {
        await view.waitForTimeout(50)
        const body = await status()
        if (body.view?.settled) return body
        assert.ok(Date.now() < deadline, 'the camera did not stop moving within 3 s')
      }
    }
    const settled = () => settledOn(page)

    const before = await status()
    assert.equal(before.smallSize, 288, 'a schema-13 document gets its size as the small size')
    const small = await prompterCall('POST', '/camframe/scenes', { name: 'Live small corner', size: 'small', position: 'bottom-right' })
    assert.equal(small.status, 200)
    const large = await prompterCall('POST', '/camframe/scenes', { name: 'Live right large', size: 432, position: 'right', withinRight: 0.3 })
    assert.equal(large.status, 200)
    const { workArea } = large.body.saved
    assert.ok(large.body.saved.camera.x >= workArea.x + workArea.width * 0.7)

    assert.equal((await prompterCall('POST', '/camframe/cue', { scene: 'Live right large' })).status, 200)
    const inLarge = await settled()
    assert.deepEqual(inLarge.view.camera, large.body.saved.camera)
    assert.deepEqual(await overlayBounds(application), windowAt(large.body.saved.camera))
    assert.equal(inLarge.smallSize, 288)
    assert.deepEqual(inLarge.look, before.look)

    assert.equal((await prompterCall('POST', '/camframe/cue', { scene: 'Live small corner' })).status, 200)
    const inSmall = await settled()
    assert.deepEqual(inSmall.view.camera, small.body.saved.camera)
    assert.equal(inSmall.view.camera.width, 288)
    assert.deepEqual(await overlayBounds(application), windowAt(small.body.saved.camera))
    assert.deepEqual(inSmall.look, before.look)

    assert.equal((await prompterCall('POST', '/camframe/cue', { scene: 'Live right large' })).status, 200)
    await settled()
    assert.equal((await prompterCall('POST', '/camframe/cue', { size: 'small', position: 'bottom-right' })).status, 200)
    assert.deepEqual((await settled()).view.camera, small.body.saved.camera)

    await page.waitForTimeout(300)
    await application.close()
    application = undefined
    const saved = JSON.parse(await readFile(join(userDataDirectory, 'preferences.json'), 'utf8'))
    assert.equal(saved.schemaVersion, 14)
    assert.equal(saved.prompterSmallSize, 288)
    assert.deepEqual(saved.presets.map((scene) => scene.name), ['Demo', 'Live small corner', 'Live right large'])
    assert.deepEqual(saved.presets[1].layout, { size: 'small', position: 'bottom-right' })
    assert.deepEqual(saved.presets[2].layout, { size: 432, position: 'right', withinRight: 0.3 })

    application = await launchCamFrame(userDataDirectory)
    const again = await application.firstWindow()
    await again.locator('#overlay').waitFor({ state: 'visible' })
    const relaunched = await status()
    assert.deepEqual(relaunched.scenes, ['Demo', 'Live small corner', 'Live right large'])
    assert.equal((await prompterCall('POST', '/camframe/cue', { scene: 'Live right large' })).status, 200)
    assert.deepEqual((await settledOn(again)).view.camera, large.body.saved.camera)
    assert.equal((await prompterCall('POST', '/camframe/cue', { scene: 'Live small corner' })).status, 200)
    assert.deepEqual((await settledOn(again)).view.camera, small.body.saved.camera)
    assert.deepEqual((await status()).look, before.look)

    // The Inline settings, tray and shortcut path (main's sceneContext wiring): change the look,
    // then apply the large Scene through the bridge. Size and place follow the Scene; the look stays.
    await again.evaluate(() => window.camFrame.updateState({ borderWidth: 9 }))
    await again.waitForTimeout(200)
    const changedLook = (await status()).look
    assert.notEqual(changedLook.signature, before.look.signature)
    const largeId = relaunched.sceneDetails.find((scene) => scene.name === 'Live right large').id
    await again.evaluate((id) => window.camFrame.applyPreset(id), largeId)
    const byBridge = await settledOn(again)
    assert.deepEqual(byBridge.view.camera, large.body.saved.camera)
    assert.deepEqual(await overlayBounds(application), windowAt(large.body.saved.camera))
    assert.equal(byBridge.look.signature, changedLook.signature)
    // Nothing is drawn for the Scene (ADR 0036); the name goes to the hidden screen-reader region.
    await again.waitForTimeout(200)
    assert.equal(await again.evaluate(() => document.querySelector('#presentation-toast').hidden), true)
    assert.equal(await again.evaluate(() => document.querySelector('#scene-announcer').textContent), 'Live right large')
  } finally {
    await application?.close().catch(() => {})
    const expectedPrefix = `${resolve(tmpdir())}${sep}camframe-electron-smoke-`
    if (resolve(userDataDirectory).startsWith(expectedPrefix)) {
      await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
    }
  }
})
