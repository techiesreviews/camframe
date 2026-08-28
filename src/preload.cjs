const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('camFrame', {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('state:get'),
  updateState: (patch) => ipcRenderer.send('state:update', patch),
  reportAccessibilityPreferences: (preferences) =>
    ipcRenderer.send('accessibility:preferences', preferences),
  savePreset: (name, id) => ipcRenderer.send('preset:save', name, id),
  applyPreset: (id) => ipcRenderer.send('preset:apply', id),
  deletePreset: (id) => ipcRenderer.send('preset:delete', id),
  reorderPreset: (id, direction) => ipcRenderer.send('preset:reorder', id, direction),
  exportPresets: () => ipcRenderer.invoke('preset:export'),
  importPresets: () => ipcRenderer.invoke('preset:import'),
  onStateChanged: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('state:changed', listener)
    return () => ipcRenderer.removeListener('state:changed', listener)
  },
  setOverlayInteractive: (interactive) => ipcRenderer.send('overlay:interactive', interactive),
  setOverlaySettingsOpen: (open) => ipcRenderer.send('overlay:settings-open', open),
  setOverlayOnboardingOpen: (open) => ipcRenderer.sendSync('overlay:onboarding-open', open),
  completeOnboarding: () => ipcRenderer.send('onboarding:complete'),
  startOverlayDrag: () => ipcRenderer.send('overlay:drag-start'),
  stopOverlayDrag: () => ipcRenderer.send('overlay:drag-stop'),
  startOverlayResize: (handle) => ipcRenderer.send('overlay:resize-start', handle),
  stopOverlayResize: () => ipcRenderer.send('overlay:resize-stop'),
  toggleFullscreen: () => ipcRenderer.send('overlay:fullscreen-toggle'),
  exitFullscreen: () => ipcRenderer.send('overlay:fullscreen-exit'),
  onFullscreenChanged: (callback) => {
    const listener = (_event, fullscreen) => callback(fullscreen)
    ipcRenderer.on('fullscreen:changed', listener)
    return () => ipcRenderer.removeListener('fullscreen:changed', listener)
  },
  onShowControls: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('controls:show', listener)
    return () => ipcRenderer.removeListener('controls:show', listener)
  },
  onPresentationNotice: (callback) => {
    const listener = (_event, message) => callback(message)
    ipcRenderer.on('presentation:notice', listener)
    return () => ipcRenderer.removeListener('presentation:notice', listener)
  },
  onShowOnboarding: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('onboarding:show', listener)
    return () => ipcRenderer.removeListener('onboarding:show', listener)
  },
  quit: () => ipcRenderer.send('app:quit'),
})
