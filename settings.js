(function(){
  const ui = {
    dlg: document.getElementById('dlg-settings'),
    tabs: Array.from(document.querySelectorAll('.tabs .tab')),
    panels: Array.from(document.querySelectorAll('.tabs .tab-panel')),
    btnSave: document.getElementById('btn-save'),
    btnCancel: document.getElementById('btn-cancel'),
    btnTest: document.getElementById('btn-test'),

    token: document.getElementById('set-token'),
    owner: document.getElementById('set-owner'),
    repo: document.getElementById('set-repo'),
    branch: document.getElementById('set-branch'),
    root: document.getElementById('set-root'),
    defaultSelect: document.getElementById('set-default-select'),

    name: document.getElementById('set-name'),
    email: document.getElementById('set-email'),
    rename: document.getElementById('set-rename'),

    theme: document.getElementById('set-theme'),
    uploadOpen: document.getElementById('set-upload-open')
  };

  function switchTab(id){
    ui.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === id));
    ui.panels.forEach(p => p.classList.toggle('active', p.dataset.panel === id));
  }

  function bindTabs(){
    ui.tabs.forEach(t => {
      // Make sure tabs never submit the dialog:
      t.setAttribute('type', 'button');
      t.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        switchTab(t.dataset.tab);
      });
    });
  }

  async function loadSettings() {
    const s = await window.api.getSettings();
    ui.owner.value = s.owner || '';
    ui.repo.value = s.repo || '';
    ui.branch.value = s.branch || 'main';
    ui.root.value = s.rootDir || 'images';
    ui.name.value = s.committerName || 'Swift Image Host';
    ui.email.value = s.committerEmail || '';
    ui.token.value = '';
    // extras (local, non-critical)
    ui.defaultSelect.value = localStorage.getItem('defSelect') || ui.root.value;
    ui.rename.value = localStorage.getItem('renameRule') || '{base}-{n}{ext}';
    ui.theme.value = localStorage.getItem('theme') || 'dark';
    ui.uploadOpen.value = localStorage.getItem('uploadOpen') || 'window';
  }

  async function saveSettings() {
    await window.api.saveSettings({
      owner: ui.owner.value.trim(),
      repo: ui.repo.value.trim(),
      branch: ui.branch.value.trim() || 'main',
      rootDir: ui.root.value.trim(),
      committerName: ui.name.value.trim(),
      committerEmail: ui.email.value.trim(),
      token: ui.token.value.trim() || undefined
    });
    localStorage.setItem('defSelect', ui.defaultSelect.value.trim() || '');
    localStorage.setItem('renameRule', ui.rename.value.trim() || '{base}-{n}{ext}');
    localStorage.setItem('theme', ui.theme.value);
    localStorage.setItem('uploadOpen', ui.uploadOpen.value);
  }

  async function testSettings() {
    try { const r = await window.api.testSettings(); toast(`Connected: ${r.repoName} (branch ok)`); }
    catch (e) { console.error(e); toast(e.message || 'Settings test failed', false); }
  }

  // Public API used by renderer.js
  window.Settings = {
    init(){
      bindTabs();
      ui.btnCancel.addEventListener('click', () => ui.dlg.close());
      ui.btnSave.addEventListener('click', async () => { await saveSettings(); ui.dlg.close(); });
      ui.btnTest.addEventListener('click', testSettings);
    },
    async prefill(){ await loadSettings(); },
    open(){ loadSettings().then(()=> ui.dlg.showModal()); },
    // getters used by renderer
    getOwner(){ return ui.owner.value.trim(); },
    getRepo(){ return ui.repo.value.trim(); },
    getBranch(){ return ui.branch.value.trim() || 'main'; },
    getRoot(){ return ui.root.value.trim() || 'images'; },
    getDefaultSelect(){ return localStorage.getItem('defSelect') || ''; }
  };

  function toast(msg, ok=true){
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.style.borderColor = ok ? 'var(--border)' : 'var(--danger)';
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(()=> el.style.display='none', 2400);
  }
})();
