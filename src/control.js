const cameraSelect = document.querySelector('#camera-select')
const cameraError = document.querySelector('#camera-error')
const shapePreview = document.querySelector('#shape-preview')
const sizeRange = document.querySelector('#size-range')
const sizeOutput = document.querySelector('#size-output')
const borderRange = document.querySelector('#border-range')
const borderColor = document.querySelector('#border-color')
const mirrorToggle = document.querySelector('#mirror-toggle')
const topToggle = document.querySelector('#top-toggle')
const visibilityButton = document.querySelector('#visibility-button')
const centerButton = document.querySelector('#center-button')
const quitButton = document.querySelector('#quit-button')

let state

function renderState(nextState) {
  state = nextState
  sizeRange.value = String(state.size)
  sizeOutput.textContent = `${state.size} px`
  borderRange.value = String(state.borderWidth)
  borderColor.value = state.borderColor
  mirrorToggle.checked = state.mirror
  topToggle.checked = state.alwaysOnTop
  visibilityButton.textContent = state.overlayVisible ? 'Hide camera' : 'Show camera'
  shapePreview.dataset.shape = state.shape
  document.querySelector(`input[name='shape'][value='${state.shape}']`).checked = true

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

mirrorToggle.addEventListener('change', () => {
  window.camFrame.updateState({ mirror: mirrorToggle.checked })
})

topToggle.addEventListener('change', () => {
  window.camFrame.updateState({ alwaysOnTop: topToggle.checked })
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
