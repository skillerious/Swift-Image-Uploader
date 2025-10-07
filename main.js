// main.js — ESM
import {
	app,
	BrowserWindow,
	ipcMain,
	dialog,
	shell,
	Menu,
	clipboard
} from 'electron';
import path from 'node:path';
import {
	fileURLToPath
} from 'node:url';
import Store from 'electron-store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Persistent settings ----
const store = new Store({
	name: 'settings',
	schema: {
		owner: {
			type: 'string',
			default: ''
		},
		repo: {
			type: 'string',
			default: ''
		},
		branch: {
			type: 'string',
			default: 'main'
		},
		token: {
			type: 'string',
			default: ''
		},
		rootDir: {
			type: 'string',
			default: 'images'
		},
		committerName: {
			type: 'string',
			default: 'Swift Image Host'
		},
		committerEmail: {
			type: 'string',
			default: ''
		}
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
	const res = await fetch(url, {
		...opts,
		headers: {
			...ghHeaders(),
			...(opts.headers || {})
		}
	});
	const text = await res.text();
	if (!res.ok) {
		let msg = text;
		try {
			msg = JSON.parse(text);
		} catch {}
		const err = new Error(`GitHub ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2)}`);
		err.status = res.status;
		throw err;
	}
	try {
		return JSON.parse(text);
	} catch {
		return {};
	}
}

async function listDirectories(owner, repo, branch, rootDir) {
	const tree = await ghJson(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
	const allDirs = new Set();
	for (const item of (tree.tree || [])) {
		if (item.type === 'tree') {
			const p = item.path.replace(/\\/g, '/');
			if (!rootDir || p === rootDir || p.startsWith(rootDir + '/')) allDirs.add(p);
		}
	}
	if (rootDir) allDirs.add(rootDir);
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
	return ghJson(url, {
		method: 'PUT',
		body: JSON.stringify(body)
	});
}

async function getFileSha(owner, repo, branch, pathInRepo) {
	const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}?ref=${encodeURIComponent(branch)}`;
	const res = await fetch(url, {
		headers: ghHeaders()
	});
	if (res.status === 200) {
		const j = await res.json();
		return j.sha || true;
	}
	if (res.status === 404) return null;
	const text = await res.text();
	throw new Error(`GitHub ${res.status}: ${text}`);
}

async function uploadFile({
	owner,
	repo,
	branch,
	targetDir,
	filename,
	base64Content,
	commitMessage
}) {
	const committer = {
		name: store.get('committerName') || 'Swift Image Host',
		email: store.get('committerEmail') || 'noreply@example.com'
	};

	const safeDir = (targetDir || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
	const name = filename.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
	let pathInRepo = (safeDir ? `${safeDir}/` : '') + name;

	// avoid collision
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
	await ghJson(url, {
		method: 'PUT',
		body: JSON.stringify(body)
	});

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
	const res = await fetch(url, {
		headers: ghHeaders()
	});
	if (res.status === 404) return [];
	if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
	const arr = await res.json();
	return (Array.isArray(arr) ? arr : []).filter(x => x.type === 'file');
}

async function deleteFile(owner, repo, branch, pathInRepo, message) {
	const metaUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}?ref=${encodeURIComponent(branch)}`;
	const meta = await ghJson(metaUrl);
	const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}`;
	const body = {
		message: message || `chore: delete ${path.basename(pathInRepo)}`,
		sha: meta.sha,
		branch,
		committer: {
			name: store.get('committerName') || 'Swift Image Host',
			email: store.get('committerEmail') || 'noreply@example.com'
		}
	};
	return ghJson(url, {
		method: 'DELETE',
		body: JSON.stringify(body)
	});
}

async function renameFile(owner, repo, branch, oldPath, newPath) {
	// download old content
	const metaUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(oldPath)}?ref=${encodeURIComponent(branch)}`;
	const meta = await ghJson(metaUrl);
	let rawUrl = meta.download_url;
	if (!rawUrl) rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${oldPath}`;

	const rawRes = await fetch(rawUrl, {
		headers: ghHeaders()
	});
	if (!rawRes.ok) throw new Error(`GitHub raw ${rawRes.status}`);
	const ab = await rawRes.arrayBuffer();
	const base64Content = Buffer.from(ab).toString('base64');

	// put new
	const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(newPath)}`;
	await ghJson(putUrl, {
		method: 'PUT',
		body: JSON.stringify({
			message: `chore: rename ${path.basename(oldPath)} → ${path.basename(newPath)}`,
			content: base64Content,
			branch,
			committer: {
				name: store.get('committerName') || 'Swift Image Host',
				email: store.get('committerEmail') || 'noreply@example.com'
			}
		})
	});

	// delete old
	await deleteFile(owner, repo, branch, oldPath, `chore: remove ${path.basename(oldPath)} after rename`);

	const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${newPath}`;
	const blob = `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${newPath}`;
	return {
		path: newPath,
		raw,
		blob
	};
}

let win;

/* ---------- Windows ---------- */
function createWindow() {
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
			preload: path.join(__dirname, 'preload.cjs'),
			sandbox: true
		},
		show: true
	});

	win.loadFile('index.html');

	win.once('ready-to-show', () => {
		win.maximize();
		win.show();
	});

	win.webContents.setWindowOpenHandler(({
		url
	}) => {
		shell.openExternal(url);
		return {
			action: 'deny'
		};
	});

	const sendMaxState = () => win.webContents.send('win:max-state', win.isMaximized());
	win.on('maximize', sendMaxState);
	win.on('unmaximize', sendMaxState);

	const menu = Menu.buildFromTemplate([{
			label: 'File',
			submenu: [{
					label: 'Settings',
					accelerator: 'Ctrl+,',
					click: () => win.webContents.send('menu:open-settings')
				},
				{
					label: 'Open Uploader',
					accelerator: 'Ctrl+U',
					click: () => win.webContents.send('menu:open-uploader')
				},
				{
					type: 'separator'
				},
				{
					role: 'quit'
				}
			]
		},
		{
			label: 'Edit',
			submenu: [{
				role: 'cut'
			}, {
				role: 'copy'
			}, {
				role: 'paste'
			}, {
				role: 'selectAll'
			}]
		},
		{
			label: 'View',
			submenu: [{
					role: 'reload',
					accelerator: 'Ctrl+R'
				},
				{
					role: 'toggleDevTools',
					accelerator: 'Ctrl+Shift+I'
				},
				{
					type: 'separator'
				},
				{
					role: 'resetZoom'
				}, {
					role: 'zoomIn'
				}, {
					role: 'zoomOut'
				}, {
					role: 'togglefullscreen'
				}
			]
		},
		{
			label: 'Help',
			submenu: [{
				label: 'About',
				click: () => win.webContents.send('menu:open-about')
			}]
		}
	]);
	Menu.setApplicationMenu(menu);
}

function createUploadWindow() {
	const up = new BrowserWindow({
		width: 880,
		height: 620,
		backgroundColor: '#1e1e1e',
		frame: false,
		parent: win,
		modal: false,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: path.join(__dirname, 'preload.cjs'),
			sandbox: true
		}
	});
	up.loadFile('upload.html');
	up.webContents.setWindowOpenHandler(({
		url
	}) => {
		shell.openExternal(url);
		return {
			action: 'deny'
		};
	});
	return up;
}

/* ---------- App lifecycle ---------- */
app.whenReady().then(() => {
	createWindow();
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

/* ---------- IPC: App / Window ---------- */
ipcMain.handle('win:minimize', e => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.handle('win:maximize', e => {
	const w = BrowserWindow.fromWebContents(e.sender);
	if (w?.isMaximized()) w.unmaximize();
	else w?.maximize();
});
ipcMain.handle('win:isMaximized', e => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false);
ipcMain.handle('win:close', e => BrowserWindow.fromWebContents(e.sender)?.close());
ipcMain.handle('devtools:toggle', e => BrowserWindow.fromWebContents(e.sender)?.webContents.toggleDevTools());
ipcMain.handle('app:reload', e => BrowserWindow.fromWebContents(e.sender)?.reload());
ipcMain.handle('app:quit', () => app.quit());
ipcMain.handle('app:getVersion', () => app.getVersion());

/* Clipboard (renderer-safe) */
ipcMain.handle('clipboard:write', (_e, text) => {
	clipboard.writeText(String(text || ''));
	return true;
});

/* ---------- IPC: Dialog ---------- */
ipcMain.handle('dialog:pickFiles', async (e) => {
	const w = BrowserWindow.fromWebContents(e.sender);
	const r = await dialog.showOpenDialog(w, {
		properties: ['openFile', 'multiSelections'],
		filters: [{
			name: 'Images',
			extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'svg']
		}]
	});
	return r.canceled ? [] : r.filePaths;
});

/* ---------- IPC: Settings / GitHub ---------- */
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
	const allowed = ['owner', 'repo', 'branch', 'rootDir', 'committerName', 'committerEmail'];
	for (const k of allowed)
		if (payload[k] !== undefined) store.set(k, String(payload[k] || '').trim());
	if (payload.token !== undefined) store.set('token', String(payload.token || '').trim());
	return true;
});

ipcMain.handle('settings:test', async () => {
	const owner = store.get('owner'),
		repo = store.get('repo'),
		branch = store.get('branch');
	if (!owner || !repo) throw new Error('Owner and repo are required.');
	const j = await ghJson(`https://api.github.com/repos/${owner}/${repo}`);
	await ghJson(`https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
	return {
		ok: true,
		repoName: j.full_name,
		default_branch: j.default_branch
	};
});

/* GitHub file ops */
ipcMain.handle('github:listDirs', async () => {
	const owner = store.get('owner'),
		repo = store.get('repo'),
		branch = store.get('branch'),
		rootDir = store.get('rootDir');
	if (!owner || !repo || !branch) throw new Error('Configure owner/repo/branch in Settings.');
	return listDirectories(owner, repo, branch, rootDir);
});

ipcMain.handle('github:listFiles', async (_e, targetDir) => {
	const owner = store.get('owner'),
		repo = store.get('repo'),
		branch = store.get('branch');
	if (!owner || !repo || !branch) throw new Error('Configure owner/repo/branch in Settings.');
	return listFilesInDir(owner, repo, branch, targetDir);
});

ipcMain.handle('github:createDir', async (_e, fullPath) => {
	const owner = store.get('owner'),
		repo = store.get('repo'),
		branch = store.get('branch');
	if (!owner || !repo || !branch) throw new Error('Configure owner/repo/branch in Settings.');
	return createDirectory(owner, repo, branch, fullPath);
});

ipcMain.handle('github:upload', async (_e, payload) => {
	const {
		targetDir,
		filename,
		base64Content,
		commitMessage
	} = payload || {};
	const owner = store.get('owner'),
		repo = store.get('repo'),
		branch = store.get('branch');
	if (!owner || !repo || !branch) throw new Error('Configure owner/repo/branch in Settings.');
	if (!store.get('token')) throw new Error('GitHub token not set in Settings.');
	if (!filename || !base64Content) throw new Error('Invalid file payload.');
	return uploadFile({
		owner,
		repo,
		branch,
		targetDir,
		filename,
		base64Content,
		commitMessage
	});
});

ipcMain.handle('github:delete', async (_e, pathInRepo) => {
	const owner = store.get('owner'),
		repo = store.get('repo'),
		branch = store.get('branch');
	if (!owner || !repo || !branch) throw new Error('Configure owner/repo/branch in Settings.');
	if (!store.get('token')) throw new Error('GitHub token not set in Settings.');
	return deleteFile(owner, repo, branch, pathInRepo);
});

ipcMain.handle('github:rename', async (_e, {
	oldPath,
	newPath
}) => {
	const owner = store.get('owner'),
		repo = store.get('repo'),
		branch = store.get('branch');
	if (!owner || !repo || !branch) throw new Error('Configure owner/repo/branch in Settings.');
	if (!store.get('token')) throw new Error('GitHub token not set in Settings.');
	return renameFile(owner, repo, branch, oldPath, newPath);
});

/* ---------- Upload window bridge ---------- */
ipcMain.handle('window:open-upload', () => {
	createUploadWindow();
	return true;
});
ipcMain.handle('upload:notify', () => {
	BrowserWindow.getAllWindows().forEach(w => w.webContents.send('upload:completed'));
	return true;
});