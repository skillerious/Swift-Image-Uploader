/* upload.js — uploader window */

const $  = (s, c=document) => c.querySelector(s);
const $$ = (s, c=document) => Array.from(c.querySelectorAll(s));

const ui = {
  close:   $('#up-close'),
  dz:      $('#dropzone'),
  browse:  $('#btn-browse'),
  input:   $('#file-input'),

  target:  $('#u-target-folder'),
  threads: $('#u-threads'),
  start:   $('#u-start'),

  list:    $('#u-list'),
  empty:   $('#queue-empty'),
};

const state = {
  queue: [],
  running: 0,
  nextId: 1
};

const ALLOWED = /\.(png|jpe?g|gif|bmp|webp|tiff?|svg)$/i;

const fmtSize = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1048576).toFixed(1)} MB`;

function setEmptyVisible(show){ ui.empty.style.display = show ? 'flex' : 'none'; }
function toast(text){
  try { const t = window.opener?.document?.getElementById('toast'); if (t){ t.textContent = text; t.style.display='block'; setTimeout(()=>t.style.display='none',2000); } } catch {}
}

// render queue
function renderQueue(){
  ui.list.innerHTML = '';
  setEmptyVisible(state.queue.length === 0);

  for (const item of state.queue){
    const li = document.createElement('li');
    li.className = 'qi';
    li.dataset.id = item.id;
    li.innerHTML = `
      <div class="thumb"><span class="codicon codicon-file-media"></span></div>
      <div class="meta">
        <div class="name" title="${item.name}">${item.name}</div>
        <div class="sub">${fmtSize(item.size)} • ${item.type || 'image'}</div>
        <div class="status"><span class="chip st-queued" data-chip>Queued</span></div>
        <div class="progress"><div class="bar" style="width:0%"></div></div>
        <div class="links" hidden>
          <input class="out-url" readonly />
          <button class="btn xs ghost" data-copy title="Copy link"><span class="codicon codicon-clippy"></span></button>
          <a class="btn xs ghost" data-open target="_blank" rel="noreferrer" title="Open"><span class="codicon codicon-link-external"></span></a>
        </div>
      </div>
      <div class="right">
        <button class="btn xs ghost" data-remove title="Remove"><span class="codicon codicon-trash"></span></button>
        <button class="btn xs ghost" data-retry disabled title="Retry"><span class="codicon codicon-debug-restart"></span></button>
      </div>
    `;

    // preview thumb
    const thumb = li.querySelector('.thumb');
    const icon  = thumb.querySelector('.codicon');
    if (item.file && item.file.type !== 'image/svg+xml'){
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => { thumb.innerHTML=''; thumb.appendChild(img); };
        img.src = e.target.result;
      };
      reader.readAsDataURL(item.file);
    } else {
      icon.style.opacity = '.7';
    }

    li.querySelector('[data-remove]').addEventListener('click', () => removeItem(item.id));
    li.querySelector('[data-retry]').addEventListener('click', () => retryItem(item.id));
    li.querySelector('[data-copy]').addEventListener('click', () => {
      const val = li.querySelector('.out-url').value || '';
      if (val) { window.api?.copyText?.(val); toast('Copied link.'); }
    });

    ui.list.appendChild(li);
  }
}

function updateItemUI(id, {status, progress, link}){
  const li = ui.list.querySelector(`.qi[data-id="${id}"]`);
  if (!li) return;
  if (progress != null) li.querySelector('.bar').style.width = Math.max(1, Math.min(100, progress)) + '%';
  if (status){
    const chip = li.querySelector('[data-chip]');
    chip.className = 'chip ' + ({ queued:'st-queued', uploading:'st-uploading', done:'st-done', error:'st-error' }[status] || 'st-queued');
    chip.textContent = ({ queued:'Queued', uploading:'Uploading…', done:'Uploaded', error:'Failed' }[status] || 'Queued');
    li.querySelector('[data-retry]').disabled = (status !== 'error');
  }
  if (link){
    const links = li.querySelector('.links');
    links.hidden = false;
    li.querySelector('.out-url').value = link.raw || '';
    li.querySelector('[data-open]').href = link.raw || '#';
  }
}

function removeItem(id){
  const idx = state.queue.findIndex(q => q.id === id);
  if (idx >= 0){ state.queue.splice(idx, 1); renderQueue(); }
}
function retryItem(id){
  const item = state.queue.find(q => q.id === id);
  if (item && item.status === 'error'){
    item.status = 'queued'; item.progress = 0;
    updateItemUI(id, {status:'queued', progress:0});
    pump();
  }
}

// add files
function addFiles(files){
  const arr = Array.from(files || []).filter(f => ALLOWED.test(f.name));
  if (!arr.length){ toast('No supported images in selection.'); return; }
  for (const f of arr){
    state.queue.push({ id: state.nextId++, file: f, name: f.name, size: f.size, type: f.type, status: 'queued', progress: 0 });
  }
  renderQueue();
}

// dropzone
function wireDropzone(){
  ui.dz.addEventListener('dragover', e => { e.preventDefault(); ui.dz.classList.add('dragover'); });
  ui.dz.addEventListener('dragleave', () => ui.dz.classList.remove('dragover'));
  ui.dz.addEventListener('drop', e => { e.preventDefault(); ui.dz.classList.remove('dragover'); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });
  ui.browse.addEventListener('click', ()=> ui.input.click());
  ui.input.addEventListener('change', ()=> { addFiles(ui.input.files); ui.input.value = ''; });
}

// upload logic
function readAsBase64(file, onProgress){
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error || new Error('read error'));
    fr.onprogress = e => { if (e.lengthComputable && typeof onProgress === 'function') onProgress(Math.round(e.loaded / e.total * 100)); };
    fr.onload = () => { const res = fr.result || ''; const base64 = String(res).split(',')[1] || ''; resolve(base64); };
    fr.readAsDataURL(file);
  });
}
async function uploadOne(item, targetDir){
  try{
    updateItemUI(item.id, {status:'uploading', progress:1});
    const base64Content = await readAsBase64(item.file, p => updateItemUI(item.id, {progress:p}));
    const link = await window.api.upload({ targetDir, filename:item.name, base64Content, commitMessage:`feat: upload ${item.name}` });
    item.status = 'done'; item.progress = 100; item.result = link;
    updateItemUI(item.id, {status:'done', progress:100, link});
  }catch(err){
    item.status = 'error';
    updateItemUI(item.id, {status:'error'});
    console.error('Upload failed', err);
  }
}
function pump(){
  const limit = Math.max(1, parseInt(ui.threads.value || '2', 10));
  while (state.running < limit){
    const next = state.queue.find(q => q.status === 'queued');
    if (!next) break;
    state.running++;
    uploadOne(next, ui.target.value).finally(()=>{
      state.running--;
      if (!state.queue.find(q => q.status === 'queued' || q.status === 'uploading')){
        try { window.api?.notifyUploaded?.(); } catch {}
      }
      pump();
    });
  }
}

function wireActions(){
  ui.start.addEventListener('click', () => {
    if (!state.queue.length){ toast('Queue is empty.'); return; }
    pump();
  });
  ui.close.addEventListener('click', () => window.close());

  const savedThreads = localStorage.getItem('upload_threads');
  if (savedThreads) ui.threads.value = savedThreads;
  ui.threads.addEventListener('change', () => localStorage.setItem('upload_threads', ui.threads.value));
}

// init
(async function init(){
  try{
    const dirs = await window.api.listDirs();
    ui.target.innerHTML = '';
    dirs.forEach(d => { const opt = document.createElement('option'); opt.value = d; opt.textContent = d; ui.target.appendChild(opt); });
    const pick = localStorage.getItem('u_target_folder');
    if (pick && dirs.includes(pick)) ui.target.value = pick;
    ui.target.addEventListener('change', () => localStorage.setItem('u_target_folder', ui.target.value));
  }catch(e){ console.warn('List dirs failed', e); }

  wireDropzone();
  wireActions();
})();
