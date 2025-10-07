// Preload (CommonJS). Safe bridge between renderer and main.
const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ------- App / Window -------
  appVersion: () => ipcRenderer.invoke('app:getVersion'),
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winMaximize: () => ipcRenderer.invoke('win:maximize'),
  winIsMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  winClose: () => ipcRenderer.invoke('win:close'),
  toggleDevTools: () => ipcRenderer.invoke('devtools:toggle'),
  appReload: () => ipcRenderer.invoke('app:reload'),
  appQuit: () => ipcRenderer.invoke('app:quit'),
  onWinMaxState: (cb) => ipcRenderer.on('win:max-state', (_e, v) => cb(!!v)),

  // ------- Dialogs -------
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),

  // ------- Settings -------
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),
  testSettings: () => ipcRenderer.invoke('settings:test'),

  // ------- GitHub -------
  listDirs: () => ipcRenderer.invoke('github:listDirs'),
  listFiles: (dir) => ipcRenderer.invoke('github:listFiles', dir),
  createDir: (fullPath) => ipcRenderer.invoke('github:createDir', fullPath),
  upload: (payload) => ipcRenderer.invoke('github:upload', payload),

  // ------- Utils -------
  copyText: (text) => clipboard.writeText(text),

  // ------- Native menu relays (from main → renderer) -------
  onOpenSettings: (cb) => ipcRenderer.on('menu:open-settings', cb),
  onOpenAbout: (cb) => ipcRenderer.on('menu:open-about', cb),
  onOpenUpload: (cb) => ipcRenderer.on('menu:open-upload', cb),

  // ------- Windows & Upload bridge (requested) -------
  // Opens the separate uploader window (upload.html)
  openUpload: () => ipcRenderer.invoke('window:open-upload'),
  // Notifies main process that an upload batch completed; main will broadcast to all windows
  notifyUploaded: () => ipcRenderer.invoke('upload:notify'),
  // Listen for an event when uploads complete elsewhere (so the main window can refresh)
  onUploaded: (cb) => ipcRenderer.on('upload:completed', cb)
});
