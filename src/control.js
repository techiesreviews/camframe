const cameraSelect = document.querySelector('#camera-select')
const cameraError = document.querySelector('#camera-error')
const presetName = document.querySelector('#preset-name')
const savePresetButton = document.querySelector('#save-preset')
const presetSelect = document.querySelector('#preset-select')
const deletePresetButton = document.querySelector('#delete-preset')
const movePresetUpButton = document.querySelector('#move-preset-up')
const movePresetDownButton = document.querySelector('#move-preset-down')
const importPresetsButton = document.querySelector('#import-presets')
const exportPresetsButton = document.querySelector('#export-presets')
const sceneMessage = document.querySelector('#scene-message')
const shapePreview = document.querySelector('#shape-preview')
const sizeRange = document.querySelector('#size-range')
const sizeOutput = document.querySelector('#size-output')
const borderRange = document.querySelector('#border-range')
const borderColor = document.querySelector('#border-color')
const effectSelect = document.querySelector('#effect-select')
const effectColorField = document.querySelector('#effect-color-field')
const effectColor = document.querySelector('#effect-color')
const effectColorSwatches = document.querySelectorAll('[data-effect-color]')
const glowControls = document.querySelector('#glow-controls')
const glowStrength = document.querySelector('#glow-strength')
const glowStrengthOutput = document.querySelector('#glow-strength-output')
const glowSpread = document.querySelector('#glow-spread')
const glowSpreadOutput = document.querySelector('#glow-spread-output')
const blurControls = document.querySelector('#blur-controls')
const blurAmount = document.querySelector('#blur-amount')
const blurAmountOutput = document.querySelector('#blur-amount-output')
const blurOpacity = document.querySelector('#blur-opacity')
const blurOpacityOutput = document.querySelector('#blur-opacity-output')
const mirrorToggle = document.querySelector('#mirror-toggle')
const topToggle = document.querySelector('#top-toggle')
const launchToggle = document.querySelector('#launch-toggle')
const visibilityButton = document.querySelector('#visibility-button')
const centerButton = document.querySelector('#center-button')
const quitButton = document.querySelector('#quit-button')
const settingsRoot = document.querySelector('.settings')
const settingsTabs = document.querySelectorAll('.settings [data-settings-tab]')

let state
let selectedPresetId = ''
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

function selectSettingsPanel(panel) {
  settingsRoot.dataset.activePanel = panel
  settingsTabs.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.settingsTab === panel))
  })
}

settingsTabs.forEach((button) => {
  button.addEventListener('click', () => selectSettingsPanel(button.dataset.settingsTab))
})

function renderState(nextState) {
  state = nextState
  sizeRange.value = String(state.size)
  sizeOutput.textContent = `${state.size} px`
  borderRange.value = String(state.borderWidth)
  borderColor.value = state.borderColor
  effectSelect.value = state.frameEffect
  effectColor.value = state.effectColor.toUpperCase()
  effectColorSwatches.forEach((swatch) => {
    swatch.setAttribute('aria-pressed', String(swatch.dataset.effectColor === state.effectColor))
  })
  effectColorField.hidden = state.frameEffect !== 'glow'
  glowControls.hidden = state.frameEffect !== 'glow'
  glowStrength.value = String(state.glowStrength)
  glowStrengthOutput.textContent = `${state.glowStrength}%`
  glowSpread.value = String(state.glowSpread)
  glowSpreadOutput.textContent = `${state.glowSpread} px`
  blurControls.hidden = state.frameEffect !== 'blur'
  blurAmount.value = String(state.blurAmount)
  blurAmountOutput.textContent = `${state.blurAmount} px`
  blurOpacity.value = String(state.blurOpacity)
  blurOpacityOutput.textContent = `${state.blurOpacity}%`
  mirrorToggle.checked = state.mirror
  topToggle.checked = state.alwaysOnTop
  launchToggle.checked = state.launchAtLogin
  visibilityButton.textContent = state.overlayVisible ? 'Hide camera' : 'Show camera'
  shapePreview.dataset.shape = state.shape
  document.querySelector(`input[name='shape'][value='${state.shape}']`).checked = true
  renderPresets()

  if (state.cameraId && cameraSelect.querySelector(`option[value="${CSS.escape(state.cameraId)}"]`)) {
    cameraSelect.value = state.cameraId
  }
}

function renderDevices(devices) {
  const selected = state?.cameraId ?? ''
  cameraSelect.replaceChildren()

  if (!devices.length) {
    const option = new Option('No cameras found', '')
    cameraSelect.add(option)
    cameraSelect.disabled = true
    return
  }

  cameraSelect.disabled = false
  for (const device of devices) {
    cameraSelect.add(new Option(device.label, device.deviceId))
  }
  if (devices.some((device) => device.deviceId === selected)) cameraSelect.value = selected
}

cameraSelect.addEventListener('change', () => {
  const option = cameraSelect.selectedOptions[0]
  window.camFrame.updateState({ cameraId: cameraSelect.value, cameraLabel: option.textContent })
})

presetName.addEventListener('input', () => {
  savePresetButton.disabled = !presetName.value.trim()
})

savePresetButton.addEventListener('click', () => {
  const name = presetName.value.trim()
  if (!name) return
  window.camFrame.savePreset(name, selectedPresetId)
  if (!selectedPresetId) {
    presetName.value = ''
    savePresetButton.disabled = true
  }
})

presetName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !savePresetButton.disabled) savePresetButton.click()
})

presetSelect.addEventListener('change', () => {
  selectedPresetId = presetSelect.value
  const selected = state.presets.find((preset) => preset.id === selectedPresetId)
  presetName.value = selected?.name ?? ''
  savePresetButton.textContent = selected ? 'Update' : 'Save'
  savePresetButton.disabled = !presetName.value.trim()
  const selectedIndex = state.presets.findIndex((preset) => preset.id === selectedPresetId)
  deletePresetButton.disabled = selectedIndex < 0
  movePresetUpButton.disabled = selectedIndex <= 0
  movePresetDownButton.disabled = selectedIndex < 0 || selectedIndex >= state.presets.length - 1
  if (selectedPresetId) window.camFrame.applyPreset(selectedPresetId)
})

movePresetUpButton.addEventListener('click', () => {
  if (selectedPresetId) window.camFrame.reorderPreset(selectedPresetId, -1)
})

movePresetDownButton.addEventListener('click', () => {
  if (selectedPresetId) window.camFrame.reorderPreset(selectedPresetId, 1)
})

importPresetsButton.addEventListener('click', async () => {
  const result = await window.camFrame.importPresets()
  sceneMessage.textContent = result.error ?? (result.canceled ? '' : `${result.count} imported`)
})

exportPresetsButton.addEventListener('click', async () => {
  const result = await window.camFrame.exportPresets()
  sceneMessage.textContent = result.error ?? (result.canceled ? '' : `${result.count} exported`)
})

deletePresetButton.addEventListener('click', () => {
  if (!selectedPresetId) return
  window.camFrame.deletePreset(selectedPresetId)
  selectedPresetId = ''
})

document.querySelectorAll("input[name='shape']").forEach((input) => {
  input.addEventListener('change', () => window.camFrame.updateState({ shape: input.value }))
})

sizeRange.addEventListener('input', () => {
  sizeOutput.textContent = `${sizeRange.value} px`
  window.camFrame.updateState({ size: Number(sizeRange.value) })
})

borderRange.addEventListener('input', () => {
  window.camFrame.updateState({ borderWidth: Number(borderRange.value) })
})

borderColor.addEventListener('input', () => {
  window.camFrame.updateState({ borderColor: borderColor.value })
})

effectSelect.addEventListener('change', () => {
  window.camFrame.updateState({ frameEffect: effectSelect.value })
})

effectColor.addEventListener('input', () => {
  if (HEX_COLOR_PATTERN.test(effectColor.value)) {
    window.camFrame.updateState({ effectColor: effectColor.value.toLowerCase() })
  }
})

effectColor.addEventListener('blur', () => {
  if (!HEX_COLOR_PATTERN.test(effectColor.value)) effectColor.value = state.effectColor.toUpperCase()
})

effectColorSwatches.forEach((swatch) => {
  swatch.addEventListener('click', () => {
    window.camFrame.updateState({ effectColor: swatch.dataset.effectColor })
  })
})

function bindEffectRange(input, output, key, suffix) {
  input.addEventListener('input', () => {
    output.textContent = `${input.value}${suffix}`
    window.camFrame.updateState({ [key]: Number(input.value) })
  })
}

function renderPresets() {
  const previousPresetId = selectedPresetId
  if (state.presets.some((preset) => preset.id === state.activePresetId)) {
    selectedPresetId = state.activePresetId
  } else if (!state.presets.some((preset) => preset.id === selectedPresetId)) {
    selectedPresetId = ''
  }
  presetSelect.replaceChildren(
    new Option(state.presets.length ? 'New scene…' : 'No saved scenes', ''),
  )
  state.presets.forEach((preset, index) => {
    presetSelect.add(new Option(`${index + 1}. ${preset.name}`, preset.id))
  })
  presetSelect.value = selectedPresetId
  const selectedIndex = state.presets.findIndex((preset) => preset.id === selectedPresetId)
  deletePresetButton.disabled = selectedIndex < 0
  movePresetUpButton.disabled = selectedIndex <= 0
  movePresetDownButton.disabled = selectedIndex < 0 || selectedIndex >= state.presets.length - 1
  savePresetButton.textContent = selectedPresetId ? 'Update' : 'Save'
  if (previousPresetId !== selectedPresetId) {
    presetName.value = state.presets[selectedIndex]?.name ?? ''
    savePresetButton.disabled = !presetName.value.trim()
  }
}

bindEffectRange(glowStrength, glowStrengthOutput, 'glowStrength', '%')
bindEffectRange(glowSpread, glowSpreadOutput, 'glowSpread', ' px')
bindEffectRange(blurAmount, blurAmountOutput, 'blurAmount', ' px')
bindEffectRange(blurOpacity, blurOpacityOutput, 'blurOpacity', '%')

mirrorToggle.addEventListener('change', () => {
  window.camFrame.updateState({ mirror: mirrorToggle.checked })
})

topToggle.addEventListener('change', () => {
  window.camFrame.updateState({ alwaysOnTop: topToggle.checked })
})

launchToggle.addEventListener('change', () => {
  window.camFrame.updateState({ launchAtLogin: launchToggle.checked })
})

visibilityButton.addEventListener('click', () => {
  window.camFrame.updateState({ overlayVisible: !state.overlayVisible })
})

centerButton.addEventListener('click', () => window.camFrame.centerOverlay())
quitButton.addEventListener('click', () => window.camFrame.quit())

window.camFrame.onStateChanged(renderState)
window.camFrame.onDevicesChanged(renderDevices)
window.camFrame.onCameraError((message) => {
  cameraError.textContent = message
  cameraError.hidden = false
})
window.camFrame.getState().then(renderState)
