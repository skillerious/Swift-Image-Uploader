// preload.cjs — CommonJS, contextIsolation: true
const { contextBridge, ipcRenderer } = require('electron');

/** Safe wrappers */
function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}
function on(channel, cb) {
  const handler = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

/** Single surface API exposed to the renderer */
const api = {
  // Generic IPC helpers
  invoke,
  on,

  // ----- Window controls -----
  winMinimize: () => invoke('win:minimize'),
  winMaximize: () => invoke('win:maximize'),
  winIsMaximized: () => invoke('win:isMaximized'),
  winClose: () => invoke('win:close'),

  // ----- App / Devtools -----
  toggleDevtools: () => invoke('devtools:toggle'),
  reload: () => invoke('app:reload'),
  quit: () => invoke('app:quit'),
  getVersion: () => invoke('app:getVersion'),

  // ----- Clipboard -----
  clipboardWrite: (text) => invoke('clipboard:write', String(text || '')),

  // ----- Settings (aliases used by settings.js) -----
  getSettings: () => invoke('settings:get'),
  saveSettings: (payload) => invoke('settings:save', payload),
  testSettings: () => invoke('settings:test'),

  // ----- GitHub ops (names used in main window renderer) -----
  githubListDirs: () => invoke('github:listDirs'),
  githubListFiles: (dir) => invoke('github:listFiles', dir),
  githubCreateDir: (path) => invoke('github:createDir', path),
  githubUpload: (payload) => invoke('github:upload', payload),
  githubDelete: (path) => invoke('github:delete', path),
  githubRename: ({ oldPath, newPath }) =>
    invoke('github:rename', { oldPath, newPath }),

  // ----- Short aliases (used by upload.js) -----
  listDirs: () => invoke('github:listDirs'),
  upload: (payload) => invoke('github:upload', payload),

  // ----- Upload window bridge -----
  openUploadWindow: () => invoke('window:open-upload'),
  notifyUploaded: () => invoke('upload:notify'),

  // ----- Convenience aliases -----
  copyText: (text) => invoke('clipboard:write', String(text || '')),

  // ----- Event convenience -----
  onMenuOpenSettings: (cb) => on('menu:open-settings', cb),
  onMenuOpenAbout: (cb) => on('menu:open-about', cb),
  onMenuOpenUploader: (cb) => on('menu:open-uploader', cb),
  onUploadCompleted: (cb) => on('upload:completed', cb),
  onWinMaxState: (cb) => on('win:max-state', cb),
};

contextBridge.exposeInMainWorld('api', api);
