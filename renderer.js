// ---------------- Tiny DOM helpers ----------------
const $  = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

// ---------------- UI Refs ----------------
const ui = {
  titlebar: $('#titlebar'),
  // window controls
  winMin: $('#win-min'), winMax: $('#win-max'), winMaxIc: $('#win-max-ic'), winClose: $('#win-close'),
  // menubar
  mFileUpload: $('#m-file-upload'), mFileSettings: $('#m-file-settings'),
  mFileRefresh: $('#m-file-refresh'), mFileExit: $('#m-file-exit'),
  mViewReload: $('#m-view-reload'), mViewDevtools: $('#m-view-devtools'),
  mHelpAbout: $('#m-help-about'),
  // sidebar + center
  tree: $('#folder-tree'), search: $('#search-folders'),
  newFolder: $('#btn-new-folder'), refresh: $('#btn-refresh'),
  targetSelect: $('#target-folder'), filesGrid: $('#files-grid'),
  viewToggle: $('#view-toggle'), openUploader: $('#btn-open-uploader'),
  // preview
  previewImg: $('#preview-img'), previewEmpty: $('#preview-empty'),
  linkRaw: $('#link-raw'), linkMD: $('#link-md'), linkHTML: $('#link-html'), linkBlob: $('#link-blob'),
  btnOpenRaw: $('#btn-open-raw'),
  // dialogs
  dlgAbout: $('#dlg-about'), toast: $('#toast')
};

// ---------------- Local state ----------------
let state = {
  dirs: [],
  activeDir: '',
  viewMode: localStorage.getItem('viewMode') || 'grid'
};

// ---------------- Toast ----------------
function toast(msg, ok=true){
  ui.toast.textContent = msg;
  ui.toast.style.borderColor = ok ? 'var(--border)' : 'var(--danger)';
  ui.toast.style.display = 'block';
  clearTimeout(ui.toast._t);
  ui.toast._t = setTimeout(()=> ui.toast.style.display='none', 2400);
}

// ---------------- Clipboard helper ----------------
function copyText(textOrSelector){
  let text = textOrSelector;
  if (typeof textOrSelector === 'string' && textOrSelector.startsWith('#')) {
    const el = $(textOrSelector); if (!el) return;
    text = el.value || '';
  }
  try { window.api?.copyText?.(text); }
  catch {
    const ta=document.createElement('textarea');
    ta.value=text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  toast('Copied to clipboard.');
}

// ---------------- Window controls ----------------
function setMaxIcon(isMax){
  if (!ui.winMaxIc) return;
  ui.winMaxIc.classList.remove('codicon-chrome-maximize','codicon-chrome-restore');
  ui.winMaxIc.classList.add(isMax ? 'codicon-chrome-restore' : 'codicon-chrome-maximize');
}
function wireWindowControls(){
  if (!window.api) return;
  ui.winMin?.addEventListener('click', ()=> window.api.winMinimize());
  ui.winMax?.addEventListener('click', ()=> window.api.winMaximize());
  ui.winClose?.addEventListener('click', ()=> window.api.winClose());
  window.api.winIsMaximized().then(setMaxIcon).catch(()=>{});
  window.api.onWinMaxState?.(v => setMaxIcon(!!v));
  ui.titlebar?.addEventListener('dblclick', (e)=>{
    if (!e.target.closest('.no-drag')) window.api?.winMaximize?.();
  });
}

// ---------------- Menubar ----------------
function closeMenus(){
  $$('.menubar .menu').forEach(m=>{
    m.classList.remove('open');
    m.querySelector('.menu-btn')?.setAttribute('aria-expanded','false');
  });
}
function toggleMenu(el, open){
  if (open===undefined) open=!el.classList.contains('open');
  closeMenus();
  if (open){
    el.classList.add('open');
    el.querySelector('.menu-btn')?.setAttribute('aria-expanded','true');
  }
}
function wireMenubar(){
  $$('.menubar .menu').forEach(m => {
    const btn = m.querySelector('.menu-btn');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu(m);
    });
  });

  document.addEventListener('click', e=>{
    if(!e.target.closest('.menubar')) closeMenus();
  });
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape') closeMenus();
  });

  ui.mFileUpload?.addEventListener('click', ()=>{ closeMenus(); openUploader(); });
  ui.mFileSettings?.addEventListener('click', ()=>{ closeMenus(); window.Settings.open(); });
  ui.mFileRefresh?.addEventListener('click', ()=>{ closeMenus(); refreshDirs(state.activeDir); });
  ui.mFileExit?.addEventListener('click', ()=>{ closeMenus(); window.api?.appQuit?.(); });

  ui.mViewReload?.addEventListener('click', ()=>{ closeMenus(); window.api?.appReload?.(); });
  ui.mViewDevtools?.addEventListener('click', ()=>{ closeMenus(); window.api?.toggleDevTools?.(); });

  ui.mHelpAbout?.addEventListener('click', ()=>{ closeMenus(); openAbout(); });

  // relays from native menu (preload exposes these)
  window.api?.onOpenSettings?.(()=> window.Settings.open());
  window.api?.onOpenAbout?.(()=> openAbout());
  window.api?.onOpenUpload?.(()=> openUploader());
}

// ---------------- Settings fallback (if settings.js isn’t loaded yet) ----------------
if (!window.Settings) {
  window.Settings = (() => {
    let cache = { owner:'', repo:'', branch:'main', rootDir:'images', defaultSelect:'' };
    async function prefill(){
      try{
        const s = await window.api.getSettings();
        cache.owner  = s.owner || '';
        cache.repo   = s.repo  || '';
        cache.branch = s.branch|| 'main';
        cache.rootDir= s.rootDir|| 'images';
        cache.defaultSelect = localStorage.getItem('defaultSelect') || '';
      }catch{}
    }
    return {
      init(){},
      async prefill(){ await prefill(); },
      open(){ /* settings.js handles real dialog */ },
      getOwner(){ return cache.owner; },
      getRepo(){ return cache.repo; },
      getBranch(){ return cache.branch; },
      getRoot(){ return cache.rootDir; },
      getDefaultSelect(){ return cache.defaultSelect; }
    };
  })();
}

// ---------------- About ----------------
async function openAbout(){
  if (!window.api) return;
  $('#app-version').textContent = await window.api.appVersion();
  $('#about-owner').textContent  = window.Settings.getOwner() || '—';

  const owner = window.Settings.getOwner();
  const repo  = window.Settings.getRepo();
  $('#about-repo').innerHTML = owner && repo
    ? `<a href="https://github.com/${owner}/${repo}" target="_blank" rel="noreferrer">${repo}</a>`
    : '—';

  $('#about-branch').textContent = window.Settings.getBranch() || '—';
  $('#about-root').textContent   = window.Settings.getRoot()   || '—';
  ui.dlgAbout.showModal();
}

// ---------------- Tree building ----------------
function buildTreeNodes(paths){
  const root = {};
  for (const p of paths){
    const parts = p.split('/').filter(Boolean);
    let cur = root;
    for (const part of parts){
      cur.children = cur.children || {};
      cur.children[part] = cur.children[part] || {};
      cur = cur.children[part];
    }
  }
  function render(node, base=''){
    const frag = document.createDocumentFragment();
    const kids = node.children ? Object.keys(node.children).sort((a,b)=>a.localeCompare(b)) : [];
    for (const name of kids){
      const full = base ? `${base}/${name}` : name;
      const el = document.createElement('div');
      el.className = 'node';
      el.dataset.path = full;
      el.innerHTML = `<span class="codicon codicon-folder"></span><span class="label" title="${full}">${name}</span>`;
      el.addEventListener('click', ()=> selectDir(full, el));
      frag.appendChild(el);
      const sub = render(node.children[name], full);
      if (sub.childElementCount){ sub.style.marginLeft='16px'; frag.appendChild(sub); }
    }
    const wrap = document.createElement('div'); wrap.appendChild(frag); return wrap;
  }
  const c = document.createElement('div'); c.appendChild(render(root)); return c;
}
function renderTree(){
  ui.tree.innerHTML = '';
  const term = ui.search.value.trim().toLowerCase();
  const list = term ? state.dirs.filter(d => d.toLowerCase().includes(term)) : state.dirs;
  ui.tree.appendChild(buildTreeNodes(list.slice()));
}
async function refreshDirs(selectAfter = null){
  if (!window.api) return;
  try{
    const dirs = await window.api.listDirs();
    state.dirs = dirs;
    renderTree();

    // refresh selector
    ui.targetSelect.innerHTML = '';
    for (const d of dirs){
      const opt = document.createElement('option'); opt.value=d; opt.textContent=d;
      ui.targetSelect.appendChild(opt);
    }

    const def = selectAfter || (dirs.find(d => d === (window.Settings?.getDefaultSelect() || '')) || dirs[0] || '');
    if (def){
      ui.targetSelect.value = def;
      const node = $(`.tree .node[data-path="${CSS.escape(def)}"]`);
      if (node) node.click(); else { state.activeDir = def; loadFilesInDir(def); }
    }
  }catch(e){ console.error(e); toast(e.message || 'Failed to load directories', false); }
}
async function selectDir(dir, el){
  $$('.tree .node').forEach(n => n.classList.remove('active'));
  el?.classList.add('active');
  state.activeDir = dir;
  ui.targetSelect.value = dir;
  await loadFilesInDir(dir);
}

// ---------------- Files (grid/list) ----------------
const isImg = (n) => /\.(png|jpe?g|gif|bmp|webp|tiff?|svg)$/i.test(n||'');

function buildCard({ name, path }){
  const owner=window.Settings.getOwner(), repo=window.Settings.getRepo(), branch=encodeURIComponent(window.Settings.getBranch());
  const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const blob= `https://github.com/${owner}/${repo}/blob/${branch}/${path}`;
  const card = document.createElement('div'); card.className='file-card';
  card.innerHTML = `
    <div class="file-thumb"><img loading="lazy" src="${raw}" alt="${name}"></div>
    <div class="file-name" title="${name}">${name}</div>
    <div class="file-actions">
      <button class="btn xs ghost" data-act="preview" title="Preview"><span class="codicon codicon-eye"></span></button>
      <button class="btn xs ghost" data-act="copy" title="Copy raw URL"><span class="codicon codicon-clippy"></span></button>
      <a class="btn xs ghost" href="${raw}" target="_blank" rel="noreferrer" title="Open raw"><span class="codicon codicon-link-external"></span></a>
    </div>`;
  card.querySelector('[data-act="preview"]').addEventListener('click', ()=> setPreview({ raw, blob, markdown:`![${name}](${raw})`, html:`<img src="${raw}" alt="${name}">` }));
  card.querySelector('[data-act="copy"]').addEventListener('click', ()=> copyText(raw));
  return card;
}
function buildRow({ name, path }){
  const owner=window.Settings.getOwner(), repo=window.Settings.getRepo(), branch=encodeURIComponent(window.Settings.getBranch());
  const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const blob= `https://github.com/${owner}/${repo}/blob/${branch}/${path}`;
  const row = document.createElement('div'); row.className='file-row';
  row.innerHTML = `
    <div class="row-thumb"><img loading="lazy" src="${raw}" alt="${name}"></div>
    <div class="row-name" title="${name}">${name}</div>
    <div class="row-actions">
      <button class="btn xs ghost" data-act="preview" title="Preview"><span class="codicon codicon-eye"></span></button>
      <button class="btn xs ghost" data-act="copy" title="Copy raw URL"><span class="codicon codicon-clippy"></span></button>
      <a class="btn xs ghost" href="${raw}" target="_blank" rel="noreferrer" title="Open raw"><span class="codicon codicon-link-external"></span></a>
    </div>`;
  row.querySelector('[data-act="preview"]').addEventListener('click', ()=> setPreview({ raw, blob, markdown:`![${name}](${raw})`, html:`<img src="${raw}" alt="${name}">` }));
  row.querySelector('[data-act="copy"]').addEventListener('click', ()=> copyText(raw));
  return row;
}
async function loadFilesInDir(dir){
  ui.filesGrid.innerHTML = '';
  if (!window.api) return;
  try{
    const files = (await window.api.listFiles(dir)).filter(f => isImg(f.name));
    ui.filesGrid.className = 'files-grid' + (state.viewMode==='list' ? ' list' : '');
    if (!files.length){
      ui.filesGrid.innerHTML = `<div class="placeholder" style="padding:20px;">No images in <code>${dir}</code>.</div>`;
      return;
    }
    if (state.viewMode==='grid') files.forEach(f => ui.filesGrid.appendChild(buildCard(f)));
    else files.forEach(f => ui.filesGrid.appendChild(buildRow(f)));
  }catch(e){ console.error(e); }
}

// ---------------- Preview ----------------
function setPreview(links){
  if (!links){
    ui.previewImg.style.display='none';
    ui.previewEmpty.style.display='block';
    ui.linkRaw.value=ui.linkMD.value=ui.linkHTML.value=ui.linkBlob.value='';
    ui.btnOpenRaw.disabled = true; return;
  }
  ui.previewImg.src = links.raw;
  ui.previewImg.style.display='inline-block';
  ui.previewEmpty.style.display='none';
  ui.linkRaw.value = links.raw||'';
  ui.linkMD.value  = links.markdown||'';
  ui.linkHTML.value= links.html||'';
  ui.linkBlob.value= links.blob||'';
  ui.btnOpenRaw.disabled = !links.raw;
  ui.btnOpenRaw.onclick = () => window.open(links.raw,'_blank');
}

// ---------------- New folder dialog (replaces window.prompt) ----------------
let newFolderDlg;
function ensureNewFolderDialog(){
  if (newFolderDlg) return newFolderDlg;
  const markup = `
    <dialog id="dlg-new-folder" class="modal">
      <form method="dialog" class="modal-card">
        <header class="modal-head">
          <h3><span class="codicon codicon-new-folder"></span> New Folder</h3>
        </header>
        <section class="modal-body">
          <div class="field">
            <label>Base path</label>
            <input id="nf-base" type="text" readonly />
          </div>
          <div class="field">
            <label>Folder name (relative)</label>
            <input id="nf-name" type="text" placeholder="e.g. avatars/2025" autocomplete="off" />
          </div>
          <small id="nf-preview"></small>
        </section>
        <footer class="modal-foot">
          <button id="nf-cancel" class="btn ghost" type="button">Cancel</button>
          <button id="nf-create" class="btn primary" type="button">Create</button>
        </footer>
      </form>
    </dialog>`;
  document.body.insertAdjacentHTML('beforeend', markup);
  newFolderDlg = $('#dlg-new-folder');
  return newFolderDlg;
}
async function openNewFolderDialog(){
  const dlg = ensureNewFolderDialog();
  const base = ui.targetSelect.value || (window.Settings?.getRoot() || 'images');
  const baseEl = $('#nf-base', dlg);
  const nameEl = $('#nf-name', dlg);
  const prevEl = $('#nf-preview', dlg);
  const cancel = $('#nf-cancel', dlg);
  const create = $('#nf-create', dlg);

  baseEl.value = base;
  nameEl.value = '';
  prevEl.textContent = '';

  const updatePreview = () => {
    const v = (nameEl.value || '').replace(/^\/+|\/+$/g,'');
    const full = v.startsWith('.') || !v ? base : (v.includes('/') || !base) ? `${v}` : `${base}/${v}`;
    prevEl.textContent = `Will create: ${full}`;
  };

  nameEl.oninput = updatePreview;
  updatePreview();

  const close = () => dlg.close();
  cancel.onclick = close;

  create.onclick = async () => {
    const v = (nameEl.value || '').trim();
    if (!v) { nameEl.focus(); return; }
    const cleaned = v.replace(/^\/+|\/+$/g,'');
    const full = (cleaned.includes('/') || !base) ? cleaned : `${base}/${cleaned}`;
    try{
      await window.api.createDir(full);
      close();
      await refreshDirs(full);
      toast(`Folder created: ${full}`);
    }catch(err){
      console.error(err);
      toast(err?.message || 'Failed to create folder', false);
    }
  };

  dlg.showModal();
}

// ---------------- Actions ----------------
function openUploader(){ window.api?.openUpload?.(); }
function setViewMode(mode){
  state.viewMode = mode; localStorage.setItem('viewMode', mode);
  $$('#view-toggle .seg').forEach(b => {
    const active = b.dataset.mode === mode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  loadFilesInDir(state.activeDir);
}

// ensure the grid toggle always has an icon (fallback when codicon not present)
function ensureGridIcon(){
  const btn = $('#view-toggle .seg[data-mode="grid"]');
  if (!btn) return;
  const hasCodicon = btn.querySelector('.codicon');
  if (!hasCodicon){
    btn.innerHTML = '<span class="grid-ico"><i></i><i></i><i></i><i></i></span>';
  }
}

// ---------------- Wiring ----------------
function wireCore(){
  wireMenubar(); wireWindowControls();

  ui.viewToggle?.addEventListener('click', (e)=>{
    const btn = e.target.closest('.seg'); if(btn) setViewMode(btn.dataset.mode);
  });

  // New folder dialog (no prompt)
  ui.newFolder?.addEventListener('click', async (e)=>{
    e.stopPropagation();
    await openNewFolderDialog();
  });

  ui.refresh?.addEventListener('click', ()=> refreshDirs(state.activeDir));
  ui.search?.addEventListener('input', renderTree);
  ui.targetSelect?.addEventListener('change', e=> selectDir(e.target.value));
  ui.openUploader?.addEventListener('click', openUploader);

  // Copy buttons below Preview
  $$('[data-copy]').forEach(btn => btn.addEventListener('click', ()=> copyText(btn.getAttribute('data-copy'))));

  // After uploads complete from upload window
  window.api?.onUploaded?.(()=> refreshDirs(state.activeDir));
}

// ---------------- Init ----------------
(async function init(){
  try{
    window.Settings?.init?.();
    wireCore();
    if (!window.api){ toast('Preload bridge not loaded (window.api missing).', false); return; }
    await window.Settings.prefill();
    ensureGridIcon();
    setViewMode(state.viewMode);
    await refreshDirs();
  }catch(e){ console.warn('Init warning:', e?.message || e); }
  setPreview(null);
})();
