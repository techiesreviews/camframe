const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('camFrame', {
  getState: () => ipcRenderer.invoke('state:get'),
  updateState: (patch) => ipcRenderer.send('state:update', patch),
  onStateChanged: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('state:changed', listener)
    return () => ipcRenderer.removeListener('state:changed', listener)
  },
  reportDevices: (devices) => ipcRenderer.send('overlay:devices', devices),
  onDevicesChanged: (callback) => {
    const listener = (_event, devices) => callback(devices)
    ipcRenderer.on('devices:changed', listener)
    return () => ipcRenderer.removeListener('devices:changed', listener)
  },
  reportCameraError: (message) => ipcRenderer.send('overlay:error', message),
  setOverlayInteractive: (interactive) => ipcRenderer.send('overlay:interactive', interactive),
  setOverlaySettingsOpen: (open) => ipcRenderer.send('overlay:settings-open', open),
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
  onCameraError: (callback) => {
    const listener = (_event, message) => callback(message)
    ipcRenderer.on('camera:error', listener)
    return () => ipcRenderer.removeListener('camera:error', listener)
  },
  onShowControls: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('controls:show', listener)
    return () => ipcRenderer.removeListener('controls:show', listener)
  },
  showController: () => ipcRenderer.send('controller:show'),
  centerOverlay: () => ipcRenderer.send('overlay:center'),
  quit: () => ipcRenderer.send('app:quit'),
})
