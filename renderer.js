/* renderer.js – Swift Image Uploader (everything in one place) */
(() => {
  'use strict';

  /* ---------------------- tiny DOM helpers ---------------------- */
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  /* ---------------------- robust IPC bridge --------------------- */
  const IPC = {
    async call(channel, payload){
      if (typeof window.api?.invoke === 'function') return window.api.invoke(channel, payload);
      if (typeof window.api?.[channel] === 'function') return window.api[channel](payload);
      throw new Error(`IPC bridge missing for "${channel}"`);
    },
    on(channel, cb){
      if (typeof window.api?.on === 'function') window.api.on(channel, cb);
    }
  };

  /* ---------------------- utils ---------------------- */
  const IMG_EXTS = ['.png','.jpg','.jpeg','.webp','.gif','.bmp','.tiff','.svg','.avif'];
  const isImageName = (name='') => {
    const n = String(name).toLowerCase();
    if (!n || n[0] === '.') return false;
    return IMG_EXTS.some(ext => n.endsWith(ext));
  };
  const fmtBytes = (n) => {
    if (!n && n !== 0) return '—';
    const k = 1024;
    if (n < k) return `${n} B`;
    const u = ['KB','MB','GB','TB'];
    let i = -1, v = n;
    do { v /= k; i++; } while (v >= k && i < u.length-1);
    return `${v.toFixed(2)} ${u[i]}`;
  };
  const gcd = (a,b)=>{ a=Math.abs(a||0); b=Math.abs(b||0); while(b){ const t=b; b=a%b; a=t; } return a||1; };
  const toast = (msg, ok=true) => {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.style.borderColor = ok ? 'var(--border)' : 'var(--danger)';
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => el.style.display = 'none', 2400);
  };
  const copyText = async (text) => {
    try {
      await IPC.call('clipboard:write', String(text ?? ''));
      toast('Copied to clipboard');
    } catch {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(text ?? ''));
        toast('Copied to clipboard');
      } else {
        toast('Copy failed', false);
      }
    }
  };

  /* ---------- Palette extraction (fast quantization) ---------- */
  function rgbToHex(r,g,b){
    const to = (v)=> v.toString(16).padStart(2,'0');
    return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
  }
  function dist(c1, c2){
    const dr=c1[0]-c2[0], dg=c1[1]-c2[1], db=c1[2]-c2[2];
    return Math.sqrt(dr*dr+dg*dg+db*db);
  }
  function extractPaletteFromImage(img, count=6){
    try{
      const w = Math.max(1, Math.min(64, img.naturalWidth || 1));
      const h = Math.max(1, Math.min(64, img.naturalHeight || 1));
      const cvs = document.createElement('canvas');
      cvs.width = w; cvs.height = h;
      const ctx = cvs.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0,0,w,h).data;

      // 4-bit per channel quantization (4096 buckets)
      const buckets = new Map();
      for (let i=0;i<data.length;i+=4){
        const a = data[i+3];
        if (a < 64) continue; // skip transparent
        let r = data[i]>>4, g = data[i+1]>>4, b = data[i+2]>>4;
        const key = (r<<8)|(g<<4)|b;
        buckets.set(key, (buckets.get(key)||0)+1);
      }
      const sorted = [...buckets.entries()].sort((a,b)=>b[1]-a[1]);

      const colors=[];
      for (let k=0; k<sorted.length && colors.length<count; k++){
        const key = sorted[k][0];
        const r=((key>>8)&0xF)*17, g=((key>>4)&0xF)*17, b=(key&0xF)*17;
        // Prevent near-duplicates
        if (colors.some(c => dist(c,[r,g,b]) < 24)) continue;
        colors.push([r,g,b]);
      }
      if (!colors.length) colors.push([221,221,221]);
      return colors.map(c=>rgbToHex(c[0],c[1],c[2]));
    }catch{
      return ['#DDDDDD'];
    }
  }

  /* ---------------------- app state ---------------------- */
  const state = {
    view: localStorage.getItem('view') || 'grid',
    folders: [],
    currentFolder: '',
    files: [],
    selected: null,
  };

  /* ---------------------- titlebar wiring ---------------------- */
  async function wireTitlebar(){
    const btnMin = $('#win-min');
    const btnMax = $('#win-max');
    const btnClose = $('#win-close');
    const icMax = $('#win-max-ic');

    btnMin?.addEventListener('click', () => IPC.call('win:minimize'));
    btnMax?.addEventListener('click', () => IPC.call('win:maximize'));
    btnClose?.addEventListener('click', () => IPC.call('win:close'));

    const setMaxState = (isMax) => {
      if (!icMax) return;
      icMax.classList.remove('codicon-chrome-maximize','codicon-chrome-restore');
      icMax.classList.add(isMax ? 'codicon-chrome-restore' : 'codicon-chrome-maximize');
    };
    try {
      const isNow = await IPC.call('win:isMaximized');
      setMaxState(!!isNow);
    } catch {}
    IPC.on?.('win:max-state', (_e, isMax) => setMaxState(!!isMax));

    $('#tb-settings')?.addEventListener('click', () => Settings?.open?.());
    $('#tb-about')?.addEventListener('click', openAbout);
  }

  /* ---------------------- menus (in-window) ---------------------- */
  function wireMenubar(){
    const menus = $$('.menu');
    menus.forEach(m => {
      const btn = $('.menu-btn', m);
      const panel = $('.menu-panel', m);
      btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        menus.forEach(x => x.classList.toggle('open', x === m ? !m.classList.contains('open') : false));
      });
      $$('.menu-item', panel).forEach(b => b.setAttribute('type','button'));
    });
    document.addEventListener('click', () => menus.forEach(m => m.classList.remove('open')));

    $('#m-file-upload')?.addEventListener('click', () => IPC.call('window:open-upload'));
    $('#m-file-settings')?.addEventListener('click', () => Settings?.open?.());
    $('#m-file-refresh')?.addEventListener('click', rebuildEverything);
    $('#m-file-exit')?.addEventListener('click', () => IPC.call('app:quit'));

    $('#m-view-reload')?.addEventListener('click', () => IPC.call('app:reload'));
    $('#m-view-devtools')?.addEventListener('click', () => IPC.call('devtools:toggle'));
    $('#m-view-fullscreen')?.addEventListener('click', () => document.documentElement.requestFullscreen?.());

    $('#m-go-open-repo')?.addEventListener('click', () => {
      const owner = Settings?.getOwner?.() || '';
      const repo  = Settings?.getRepo?.() || '';
      if (owner && repo) window.open(`https://github.com/${owner}/${repo}`, '_blank','noreferrer');
      else toast('Fill Owner/Repo in Settings first', false);
    });
    $('#m-go-open-owner')?.addEventListener('click', () => {
      const owner = Settings?.getOwner?.() || '';
      if (owner) window.open(`https://github.com/${owner}`, '_blank','noreferrer');
      else toast('Fill Owner in Settings first', false);
    });

    $('#m-tools-new-folder')?.addEventListener('click', newFolderFlow);
    $('#m-tools-uploader')?.addEventListener('click', () => IPC.call('window:open-upload'));
    $('#m-tools-refresh')?.addEventListener('click', rebuildEverything);

    $('#m-help-about')?.addEventListener('click', openAbout);
  }

  /* ---------------------- GitHub wrappers via IPC ---------------------- */
  const GH = {
    async listDirs(){ return await IPC.call('github:listDirs'); },
    async listFiles(dir){ return await IPC.call('github:listFiles', dir); },
    async createDir(fullPath){ return await IPC.call('github:createDir', fullPath); },
    async deleteFile(pathInRepo){ return await IPC.call('github:delete', pathInRepo); },
    async rename(oldPath, newPath){ return await IPC.call('github:rename', { oldPath, newPath }); }
  };

  /* ---------------------- Folder tree ---------------------- */
  async function rebuildTree(){
    const treeEl = $('#folder-tree');
    if (!treeEl) return;
    treeEl.innerHTML = '<div class="placeholder">Loading folders…</div>';

    const dirs = await GH.listDirs();
    state.folders = dirs.slice().sort((a,b) => a.localeCompare(b));
    const filterText = ($('#search-folders')?.value || '').trim().toLowerCase();

    const frag = document.createDocumentFragment();
    state.folders.forEach(d => {
      if (filterText && !d.toLowerCase().includes(filterText)) return;
      const depth = d.split('/').length - 1;
      const node = document.createElement('div');
      node.className = 'node';
      node.dataset.path = d;
      node.style.paddingLeft = `${6 + depth * 14}px`;
      node.innerHTML = `
        <span class="codicon codicon-root-folder"></span>
        <span class="label" title="${d}">${d}</span>
      `;
      node.addEventListener('click', () => {
        $$('.tree .node').forEach(n => n.classList.remove('active'));
        node.classList.add('active');
        state.currentFolder = d;
        $('#target-folder').value = d;
        rebuildFiles();
      });
      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showFolderContextMenu(e.pageX, e.pageY, d);
      });
      frag.appendChild(node);
    });
    treeEl.innerHTML = '';
    treeEl.appendChild(frag);

    if (!state.currentFolder) {
      const def = Settings?.getDefaultSelect?.() || Settings?.getRoot?.() || state.folders[0] || '';
      const found = $(`.tree .node[data-path="${CSS.escape(def)}"]`) || $('.tree .node');
      found?.click();
    } else {
      $(`.tree .node[data-path="${CSS.escape(state.currentFolder)}"]`)?.classList.add('active');
    }
  }

  function showFolderContextMenu(x, y, path){
    let menu = $('#folder-ctx');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'folder-ctx';
      menu.className = 'ctx-menu';
      menu.innerHTML = `
        <div class="mi" data-act="new"><span class="codicon codicon-new-folder"></span> New subfolder</div>
        <div class="mi" data-act="rename"><span class="codicon codicon-edit"></span> Rename folder</div>
        <div class="mi" data-act="delete"><span class="codicon codicon-trash"></span> Delete folder</div>
      `;
      document.body.appendChild(menu);
      document.addEventListener('click', () => menu.style.display='none');
    }
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'block';

    const act = (type) => {
      if (type === 'new') return newFolderFlow(path + '/');
      if (type === 'rename') return renameFolderFlow(path);
      if (type === 'delete') return deleteFolderFlow(path);
    };
    $$('.mi', menu).forEach(mi => {
      mi.onclick = (e) => { e.stopPropagation(); menu.style.display='none'; act(mi.dataset.act); };
    });
  }

  async function newFolderFlow(prefix = ''){
    const base = prefix || (state.currentFolder ? state.currentFolder + '/' : (Settings?.getRoot?.() || 'images/') );
    const name = await promptNice('New folder', 'Enter a new folder name', { placeholder: 'e.g. avatars', value: '' });
    if (!name) return;
    const full = (base + name).replace(/\/+/g,'/').replace(/\/$/, '');
    try {
      await GH.createDir(full);
      toast('Folder created');
      await rebuildTree();
    } catch (e) {
      console.error(e);
      toast(e.message || 'Create folder failed', false);
    }
  }
  async function renameFolderFlow(oldPath){
    const base = oldPath.split('/').slice(0,-1).join('/');
    const curr = oldPath.split('/').pop();
    const name = await promptNice('Rename folder', `Rename “${oldPath}” to:`, { value: curr || '' });
    if (!name || name === curr) return;

    try{
      const files = await GH.listFiles(oldPath);
      for (const f of files) {
        if (!f.path) continue;
        const newPath = (base ? base+'/' : '') + name + '/' + f.name;
        await GH.rename(f.path, newPath);
      }
      toast('Folder renamed');
      await rebuildTree();
      state.currentFolder = (base ? base+'/' : '') + name;
      rebuildFiles();
    }catch(e){
      console.error(e);
      toast(e.message || 'Rename failed', false);
    }
  }
  async function deleteFolderFlow(path){
    if (!confirm(`Delete folder "${path}" and its files?`)) return;
    try{
      const files = await GH.listFiles(path);
      for (const f of files) await GH.deleteFile(f.path);
      toast('Folder emptied (folder disappears once GitHub refreshes)');
      await rebuildTree();
      state.currentFolder = Settings?.getRoot?.() || '';
      rebuildFiles();
    }catch(e){
      console.error(e);
      toast(e.message || 'Delete failed', false);
    }
  }

  /* ---------------------- Files area ---------------------- */
  async function rebuildFiles(){
    const grid = $('#files-grid');
    const sel = $('#target-folder');

    sel.innerHTML = state.folders.map(f => `<option value="${f}">${f}</option>`).join('');
    if (state.currentFolder) sel.value = state.currentFolder;
    sel.onchange = () => {
      state.currentFolder = sel.value;
      $$('.tree .node').forEach(n => n.classList.toggle('active', n.dataset.path === state.currentFolder));
      rebuildFiles();
    };

    if (!state.currentFolder) {
      grid.classList.add('empty');
      grid.innerHTML = buildEmptyState();
      return;
    }

    grid.classList.remove('empty');
    grid.innerHTML = '<div class="placeholder">Loading…</div>';

    let files = await GH.listFiles(state.currentFolder);
    files = (files || []).filter(x => isImageName(x.name));
    state.files = files;

    if (!files.length) {
      grid.classList.add('empty');
      grid.innerHTML = buildEmptyState(true);
      return;
    }

    grid.classList.remove('empty');
    grid.className = 'files-grid ' + (state.view === 'list' ? 'list' : '');

    if (state.view === 'list') renderList(files, grid);
    else renderGrid(files, grid);
  }

  function buildEmptyState(showNewFolder=false){
    const tips = `
      <div class="es-links">
        Tips:
        <ul style="text-align:left; margin:8px auto; max-width:520px; line-height:1.6; color:var(--muted)">
          <li>Use <code>Upload…</code> to add images quickly.</li>
          <li>Right-click folders to create, rename, or delete them.</li>
          <li>Set your <strong>Owner/Repo/Branch</strong> in Settings.</li>
        </ul>
      </div>`;
    const actions = `
      <div class="es-actions">
        ${showNewFolder ? `<button class="btn" id="es-new"><span class="codicon codicon-new-folder"></span> New folder</button>` : ''}
        <button class="btn primary" id="es-settings"><span class="codicon codicon-gear"></span> Open settings</button>
        <button class="btn" id="es-upload"><span class="codicon codicon-cloud-upload"></span> Upload…</button>
      </div>`;
    const ill = `
      <div class="es-illustration">
        <img alt="Empty" src="assets/emptystate.png" />
      </div>`;
    const html = `
      <div class="empty-wrap">
        <div class="es-card">
          ${ill}
          <div class="es-title">No images here yet</div>
          <p class="es-sub">Drop files into this app or click Upload to push images to your repository.</p>
          ${actions}
          ${tips}
        </div>
      </div>`;
    setTimeout(() => {
      $('#es-settings')?.addEventListener('click', () => Settings?.open?.());
      $('#es-upload')?.addEventListener('click', () => IPC.call('window:open-upload'));
      $('#es-new')?.addEventListener('click', () => newFolderFlow());
    }, 0);
    return html;
  }

  function renderGrid(files, host){
    const frag = document.createDocumentFragment();
    files.forEach(f => {
      const card = document.createElement('div');
      card.className = 'file-card';
      card.innerHTML = `
        <div class="file-thumb"><img alt="" loading="lazy"></div>
        <div class="file-name" title="${f.name}">${f.name}</div>
        <div class="file-actions">
          <button class="btn xs" title="Preview"><span class="codicon codicon-eye"></span></button>
          <button class="btn xs" title="Copy raw URL"><span class="codicon codicon-link"></span></button>
          <button class="btn xs" title="Copy Markdown"><span class="codicon codicon-markdown"></span></button>
          <button class="btn xs" title="Copy HTML"><span class="codicon codicon-code"></span></button>
          <button class="btn xs" title="Rename"><span class="codicon codicon-edit"></span></button>
          <button class="btn xs danger" title="Delete"><span class="codicon codicon-trash"></span></button>
        </div>
      `;
      const img = $('img', card);
      img.src = f.download_url || f.raw || '';
      img.addEventListener('click', () => selectFile(f));

      const [bPrev,bRaw,bMd,bHtml,bRen,bDel] = $$('.btn', card);
      bPrev.addEventListener('click', () => selectFile(f));
      bRaw.addEventListener('click', () => copyText(f.download_url || f.raw || ''));
      bMd.addEventListener('click', () => copyText(`![${f.name}](${f.download_url || f.raw})`));
      bHtml.addEventListener('click', () => copyText(`<img src="${f.download_url || f.raw}" alt="${f.name}">`));
      bRen.addEventListener('click', () => renameFileFlow(f));
      bDel.addEventListener('click', () => deleteFileFlow(f));

      frag.appendChild(card);
    });
    host.innerHTML = '';
    host.appendChild(frag);
  }

  function renderList(files, host){
    const frag = document.createDocumentFragment();
    files.forEach(f => {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = `
        <div class="row-thumb"><img alt="" loading="lazy"></div>
        <div class="row-name" title="${f.name}">${f.name}</div>
        <div class="row-actions">
          <button class="btn xs" title="Preview"><span class="codicon codicon-eye"></span></button>
          <button class="btn xs" title="Raw"><span class="codicon codicon-link"></span></button>
          <button class="btn xs" title="MD"><span class="codicon codicon-markdown"></span></button>
          <button class="btn xs" title="HTML"><span class="codicon codicon-code"></span></button>
          <button class="btn xs" title="Rename"><span class="codicon codicon-edit"></span></button>
          <button class="btn xs danger" title="Delete"><span class="codicon codicon-trash"></span></button>
        </div>
      `;
      $('img', row).src = f.download_url || f.raw || '';

      const [bPrev,bRaw,bMd,bHtml,bRen,bDel] = $$('.btn', row);
      bPrev.addEventListener('click', () => selectFile(f));
      bRaw.addEventListener('click', () => copyText(f.download_url || f.raw || ''));
      bMd.addEventListener('click', () => copyText(`![${f.name}](${f.download_url || f.raw})`));
      bHtml.addEventListener('click', () => copyText(`<img src="${f.download_url || f.raw}" alt="${f.name}">`));
      bRen.addEventListener('click', () => renameFileFlow(f));
      bDel.addEventListener('click', () => deleteFileFlow(f));

      frag.appendChild(row);
    });
    host.innerHTML = '';
    host.appendChild(frag);
  }

  async function deleteFileFlow(file){
    if (!confirm(`Delete "${file.name}"?`)) return;
    try{
      await GH.deleteFile(file.path);
      toast('Deleted');
      await rebuildFiles();
      if (state.selected?.path === file.path) clearPreview();
    }catch(e){
      console.error(e);
      toast(e.message || 'Delete failed', false);
    }
  }

  async function renameFileFlow(file){
    const dot = file.name.lastIndexOf('.');
    const base = dot>0 ? file.name.slice(0,dot) : file.name;
    const ext  = dot>0 ? file.name.slice(dot)  : '';
    const newName = await promptNice('Rename file', 'Enter new file name', { value: base + ext });
    if (!newName || newName === file.name) return;

    const dir = (file.path || '').split('/').slice(0,-1).join('/');
    const newPath = (dir ? dir+'/' : '') + newName;
    try{
      await GH.rename(file.path, newPath);
      toast('Renamed');
      await rebuildFiles();
      const sel = state.files.find(x => x.path === newPath);
      if (sel) selectFile(sel);
    }catch(e){
      console.error(e);
      toast(e.message || 'Rename failed', false);
    }
  }

  /* ---------------------- Preview panel ---------------------- */

  /** Ensure header becomes: <div class="title">Preview</div><div class="actions">[raw][gh]</div> */
  function ensurePreviewHead(){
    const head = $('.preview-head');
    if (!head) return;

    // Create structure only once
    if (!$('.title', head) || !$('.actions', head)) {
      head.innerHTML = `
        <div class="title">Preview</div>
        <div class="actions"></div>
      `;
    }

    const actions = $('.actions', head);

    // Raw button
    let btnRaw = $('#btn-open-raw');
    if (!btnRaw) {
      btnRaw = document.createElement('button');
      btnRaw.id = 'btn-open-raw';
      btnRaw.type = 'button';
      btnRaw.title = 'Open raw in browser';
      btnRaw.className = 'btn xs ghost';
      btnRaw.innerHTML = `<span class="codicon codicon-link-external"></span>`;
      actions.appendChild(btnRaw);
    } else if (btnRaw.parentElement !== actions) {
      actions.appendChild(btnRaw);
    }

    // GitHub button
    let btnGh = $('#btn-open-gh');
    if (!btnGh) {
      btnGh = document.createElement('button');
      btnGh.id = 'btn-open-gh';
      btnGh.type = 'button';
      btnGh.title = 'Open on GitHub';
      btnGh.className = 'btn xs ghost';
      btnGh.innerHTML = `<span class="codicon codicon-github-inverted"></span>`;
      actions.appendChild(btnGh);
    }
  }

  /** Make stage wrapper stable; add palette + extended meta if missing */
  function ensurePreviewScaffold(){
    // Fixed stage
    const body = $('.preview-body');
    if (body && !$('.pv-stage', body)) {
      const stage = document.createElement('div');
      stage.className = 'pv-stage';
      const img = $('#preview-img') || (() => { const i=document.createElement('img'); i.id='preview-img'; i.alt='Preview'; return i; })();
      const ph  = $('#preview-empty') || (() => { const d=document.createElement('div'); d.id='preview-empty'; d.className='placeholder'; d.textContent='No image selected'; return d; })();
      body.innerHTML = '';
      stage.appendChild(img);
      stage.appendChild(ph);
      body.appendChild(stage);
    }

    // Meta block
    ensureMetaSection();
  }

  function ensureMetaSection(){
    const card = $('.preview-card');
    if (!card) return null;
    let meta = $('.preview-meta', card);
    if (!meta) {
      meta = document.createElement('div');
      meta.className = 'preview-meta';
      meta.innerHTML = `
        <div class="k" style="margin-bottom:6px;">Palette</div>
        <div id="pv-pal" class="palette"></div>
        <div class="meta-grid" style="margin-top:10px;">
          <div class="k">Name</div><div id="pv-name">—</div>
          <div class="k">Size</div><div id="pv-size">—</div>
          <div class="k">Type</div><div id="pv-type">—</div>
          <div class="k">Dimensions</div><div id="pv-dim">—</div>
          <div class="k">Aspect</div><div id="pv-aspect">—</div>
          <div class="k">Path</div><div id="pv-path" style="word-break:break-all">—</div>
        </div>
      `;
      card.appendChild(meta);
    }
    return meta;
  }

  function clearPreview(){
    ensurePreviewHead();
    ensurePreviewScaffold();

    $('#preview-img').style.display = 'none';
    $('#preview-empty').style.display = 'flex';
    $('#btn-open-raw')?.setAttribute('disabled','true');
    $('#btn-open-gh')?.setAttribute('disabled','true');
    ['#link-raw','#link-md','#link-html','#link-blob'].forEach(s => $(s).value='');

    $('#pv-name') && ($('#pv-name').textContent='—');
    $('#pv-size') && ($('#pv-size').textContent='—');
    $('#pv-dim')  && ($('#pv-dim').textContent='—');
    $('#pv-aspect') && ($('#pv-aspect').textContent='—');
    $('#pv-path') && ($('#pv-path').textContent='—');
    $('#pv-type') && ($('#pv-type').textContent='—');
    const pal = $('#pv-pal'); if (pal) pal.innerHTML = '';
  }

  function selectFile(file){
    ensurePreviewHead();
    ensurePreviewScaffold();

    const img = $('#preview-img');
    const empty = $('#preview-empty');
    const btnRaw = $('#btn-open-raw');
    const btnGh  = $('#btn-open-gh');

    const raw = file.download_url || file.raw || '';
    const blob = file.html_url || file.blob || (raw ? raw.replace('raw.githubusercontent.com','github.com').replace(/\/([^/]+)$/, '/blob/$1') : '');

    $('#link-raw').value  = raw;
    $('#link-md').value   = `![${file.name}](${raw})`;
    $('#link-html').value = `<img src="${raw}" alt="${file.name}">`;
    $('#link-blob').value = blob;

    $('#pv-name') && ($('#pv-name').textContent = file.name || '—');
    $('#pv-size') && ($('#pv-size').textContent = fmtBytes(file.size));
    $('#pv-path') && ($('#pv-path').textContent = file.path || '—');
    $('#pv-type') && ($('#pv-type').textContent = (file.name?.split('.').pop() || '').toUpperCase() || '—');
    $('#pv-dim')  && ($('#pv-dim').textContent = '—');
    $('#pv-aspect') && ($('#pv-aspect').textContent = '—');
    const pal = $('#pv-pal'); if (pal) pal.innerHTML = '';

    img.onload = () => {
      img.style.display = 'block';
      empty.style.display = 'none';

      const w = img.naturalWidth, h = img.naturalHeight;
      $('#pv-dim') && ($('#pv-dim').textContent = `${w} × ${h}`);
      const g = gcd(w,h);
      $('#pv-aspect') && ($('#pv-aspect').textContent = `${w/g}:${h/g} (${(w/h).toFixed(3)})`);

      // Palette
      const colors = extractPaletteFromImage(img, 6);
      if (pal){
        pal.innerHTML = '';
        colors.forEach(hex => {
          const sw = document.createElement('div');
          sw.className = 'sw';
          sw.title = hex;
          sw.style.background = hex;
          sw.addEventListener('click', () => copyText(hex));
          pal.appendChild(sw);
        });
      }
    };
    img.onerror = () => { img.style.display='none'; empty.style.display='flex'; };
    img.src = raw;

    if (btnRaw){
      btnRaw.removeAttribute('disabled');
      btnRaw.onclick = () => window.open(raw, '_blank', 'noreferrer');
    }
    if (btnGh){
      btnGh.removeAttribute('disabled');
      btnGh.onclick = () => window.open(blob, '_blank', 'noreferrer');
    }

    // copy buttons near inputs
    $$('[data-copy]').forEach(btn => {
      const inp = $(btn.getAttribute('data-copy'));
      btn.onclick = () => copyText(inp?.value || '');
    });

    state.selected = file;
  }

  /* ---------------------- small modal prompt ---------------------- */
  function promptNice(title, subtitle, { value='', placeholder='' } = {}){
    return new Promise(resolve => {
      const dlg = document.createElement('dialog');
      dlg.className = 'modal';
      dlg.innerHTML = `
        <form method="dialog" class="modal-card" style="max-width:520px">
          <div class="dialog-titlebar modal-titlebar">
            <div class="dtb-left"><span class="codicon codicon-edit"></span></div>
            <div class="dtb-center"><span class="about-window-title">${title}</span></div>
            <div class="dtb-right"><button type="button" class="tb-btn tb-close"><span class="codicon codicon-close"></span></button></div>
          </div>
          <section class="modal-body">
            <div class="field">
              <label>${subtitle || ''}</label>
              <input id="pnv" type="text" placeholder="${placeholder}" value="${value}">
            </div>
          </section>
          <footer class="modal-foot">
            <div class="spacer"></div>
            <button class="btn ghost" value="cancel" type="button">Cancel</button>
            <button class="btn primary" value="ok" type="submit">OK</button>
          </footer>
        </form>`;
      document.body.appendChild(dlg);
      const close = () => { dlg.close(); dlg.remove(); };
      $('.tb-close', dlg).onclick = close;
      $('[value="cancel"]', dlg).onclick = close;
      dlg.addEventListener('close', () => resolve(undefined));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
      dlg.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const v = $('#pnv', dlg).value.trim();
        close();
        resolve(v || undefined);
      });
      dlg.showModal();
      $('#pnv', dlg).focus();
      $('#pnv', dlg).select();
    });
  }

  function openAbout(){
  const dlg = $('#dlg-about');
  if (!dlg) return;

  // Fill version
  $('#app-version') && IPC.call('app:getVersion').then(v => $('#app-version').textContent = v || '');

  // Fill repo meta from saved settings
  (async () => {
    try {
      const s = await IPC.call('settings:get');
      const o = s.owner || '—';
      const r = s.repo || '—';
      const b = s.branch || '—';
      const root = s.rootDir || '—';

      const $set = (id, text, href) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (href) { el.href = href; el.textContent = text; }
        else el.textContent = text;
      };

      $set('about-owner', o, o !== '—' ? `https://github.com/${o}` : null);
      $set('about-repo', r, (o !== '—' && r !== '—') ? `https://github.com/${o}/${r}` : null);
      document.getElementById('about-branch').textContent = b;
      document.getElementById('about-root').textContent = root;
    } catch {}
  })();

  $('#about-open-settings')?.addEventListener('click', () => Settings?.open?.());
  $('#about-close')?.addEventListener('click', () => dlg.close());
  dlg.showModal();
}


  /* ---------------------- View toggle ---------------------- */
  function wireViewToggle(){
    const wrap = $('#view-toggle');
    if (!wrap) return;
    const buttons = $$('.seg', wrap);
    const apply = () => {
      buttons.forEach(b => b.classList.toggle('active', b.dataset.mode === state.view));
      localStorage.setItem('view', state.view);
      rebuildFiles();
    };
    buttons.forEach(b => b.addEventListener('click', () => {
      state.view = b.dataset.mode;
      apply();
    }));
    apply();
  }

  /* ---------------------- sidebar search / toolbar buttons ----------- */
  function wireSidebar(){
    $('#search-folders')?.addEventListener('input', () => rebuildTree());
    $('#btn-new-folder')?.addEventListener('click', () => newFolderFlow());
    $('#btn-refresh')?.addEventListener('click', rebuildEverything);
  }

  /* ---------------------- global keyboard shortcuts ------------------ */
  function wireShortcuts(){
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'u') { e.preventDefault(); IPC.call('window:open-upload'); }
      if (e.ctrlKey && !e.shiftKey && e.key === ',') { e.preventDefault(); Settings?.open?.(); }
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); IPC.call('app:reload'); }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); IPC.call('devtools:toggle'); }
    });

    IPC.on?.('menu:open-settings', () => Settings?.open?.());
    IPC.on?.('menu:open-uploader', () => IPC.call('window:open-upload'));
    IPC.on?.('menu:open-about', openAbout);
    IPC.on?.('upload:completed', () => rebuildFiles());
  }

  /* ---------------------- init everything ---------------------- */
  async function rebuildEverything(){
    await rebuildTree();
    await rebuildFiles();
    ensurePreviewHead();
    ensurePreviewScaffold();
  }

  async function init(){
    wireTitlebar();
    wireMenubar();
    wireViewToggle();
    wireSidebar();
    wireShortcuts();
    Settings?.init?.();

    try { await Settings?.prefill?.(); } catch {}
    await rebuildEverything();

    $$('[data-copy]').forEach(btn => {
      const sel = btn.getAttribute('data-copy');
      btn.addEventListener('click', () => {
        const el = $(sel);
        if (el) copyText(el.value || '');
      });
    });
  }

  init();
})();
