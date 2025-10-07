// preload.cjs — CommonJS, contextIsolation: true
const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}
function on(channel, cb) {
  const handler = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api = {
  // Generic
  invoke,
  on,

  // Window controls
  winMinimize: () => invoke('win:minimize'),
  winMaximize: () => invoke('win:maximize'),
  winIsMaximized: () => invoke('win:isMaximized'),
  winClose: () => invoke('win:close'),

  // Devtools / app
  toggleDevtools: () => invoke('devtools:toggle'),
  reload: () => invoke('app:reload'),
  quit: () => invoke('app:quit'),
  getVersion: () => invoke('app:getVersion'),

  // Clipboard
  clipboardWrite: (text) => invoke('clipboard:write', String(text || '')),

  // GitHub ops
  githubListDirs: () => invoke('github:listDirs'),
  githubListFiles: (dir) => invoke('github:listFiles', dir),
  githubCreateDir: (path) => invoke('github:createDir', path),
  githubUpload: (payload) => invoke('github:upload', payload),
  githubDelete: (path) => invoke('github:delete', path),
  githubRename: ({ oldPath, newPath }) => invoke('github:rename', { oldPath, newPath }),

  // Upload window
  openUploadWindow: () => invoke('window:open-upload'),

  // Event convenience
  onMenuOpenSettings: (cb) => on('menu:open-settings', cb),
  onMenuOpenAbout: (cb) => on('menu:open-about', cb),
  onMenuOpenUploader: (cb) => on('menu:open-uploader', cb),
  onUploadCompleted: (cb) => on('upload:completed', cb),
  onWinMaxState: (cb) => on('win:max-state', cb),
};

contextBridge.exposeInMainWorld('api', api);
