const $ = (s, c=document)=>c.querySelector(s);
const $$ = (s, c=document)=>Array.from(c.querySelectorAll(s));

const ui = {
  titlebar: $('#titlebar'),
  dropzone: $('#dropzone'),
  browse: $('#btn-browse'),
  targetSelect: $('#target-folder'),
  concurrency: $('#concurrency'),
  upload: $('#btn-upload'),
  queueList: $('#queue-list'),
  toast: $('#toast'),
  close: $('#win-close')
};

let queue = []; // items: { id, name, size, dataURL, base64, status, progress, error }
let active = 0;
let MAX_CONCURRENCY = parseInt(ui.concurrency.value, 10);

// ---------- helpers ----------
function toast(msg, ok=true){
  ui.toast.textContent = msg;
  ui.toast.style.borderColor = ok ? 'var(--border)' : 'var(--danger)';
  ui.toast.style.display = 'block';
  clearTimeout(ui.toast._t);
  ui.toast._t = setTimeout(()=> ui.toast.style.display='none', 2400);
}
function kb(v){ return (v/1024).toFixed(1) + ' KB'; }
function genId(){ return Math.random().toString(36).slice(2,9); }

// ---------- queue UI ----------
function mkItemEl(item){
  const li = document.createElement('li');
  li.className = 'qi';
  li.dataset.id = item.id;
  li.innerHTML = `
    <div class="thumb"><img src="${item.dataURL}"></div>
    <div>
      <div class="name">${item.name}</div>
      <div class="meta">${kb(item.size)}</div>
      <div class="progress"><div class="bar" style="width:${item.progress||0}%"></div></div>
      <div class="status">${item.status || 'queued'}</div>
    </div>
    <div class="right">
      <button class="btn xs ghost" data-act="remove" title="Remove"><span class="codicon codicon-trash"></span></button>
    </div>
  `;
  li.querySelector('[data-act="remove"]').addEventListener('click', () => removeFromQueue(item.id));
  return li;
}
function renderQueue(){
  ui.queueList.innerHTML = '';
  queue.forEach(item => ui.queueList.appendChild(mkItemEl(item)));
}
function updateItemProgress(id, pct, status){
  const li = ui.queueList.querySelector(`.qi[data-id="${id}"]`);
  if (!li) return;
  const bar = li.querySelector('.bar');
  const st = li.querySelector('.status');
  if (typeof pct === 'number') bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  if (status) st.textContent = status;
}
function removeFromQueue(id){
  const idx = queue.findIndex(q => q.id === id);
  if (idx === -1) return;
  // don't allow removing items actively uploading
  if (queue[idx].status === 'uploading') return toast('Wait for upload to finish or pause (not implemented).', false);
  queue.splice(idx,1);
  renderQueue();
}

// ---------- selecting / preparing files ----------
function acceptFiles(fileList){
  const files = Array.from(fileList).filter(f => /(\.png|\.jpe?g|\.webp|\.gif|\.bmp|\.tiff?|\.svg)$/i.test(f.name));
  if (!files.length) return;
  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataURL = reader.result;
      const base64 = String(dataURL).split(',')[1];
      queue.push({ id: genId(), name: file.name, size: file.size, dataURL, base64, status: 'queued', progress: 0 });
      renderQueue();
    };
    reader.readAsDataURL(file);
  });
}

// ---------- threads / uploads ----------
function setConcurrency(v){
  MAX_CONCURRENCY = parseInt(v,10) || 3;
  pump();
}

async function startUpload(item){
  active++;
  item.status = 'uploading';
  updateItemProgress(item.id, 5, 'preparing…');

  // progress animation while waiting for network (fake but smooth)
  let pct = 5;
  const t = setInterval(() => {
    pct = Math.min(90, pct + Math.random()*4 + 1);
    updateItemProgress(item.id, pct);
  }, 180);

  try{
    const target = ui.targetSelect.value || '';
    const res = await window.api.upload({
      targetDir: target,
      filename: item.name,
      base64Content: item.base64,
      commitMessage: `feat: upload ${item.name}`
    });
    clearInterval(t);
    item.status = 'done';
    item.progress = 100;
    item.result = res;
    updateItemProgress(item.id, 100, 'done');
  }catch(e){
    clearInterval(t);
    console.error(e);
    item.status = 'error';
    item.error = e.message || 'Upload failed';
    updateItemProgress(item.id, 100, `error: ${item.error}`);
  }finally{
    active--;
    // when all done, tell main window to refresh
    if (queue.every(q => q.status !== 'uploading' && q.status !== 'queued')) {
      window.api.notifyUploaded?.();
    }
    pump();
  }
}

function pump(){
  // launch while we have capacity
  const uploading = queue.filter(q => q.status === 'uploading').length;
  active = uploading;
  const pend = queue.filter(q => q.status === 'queued');
  while (active < MAX_CONCURRENCY && pend.length){
    const item = pend.shift();
    startUpload(item);
  }
}

async function doUpload(){
  if (!queue.length) return toast('Queue is empty.', false);
  if (!ui.targetSelect.value) return toast('Pick a target folder.', false);
  pump();
}

// ---------- folders ----------
async function refreshDirs(){
  try{
    const dirs = await window.api.listDirs();
    ui.targetSelect.innerHTML = '';
    for (const d of dirs) {
      const opt = document.createElement('option'); opt.value=d; opt.textContent=d;
      ui.targetSelect.appendChild(opt);
    }
    const def = window.localStorage.getItem('defSelect') || dirs[0] || '';
    if (def) ui.targetSelect.value = def;
  }catch(e){ console.error(e); toast(e.message || 'Failed to load directories', false); }
}

// ---------- wiring ----------
function wire(){
  // titlebar close
  ui.close?.addEventListener('click', () => window.close());
  // double click maximize/restore for draggable area
  ui.titlebar?.addEventListener('dblclick', () => window.api?.winMaximize?.());

  // drag & drop
  ['dragenter','dragover','dragleave','drop'].forEach(eName => {
    document.addEventListener(eName, e => { e.preventDefault(); e.stopPropagation(); });
  });
  ['dragenter','dragover'].forEach(eName => {
    ui.dropzone.addEventListener(eName, () => ui.dropzone.classList.add('dragover'));
  });
  ['dragleave','drop'].forEach(eName => {
    ui.dropzone.addEventListener(eName, () => ui.dropzone.classList.remove('dragover'));
  });
  ui.dropzone.addEventListener('drop', (e) => acceptFiles(e.dataTransfer.files || []));

  // browse
  ui.browse.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept='image/*'; inp.multiple = true;
    inp.addEventListener('change', () => acceptFiles(inp.files));
    inp.click();
  });

  ui.upload.addEventListener('click', doUpload);
  ui.concurrency.addEventListener('change', e => setConcurrency(e.target.value));
}

(async function init(){
  wire();
  await refreshDirs();
})();
