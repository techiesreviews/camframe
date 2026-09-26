// Measures the Overlay's camera presentation pipeline with Chromium's synthetic camera.
// Usage: node scripts/camera-latency.mjs [seconds]
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const projectRoot = resolve(import.meta.dirname, '..')
const sampleSeconds = Number(process.argv[2]) || 5

const userDataDirectory = await mkdtemp(join(tmpdir(), 'camframe-latency-'))
const environment = { ...process.env, CAMFRAME_E2E: '1', CAMFRAME_E2E_USER_DATA_DIR: userDataDirectory }
delete environment.ELECTRON_RUN_AS_NODE

const application = await electron.launch({
  executablePath: require('electron'),
  args: ['.'],
  cwd: projectRoot,
  env: environment,
  timeout: 30_000,
})

try {
  const page = await application.firstWindow()
  await page.locator('#onboarding-panel').waitFor({ state: 'visible' })
  await page.locator('#onboarding-skip').click()
  const cameras = await page.evaluate(async () =>
    (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === 'videoinput')
      .map(({ deviceId, label }) => ({ deviceId, label })),
  )
  console.log(`cameras ${cameras.map((camera) => camera.label).join(' | ')}`)
  const quality = process.env.CAMFRAME_PROBE_QUALITY
  if (quality) await page.evaluate((overlayResolution) => window.camFrame.updateState({ overlayResolution }), quality)
  const effect = process.env.CAMFRAME_PROBE_EFFECT
  if (effect) await page.evaluate((frameEffect) => window.camFrame.updateState({ frameEffect }), effect)
  const cameraQuery = process.env.CAMFRAME_PROBE_CAMERA?.toLowerCase()
  if (cameraQuery) {
    const camera = cameras.find((candidate) => candidate.label.toLowerCase().includes(cameraQuery))
    if (!camera) throw new Error(`No camera label contains "${process.env.CAMFRAME_PROBE_CAMERA}"`)
    console.log(`selected ${camera.label}`)
    await page.evaluate(
      ({ deviceId, label }) => window.camFrame.updateState({ cameraId: deviceId, cameraLabel: label }),
      camera,
    )
    await page.waitForFunction(
      (deviceId) =>
        document.querySelector('#camera')?.srcObject?.getVideoTracks()[0]?.getSettings().deviceId === deviceId,
      camera.deviceId,
      { timeout: 20_000 },
    )
  }
  await page.waitForFunction(() => document.querySelector('#camera')?.readyState >= 2, null, {
    timeout: 20_000,
  })
  await page.waitForTimeout(1000)

  const result = await page.evaluate(
    (durationMs) =>
      new Promise((resolveSamples) => {
        const video = document.querySelector('#camera')
        const track = video.srcObject?.getVideoTracks()[0]
        const latencies = []
        const intervals = []
        let firstFrames
        let lastFrames
        let previousPresentation
        const startedAt = performance.now()
        const statsAtStart = track?.stats?.toJSON?.()
        const onFrame = (_now, metadata) => {
          if (metadata.captureTime) {
            latencies.push(metadata.expectedDisplayTime - metadata.captureTime)
          }
          if (previousPresentation) intervals.push(metadata.presentationTime - previousPresentation)
          previousPresentation = metadata.presentationTime
          firstFrames ??= metadata.presentedFrames
          lastFrames = metadata.presentedFrames
          if (performance.now() - startedAt < durationMs) video.requestVideoFrameCallback(onFrame)
          else {
            resolveSamples({
              settings: track?.getSettings(),
              latencies,
              intervals,
              presented: lastFrames - firstFrames,
              elapsedMs: performance.now() - startedAt,
              quality: video.getVideoPlaybackQuality?.(),
              statsAtStart,
              statsAtEnd: track?.stats?.toJSON?.(),
            })
          }
        }
        video.requestVideoFrameCallback(onFrame)
      }),
    sampleSeconds * 1000,
  )

  const percentile = (values, fraction) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
  }
  const format = (value) => (Number.isFinite(value) ? value.toFixed(1) : 'n/a')
  const { width, height, frameRate } = result.settings ?? {}
  console.log(`track ${width}x${height} @ ${frameRate} fps`)
  console.log(`presented ${format((result.presented / result.elapsedMs) * 1000)} fps`)
  console.log(
    `capture→display ms  p50 ${format(percentile(result.latencies, 0.5))}  p95 ${format(percentile(result.latencies, 0.95))}  (n=${result.latencies.length})`,
  )
  console.log(
    `frame interval ms   p50 ${format(percentile(result.intervals, 0.5))}  p95 ${format(percentile(result.intervals, 0.95))}  max ${format(Math.max(...result.intervals))}`,
  )
  const { statsAtStart: before, statsAtEnd: after } = result
  if (before && after) {
    const seconds = result.elapsedMs / 1000
    console.log(
      `source ${format((after.totalFrames - before.totalFrames) / seconds)} fps  delivered ${format((after.deliveredFrames - before.deliveredFrames) / seconds)} fps  discarded ${after.discardedFrames - before.discardedFrames}`,
    )
  }
  const displays = await application.evaluate(({ screen }) =>
    screen.getAllDisplays().map(({ label, displayFrequency, bounds }) => ({ label, displayFrequency, bounds })),
  )
  console.log(`displays ${JSON.stringify(displays)}`)
  console.log(`dropped ${result.quality?.droppedVideoFrames ?? 'n/a'} of ${result.quality?.totalVideoFrames ?? 'n/a'}`)
} finally {
  await application.close().catch(() => {})
  await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}
