import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Store from 'electron-store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------- Persistent settings ----------------
const store = new Store({
  name: 'settings',
  schema: {
    owner: { type: 'string', default: '' },
    repo: { type: 'string', default: '' },
    branch: { type: 'string', default: 'main' },
    token: { type: 'string', default: '' },
    rootDir: { type: 'string', default: 'images' },
    committerName: { type: 'string', default: 'Swift Image Host' },
    committerEmail: { type: 'string', default: '' }
  }
});

function ghHeaders() {
  const token = store.get('token');
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'swift-image-uploader'
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function ghJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...ghHeaders(), ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text); } catch {}
    const err = new Error(`GitHub ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2)}`);
    err.status = res.status;
    throw err;
  }
  try { return JSON.parse(text); } catch { return {}; }
}

// List directories (from full repo tree), filtered by rootDir when provided
async function listDirectories(owner, repo, branch, rootDir) {
  const tree = await ghJson(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const allDirs = new Set();
  for (const item of (tree.tree || [])) {
    if (item.type === 'tree') {
      const p = item.path.replace(/\\/g, '/');
      if (!rootDir || p === rootDir || p.startsWith(rootDir + '/')) allDirs.add(p);
    }
  }
  if (rootDir) allDirs.add(rootDir); // ensure root appears even if empty
  return Array.from(allDirs).sort((a, b) => a.localeCompare(b));
}

async function createDirectory(owner, repo, branch, fullPath) {
  const normalized = fullPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(normalized + '/.gitkeep')}`;
  const body = {
    message: `chore: create folder ${normalized}`,
    content: Buffer.from('').toString('base64'),
    branch,
    committer: {
      name: store.get('committerName') || 'Swift Image Host',
      email: store.get('committerEmail') || 'noreply@example.com'
    }
  };
  return ghJson(url, { method: 'PUT', body: JSON.stringify(body) });
}

async function getFileSha(owner, repo, branch, pathInRepo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 200) {
    const j = await res.json();
    return j.sha || true;
  }
  if (res.status === 404) return null;
  const text = await res.text();
  throw new Error(`GitHub ${res.status}: ${text}`);
}

async function uploadFile({ owner, repo, branch, targetDir, filename, base64Content, commitMessage }) {
  const committer = {
    name: store.get('committerName') || 'Swift Image Host',
    email: store.get('committerEmail') || 'noreply@example.com'
  };

  const safeDir = (targetDir || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const name = filename.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
  let pathInRepo = (safeDir ? `${safeDir}/` : '') + name;

  // collision handling
  let attempt = 0;
  while (attempt < 50) {
    const exists = await getFileSha(owner, repo, branch, pathInRepo);
    if (!exists) break;
    const dot = name.lastIndexOf('.');
    const base = dot > -1 ? name.slice(0, dot) : name;
    const ext = dot > -1 ? name.slice(dot) : '';
    attempt += 1;
    pathInRepo = (safeDir ? `${safeDir}/` : '') + `${base}-${attempt}${ext}`;
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}`;
  const body = {
    message: commitMessage || `feat: upload ${path.basename(pathInRepo)}`,
    content: base64Content,
    branch,
    committer
  };
  await ghJson(url, { method: 'PUT', body: JSON.stringify(body) });

  const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${pathInRepo}`;
  const blob = `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${pathInRepo}`;
  return {
    path: pathInRepo,
    raw,
    blob,
    markdown: `![${path.basename(pathInRepo)}](${raw})`,
    html: `<img src="${raw}" alt="${path.basename(pathInRepo)}">`
  };
}

async function listFilesInDir(owner, repo, branch, targetDir) {
  const safe = (targetDir || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(safe)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  const arr = await res.json();

  // ✅ ONLY return images
  const isImage = (n) => /\.(png|jpe?g|gif|bmp|webp|tiff?|svg)$/i.test(n || '');
  return (Array.isArray(arr) ? arr : [])
    .filter(x => x.type === 'file' && isImage(x.name));
}

// ---------------- Preload detection ----------------
function resolvePreloadPath() {
  const candidates = ['preload.cjs', 'preload.js', 'preload.mjs'];
  for (const f of candidates) {
    const p = path.join(__dirname, f);
    if (fs.existsSync(p)) return p;
  }
  const legacy = path.join(process.cwd(), 'preload.js');
  if (fs.existsSync(legacy)) return legacy;
  throw new Error('Preload script not found (looked for preload.cjs, preload.js, preload.mjs)');
}

// ---------------- Windows ----------------
let win;        // main window
let uploadWin;  // uploader window

function openUploadWindow() {
  if (uploadWin && !uploadWin.isDestroyed()) { uploadWin.focus(); return true; }
  uploadWin = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#1e1e1e',
    frame: false,
    parent: win,
    modal: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolvePreloadPath(),
      sandbox: true
    }
  });
  uploadWin.on('closed', () => { uploadWin = null; });
  uploadWin.loadFile('upload.html');
  return true;
}

function createWindow() {
  const preloadPath = resolvePreloadPath();

  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#1e1e1e',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true
    },
    show: true
  });

  win.loadFile('index.html');

  // Maximize once the window can paint, then show (no flicker)
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const sendMaxState = () => win.webContents.send('win:max-state', win.isMaximized());
  win.on('maximize', sendMaxState);
  win.on('unmaximize', sendMaxState);

  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Upload…', accelerator: 'Ctrl+U', click: () => openUploadWindow() },
        { label: 'Settings', accelerator: 'Ctrl+,', click: () => win.webContents.send('menu:open-settings') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', accelerator: 'Ctrl+R' },
        { role: 'toggleDevTools', accelerator: 'Ctrl+Shift+I' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About', click: () => win.webContents.send('menu:open-about') }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

// ---------------- App lifecycle ----------------
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------- IPC: App / Window ----------------
ipcMain.handle('win:minimize', () => win?.minimize());
ipcMain.handle('win:maximize', () => win?.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.handle('win:isMaximized', () => win?.isMaximized() ?? false);
ipcMain.handle('win:close', () => win?.close());
ipcMain.handle('devtools:toggle', () => win?.webContents.toggleDevTools());
ipcMain.handle('app:reload', () => win?.reload());
ipcMain.handle('app:quit', () => app.quit());
ipcMain.handle('app:getVersion', () => app.getVersion());

// Upload window
ipcMain.handle('window:open-upload', () => openUploadWindow());

// Broadcast “uploads complete”
ipcMain.handle('upload:notify', () => {
  if (win && !win.isDestroyed()) win.webContents.send('upload:completed');
  return true;
});

// ---------------- IPC: Dialog ----------------
ipcMain.handle('dialog:pickFiles', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png','jpg','jpeg','webp','gif','bmp','tiff','svg'] }]
  });
  return r.canceled ? [] : r.filePaths;
});

// ---------------- IPC: Settings / GitHub ----------------
ipcMain.handle('settings:get', () => {
  return {
    owner: store.get('owner'),
    repo: store.get('repo'),
    branch: store.get('branch'),
    token: !!store.get('token'),
    rootDir: store.get('rootDir'),
    committerName: store.get('committerName'),
    committerEmail: store.get('committerEmail')
  };
});
ipcMain.handle('settings:save', (_e, payload) => {
  const allowed = ['owner','repo','branch','rootDir','committerName','committerEmail'];
  for (const k of allowed) if (payload[k] !== undefined) store.set(k, String(payload[k] || '').trim());
  if (payload.token !== undefined) store.set('token', String(payload.token || '').trim());
  return true;
});
ipcMain.handle('settings:test', async () => {
  const owner = store.get('owner'), repo = store.get('repo'), branch = store.get('branch');
  if (!owner || !repo) throw new Error('Owner and repo are required.');
  const j = await ghJson(`https://api.github.com/repos/${owner}/${repo}`);
  await ghJson(`https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
  return { ok: true, repoName: j.full_name, default_branch: j.default_branch };
});
ipcMain.handle('github:listDirs', async () => {
  const owner = store.get('owner'), repo = store.get('repo'), branch = store.get('branch'), rootDir = store.get('rootDir');
  if (!owner || !repo || !branch) throw new Error('Configure owner/repo/branch in Settings.');
  return listDirectories(owner, repo, branch, rootDir);
});
ipcMain.handle('github:listFiles', async (_e, targetDir) => {
  const owner = store.get('owner'), repo = store.get('repo'), branch = store.get('branch');
  if (!owner || !repo || !branch) throw new Error('Configure owner/repo/branch in Settings.');
  return listFilesInDir(owner, repo, branch, targetDir);
});
ipcMain.handle('github:createDir', async (_e, fullPath) => {
  const owner = store.get('owner'), repo = store.get('repo'), branch = store.get('branch');
  if (!owner || !repo || !branch) throw new Error('Configure owner/repo/branch in Settings.');
  return createDirectory(owner, repo, branch, fullPath);
});
ipcMain.handle('github:upload', async (_e, payload) => {
  const { targetDir, filename, base64Content, commitMessage } = payload || {};
  const owner = store.get('owner'), repo = store.get('repo'), branch = store.get('branch');
  if (!owner || !repo || !branch) throw new Error('Configure owner/repo/branch in Settings.');
  if (!store.get('token')) throw new Error('GitHub token not set in Settings.');
  if (!filename || !base64Content) throw new Error('Invalid file payload.');
  return uploadFile({ owner, repo, branch, targetDir, filename, base64Content, commitMessage });
});
