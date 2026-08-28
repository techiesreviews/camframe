export const CURRENT_ONBOARDING_VERSION = 1
export const ONBOARDING_STEP_COUNT = 4
export const ONBOARDING_TOP_RESERVE = 220
export const ONBOARDING_SETTINGS_REVEAL_DELAY_MS = 80
export const ONBOARDING_DEMO_START_DELAY_MS = 320
export const ONBOARDING_SHAPE_DEMO_CLICKS = 3

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export function sanitizeCompletedOnboardingVersion(value) {
  if (!Number.isFinite(value)) return 0
  return Math.round(clamp(value, 0, CURRENT_ONBOARDING_VERSION))
}

export function completedOnboardingVersionForLoad(input = {}, hasPreferencesDocument = false) {
  if (Object.hasOwn(input, 'completedOnboardingVersion')) {
    return sanitizeCompletedOnboardingVersion(input.completedOnboardingVersion)
  }
  return hasPreferencesDocument ? CURRENT_ONBOARDING_VERSION : 0
}

export function shouldShowOnboarding(completedVersion) {
  return sanitizeCompletedOnboardingVersion(completedVersion) < CURRENT_ONBOARDING_VERSION
}

export function onboardingStepAfter(currentStep, direction) {
  const step = Number.isInteger(currentStep) ? currentStep : 0
  const delta = Math.sign(Number(direction) || 0)
  return clamp(step + delta, 0, ONBOARDING_STEP_COUNT - 1)
}

export function permissionRecoveryCopyFor(platform) {
  if (platform === 'darwin') {
    return 'Camera access is blocked. In System Settings, allow CamFrame to use the camera.'
  }
  if (platform === 'win32') {
    return 'Camera access is blocked. In Windows Settings, allow camera access for desktop apps.'
  }
  return 'Camera access is blocked. Allow CamFrame to use the camera in system privacy settings.'
}

export function onboardingStepsFor() {
  return [
    {
      title: 'Choose your camera',
      description: 'Settings allow you to choose your camera and camera quality.',
      target: '#controls-button',
      reveal: 'camera-settings',
    },
    {
      title: 'Move, resize, and reshape',
      description:
        'Watch Shape cycle. Hover it to stop, then click to continue. Drag the picture to move it or a corner to resize.',
      target: '#shape-button',
      reveal: 'shape-controls',
    },
    {
      title: 'Frame the shot',
      description:
        'Watch the mouse pan and zoom. Move over the camera to take control. Double-click resets; click Crosshair or press Escape to exit.',
      target: '#position-button',
      reveal: 'framing',
    },
    {
      title: 'Save and switch Scenes',
      description:
        'Each Scene remembers its camera, screen position, shape, framing, and style. Use this panel to save or switch layouts.',
      target: '#controls-button',
      reveal: 'scene-settings',
    },
  ]
}
