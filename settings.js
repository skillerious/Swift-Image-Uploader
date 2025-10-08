(function () {
  /* ---------- UI refs ---------- */
  const ui = {
    dlg: document.getElementById('dlg-settings'),
    tabs: Array.from(document.querySelectorAll('.tabs .tab')),
    panels: Array.from(document.querySelectorAll('.tabs .tab-panel')),

    // Titlebar & footer buttons
    settingsClose: document.getElementById('settings-close'),
    btnSave: document.getElementById('btn-save'),
    btnCancel: document.getElementById('btn-cancel'),
    btnTest: document.getElementById('btn-test'),

    // Core GitHub settings
    token: document.getElementById('set-token'),
    owner: document.getElementById('set-owner'),
    repo: document.getElementById('set-repo'),
    branch: document.getElementById('set-branch'),
    root: document.getElementById('set-root'),
    defaultSelect: document.getElementById('set-default-select'),

    // Commit & naming
    name: document.getElementById('set-name'),
    email: document.getElementById('set-email'),
    rename: document.getElementById('set-rename'),

    // Uploader prefs
    threads: document.getElementById('set-threads'),
    uploadOpen: document.getElementById('set-upload-open'),
    autoCopy: document.getElementById('set-autocopy'),
    openAfter: document.getElementById('set-open-after'),

    // App & UI
    theme: document.getElementById('set-theme'),
    confirmExit: document.getElementById('set-confirm-exit'),

    // Advanced
    apiBase: document.getElementById('set-api-base'),
    safeMode: document.getElementById('set-safe-mode'),
    resetAll: document.getElementById('set-reset'),
  };

  /* ---------- State ---------- */
  let initialSnapshot = null; // for dirty-state detection
  let busy = false;
  const TOKEN_MASK = '••••••••••'; // what we show if a token exists
  let tokenSaved = false;          // whether a token is already persisted

  /* ---------- Helpers ---------- */

  const takeSnapshot = () => ({
    owner: ui.owner.value.trim(),
    repo: ui.repo.value.trim(),
    branch: ui.branch.value.trim(),
    rootDir: ui.root.value.trim(),
    committerName: ui.name.value.trim(),
    committerEmail: ui.email.value.trim(),
    token: ui.token.value.trim(),       // special handling on save
    defaultSelect: ui.defaultSelect.value.trim(),
    renameRule: ui.rename.value.trim(),
    theme: ui.theme.value,
    uploadOpen: ui.uploadOpen.value,
    threads: ui.threads?.value || '2',
    autoCopy: !!ui.autoCopy?.checked,
    openAfter: !!ui.openAfter?.checked,
    confirmExit: !!ui.confirmExit?.checked,
    apiBase: ui.apiBase?.value.trim(),
    safeMode: !!ui.safeMode?.checked,
  });

  const isDirty = () => {
    const now = takeSnapshot();
    const keys = Object.keys(initialSnapshot || {});
    return keys.some(k => {
      if (k === 'token') {
        // dirty only if user typed a *real* token (not mask) and non-empty
        const t = now.token;
        return !!t && t !== TOKEN_MASK;
      }
      return JSON.stringify(now[k]) !== JSON.stringify(initialSnapshot[k]);
    });
  };

  const setBusy = (flag) => {
    busy = !!flag;
    const controls = ui.dlg.querySelectorAll('input, select, button');
    controls.forEach(el => {
      if (el === ui.settingsClose) return; // keep close clickable
      el.disabled = busy;
    });

    // Only keep Save’s loading state. Test button never spins now.
    toggleLoading(ui.btnSave, busy && ui.btnSave._loading);
  };

  const toggleLoading = (btn, loading) => {
    if (!btn) return;
    btn.classList.toggle('loading', !!loading);
    btn.setAttribute('aria-busy', loading ? 'true' : 'false');
  };

  const toast = (msg, ok = true) => {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.style.borderColor = ok ? 'var(--border)' : 'var(--danger)';
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.display = 'none'), 2400);
  };

  // Add or update a small hint under a field
  const setHint = (input, text, type = 'muted') => {
    if (!input) return;
    let hint = input.parentElement.querySelector('.hint');
    if (!hint) {
      hint = document.createElement('small');
      hint.className = 'hint';
      input.parentElement.appendChild(hint);
    }
    hint.textContent = text || '';
    hint.dataset.kind = type;
  };

  const setFieldValidity = (input, valid, msg = '') => {
    if (!input) return;
    input.classList.toggle('invalid', valid === false);
    input.classList.toggle('valid', valid === true);
    if (msg) setHint(input, msg, valid ? 'ok' : 'error');
    else setHint(input, '', 'muted');
    input.setAttribute('aria-invalid', valid === false ? 'true' : 'false');
  };

  // Simple validators
  const isNonEmpty = (v) => !!v && v.trim().length > 0;
  const isEmail = (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  // Light repo id helpers (warn-only; GitHub rules are broader in reality)
  const OWNER_RE = /^[A-Za-z0-9-]{1,39}$/;
  const REPO_RE  = /^[A-Za-z0-9._-]{1,100}$/;

  const sanitizeFolder = (v) =>
    String(v || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
      .replace(/\/{2,}/g, '/');

  const pad2 = (n) => String(n).padStart(2, '0');

  /** Build live rename preview from a rule: {base},{ext},{n},{yyyy},{mm},{dd} */
  const buildRenamePreview = (rule, filename, n = 2, when = new Date()) => {
    const dot = filename.lastIndexOf('.');
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : '';
       const yyyy = when.getFullYear();
    const mm = pad2(when.getMonth() + 1);
    const dd = pad2(when.getDate());
    const map = { base, ext, n, yyyy, mm, dd };
    return String(rule || '{base}-{n}{ext}').replace(
      /\{(base|ext|n|yyyy|mm|dd)\}/g,
      (_, k) => String(map[k] ?? '')
    );
  };

  // Status chip AFTER the Test button
  const ensureConnChip = () => {
    let chip = ui.btnTest?.parentElement?.querySelector('.conn-chip');
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'chip conn-chip';
      chip.dataset.kind = 'idle';
      chip.style.display = 'inline-flex';
      chip.textContent = 'Idle';
      ui.btnTest?.insertAdjacentElement('afterend', chip); // to the RIGHT of Test
    }
    return chip;
  };

  const setConnStatus = (kind, text) => {
    const chip = ensureConnChip();
    chip.textContent = text || '';
    chip.dataset.kind = kind || '';
    chip.style.display = text ? 'inline-flex' : 'none';
    // Mirror in repo card header too, if present
    const s = document.getElementById('rp-status');
    if (s) s.textContent = text || '';
  };

  /* ---------- Repository glance card (visual) ---------- */

  let repoCardEl;       // container
  let rootActionEl;     // inline "Create folder" action

  function ensureRepoCard() {
    if (repoCardEl) return repoCardEl;
    const ghPanel = document.querySelector('.tab-panel[data-panel="github"]');
    if (!ghPanel) return null;

    // Insert after the first .section (the credential block)
    const firstSection = ghPanel.querySelector('.section');
    repoCardEl = document.createElement('div');
    repoCardEl.className = 'repo-preview';
    repoCardEl.innerHTML = `
      <div class="rp-head">
        <span class="codicon codicon-repo"></span>
        <strong>Repository</strong>
        <span class="rp-status" id="rp-status">Not tested</span>
      </div>

      <div class="rp-grid">
        <div class="rp-row"><span>Owner</span><div class="rp-val" id="rp-owner">—</div></div>
        <div class="rp-row"><span>Repo</span><div class="rp-val" id="rp-repo">—</div></div>
        <div class="rp-row"><span>Branch</span><div class="rp-val" id="rp-branch">—</div></div>
        <div class="rp-row" id="rp-root-row">
          <span>Root folder</span>
          <div class="rp-val" id="rp-root">—</div>
        </div>
        <div class="rp-row full"><span>Raw base</span><div class="rp-val" id="rp-raw">—</div></div>
      </div>

      <div class="rp-actions">
        <a class="btn ghost" id="rp-open-repo" target="_blank" rel="noreferrer" aria-disabled="true">
          <span class="codicon codicon-github-inverted"></span> Open on GitHub
        </a>
        <a class="btn ghost" id="rp-open-raw" target="_blank" rel="noreferrer" aria-disabled="true">
          <span class="codicon codicon-link-external"></span> Open raw base
        </a>
      </div>
    `;
    if (firstSection && firstSection.nextSibling) {
      firstSection.parentNode.insertBefore(repoCardEl, firstSection.nextSibling);
    } else {
      ghPanel.appendChild(repoCardEl);
    }
    return repoCardEl;
  }

  function computeRawBase({ owner, repo, branch, rootDir }) {
    if (!owner || !repo || !branch) return '—';
    const rd = sanitizeFolder(rootDir || '');
    const tail = rd ? `/${rd}` : '';
    return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}${tail}`;
  }

  function updateRepoCard(values) {
    ensureRepoCard();
    if (!repoCardEl) return;
    const { owner, repo, branch, rootDir } = values;

    const rawBase = computeRawBase(values);

    const setTxt = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v || '—';
    };
    setTxt('rp-owner', owner || '—');
    setTxt('rp-repo', repo || '—');
    setTxt('rp-branch', branch || '—');
    setTxt('rp-root', rootDir || '—');
    setTxt('rp-raw', rawBase || '—');

    // actions
    const aRepo = document.getElementById('rp-open-repo');
    const aRaw  = document.getElementById('rp-open-raw');

    if (owner && repo) {
      aRepo.href = `https://github.com/${owner}/${repo}`;
      aRepo.removeAttribute('aria-disabled');
    } else {
      aRepo.href = '#';
      aRepo.setAttribute('aria-disabled','true');
    }

    if (rawBase && rawBase !== '—') {
      aRaw.href = rawBase.endsWith('/') ? rawBase : rawBase + '/';
      aRaw.removeAttribute('aria-disabled');
    } else {
      aRaw.href = '#';
      aRaw.setAttribute('aria-disabled','true');
    }
  }

  function showRootCreateAction(show, folderPath) {
    ensureRepoCard();
    const row = document.getElementById('rp-root-row');
    if (!row) return;

    if (!show) {
      if (rootActionEl) { rootActionEl.remove(); rootActionEl = null; }
      return;
    }

    if (!rootActionEl) {
      rootActionEl = document.createElement('button');
      rootActionEl.type = 'button';
      rootActionEl.className = 'btn xs ghost';
      rootActionEl.style.marginLeft = '8px';
      rootActionEl.innerHTML = `<span class="codicon codicon-new-folder"></span> Create folder`;
      // Put it right after the value
      row.querySelector('.rp-val')?.after(rootActionEl);
    }

    rootActionEl.onclick = async () => {
      if (!folderPath) return;
      try {
        rootActionEl.disabled = true;
        rootActionEl.textContent = 'Creating…';
        await window.api.githubCreateDir(folderPath);
        toast(`Created “${folderPath}”`);
        showRootCreateAction(false);
        setConnStatus('ok', 'Connected ✓');
      } catch (e) {
        console.error(e);
        toast(e.message || 'Failed to create folder', false);
        setConnStatus('error', 'Create failed');
      } finally {
        rootActionEl.disabled = false;
        rootActionEl.innerHTML = `<span class="codicon codicon-new-folder"></span> Create folder`;
      }
    };
  }

  /* ---------- Tabs ---------- */
  function switchTab(id) {
    ui.tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
    ui.panels.forEach((p) =>
      p.classList.toggle('active', p.dataset.panel === id)
    );
  }

  function bindTabs() {
    ui.tabs.forEach((t) => {
      t.setAttribute('type', 'button');
      t.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        switchTab(t.dataset.tab);
      });
    });
  }

  /* ---------- Load / Save ---------- */

  async function loadSettings() {
    const s = await window.api.getSettings();

    // GitHub
    ui.owner.value = s.owner || '';
    ui.repo.value = s.repo || '';
    ui.branch.value = s.branch || 'main';
    ui.root.value = s.rootDir || 'images';

    // Token: show dots if present, preserve on save if left unchanged
    tokenSaved = !!s.token;
    ui.token.value = tokenSaved ? TOKEN_MASK : '';

    // Commit & naming
    ui.name.value = s.committerName || 'Swift Image Host';
    ui.email.value = s.committerEmail || '';
    ui.rename.value = localStorage.getItem('renameRule') || '{base}-{n}{ext}';

    // Default selection
    ui.defaultSelect.value =
      localStorage.getItem('defSelect') || ui.root.value || 'images';

    // Uploader
    ui.threads.value = localStorage.getItem('upload_threads') || (ui.threads.value || '2');
    ui.uploadOpen.value = localStorage.getItem('uploadOpen') || 'window';
    ui.autoCopy.checked = localStorage.getItem('upload_autoCopy') === '1';
    ui.openAfter.checked = localStorage.getItem('upload_openAfter') === '1';

    // App & UI
    ui.theme.value = localStorage.getItem('theme') || 'dark';
    ui.confirmExit.checked = localStorage.getItem('confirm_exit') === '1';

    // Advanced (local only)
    ui.apiBase.value = localStorage.getItem('apiBase') || (s.apiBase || '');
    ui.safeMode.checked = localStorage.getItem('safe_mode') === '1';

    // Arrange the GitHub form into a tidy two-column grid
    enhanceGithubLayout();

    // Repo glance card (live values)
    updateRepoCard({
      owner: ui.owner.value.trim(),
      repo: ui.repo.value.trim(),
      branch: ui.branch.value.trim(),
      rootDir: ui.root.value.trim(),
    });
    setConnStatus('idle', 'Idle');

    // Live previews
    onRenameRuleInput();
    onDefaultSelectInput();
    softValidateIds();

    // snapshot for dirty state
    initialSnapshot = takeSnapshot();
    reflectDirtyUI();

    // Token mask UX
    wireTokenMaskUX();
  }

  // Make the GitHub section look/feel solid without changing your HTML.
  function enhanceGithubLayout() {
    const panel = document.querySelector('.tab-panel[data-panel="github"]');
    if (!panel) return;
    const section = panel.querySelector('.section');
    if (!section) return;
    section.classList.add('section-repo'); // CSS turns its direct .field children into 2 columns

    // Optional width tweaks: token wide; defaultSelect wide.
    ui.token?.closest('.field')?.classList.add('full');
    ui.defaultSelect?.closest('.field')?.classList.add('full');

    // Footer area (Test + pill) sits fine; nothing else to do here.
  }

  function wireTokenMaskUX() {
    ui.token.addEventListener('focus', () => {
      if (tokenSaved && ui.token.value === TOKEN_MASK) ui.token.value = '';
    });
    ui.token.addEventListener('blur', () => {
      if (tokenSaved && !ui.token.value) ui.token.value = TOKEN_MASK;
    });
  }

  async function saveSettings() {
    const values = takeSnapshot();
    const errs = validate(values);
    applyValidation(errs);
    if (Object.keys(errs).length) {
      const firstBadKey = Object.keys(errs)[0];
      const firstEl = {
        owner: ui.owner,
        repo: ui.repo,
        email: ui.email,
        rootDir: ui.root,
      }[firstBadKey];
      firstEl?.focus();
      toast('Please fix the highlighted fields.', false);
      return;
    }

    // Work out token save semantics
    let tokenToSave;
    if (!values.token || values.token === TOKEN_MASK) {
      tokenToSave = undefined; // unchanged
    } else {
      tokenToSave = values.token;
    }

    // Persist to main process
    ui.btnSave._loading = true;
    setBusy(true);
    try {
      await window.api.saveSettings({
        owner: values.owner,
        repo: values.repo,
        branch: values.branch || 'main',
        rootDir: values.rootDir,
        committerName: values.committerName,
        committerEmail: values.committerEmail,
        apiBase: values.apiBase || undefined,
        token: tokenToSave, // only if provided
      });

      // Local prefs
      localStorage.setItem('defSelect', values.defaultSelect);
      localStorage.setItem('renameRule', values.renameRule || '{base}-{n}{ext}');
      localStorage.setItem('theme', values.theme);
      localStorage.setItem('uploadOpen', values.uploadOpen);
      localStorage.setItem('upload_threads', String(values.threads || '2'));
      localStorage.setItem('upload_autoCopy', values.autoCopy ? '1' : '0');
      localStorage.setItem('upload_openAfter', values.openAfter ? '1' : '0');
      localStorage.setItem('confirm_exit', values.confirmExit ? '1' : '0');
      localStorage.setItem('apiBase', values.apiBase || '');
      localStorage.setItem('safe_mode', values.safeMode ? '1' : '0');

      // Update repo card and token state
      tokenSaved = tokenSaved || !!tokenToSave;
      updateRepoCard({
        owner: values.owner,
        repo: values.repo,
        branch: values.branch,
        rootDir: values.rootDir,
      });

      // Refresh snapshot
      initialSnapshot = takeSnapshot();
      reflectDirtyUI();
      setConnStatus('ok', 'Preferences saved');
      toast('Settings saved.');
      ui.dlg.close();
    } catch (e) {
      console.error(e);
      toast(e.message || 'Failed to save settings', false);
      setConnStatus('error', 'Save failed');
    } finally {
      ui.btnSave._loading = false;
      setBusy(false);
    }
  }

  function validate(v) {
    const errors = {};
    if (!isNonEmpty(v.owner)) {
      errors.owner = 'Owner is required.';
    }
    if (!isNonEmpty(v.repo)) {
      errors.repo = 'Repository is required.';
    }
    if (!isEmail(v.committerEmail)) {
      errors.email = 'Invalid email address.';
    }
    if (!isNonEmpty(v.rootDir)) {
      errors.rootDir = 'Root folder is required.';
    }
    return errors;
  }

  function applyValidation(errs) {
    setFieldValidity(ui.owner, !errs.owner, errs.owner);
    setFieldValidity(ui.repo, !errs.repo, errs.repo);
    setFieldValidity(ui.email, !errs.email, errs.email);
    setFieldValidity(ui.root, !errs.rootDir, errs.rootDir);
  }

  /* ---------- Live previews & interactions ---------- */

  function onDefaultSelectInput() {
    const raw = ui.defaultSelect.value.trim();
    const san = sanitizeFolder(raw || ui.root.value || 'images');
    setHint(
      ui.defaultSelect,
      san ? `Will preselect: “${san}”` : '',
      'muted'
    );
  }

  function onRenameRuleInput() {
    const rule = ui.rename.value.trim() || '{base}-{n}{ext}';
    const ex = buildRenamePreview(rule, 'sunrise.jpg', 2, new Date());
    setHint(ui.rename, `Example: ${ex}`, 'muted');
  }

  function onRootInput() {
    const san = sanitizeFolder(ui.root.value);
    if (san !== ui.root.value) {
      setHint(ui.root, `Sanitized → ${san}`, 'muted');
    } else {
      setHint(ui.root, '', 'muted');
    }
  }

  function softValidateIds() {
    // Gentle guidance while typing
    if (ui.owner?.value && !OWNER_RE.test(ui.owner.value.trim())) {
      setHint(ui.owner, 'Owner may contain letters, numbers and dashes (≤39).', 'error');
    } else if (ui.owner) {
      setHint(ui.owner, '', 'muted');
    }
    if (ui.repo?.value && !REPO_RE.test(ui.repo.value.trim())) {
      setHint(ui.repo, 'Repo can contain letters, numbers, dot, dash, underscore.', 'error');
    } else if (ui.repo) {
      setHint(ui.repo, '', 'muted');
    }
  }

  function reflectDirtyUI() {
    const dirty = isDirty();
    ui.btnSave.classList.toggle('primary', dirty);
    ui.btnSave.disabled = !dirty || busy;
  }

  function maybeCloseDialog() {
    if (busy) return;
    if (!isDirty()) {
      ui.dlg.close();
      return;
    }
    if (confirm('Discard changes?')) {
      ui.dlg.close();
    }
  }

  /* ---------- Test connection ---------- */
  async function testSettings() {
    const values = takeSnapshot();
    const errs = validate(values);
    applyValidation(errs);
    if (Object.keys(errs).length) {
      setConnStatus('warn', 'Fix fields first');
      toast('Please fix the highlighted fields.', false);
      return;
    }

    // Button does not spin; we just disable it while the pill shows the spinner.
    ui.btnTest.disabled = true;
    setBusy(true);

    // Show testing pill with spinner
    setConnStatus('testing', 'Testing…');

    try {
      // First, ask main to validate owner/repo/branch
      const r = await window.api.testSettings();
      const defaultBranch = r?.default_branch || '';
      if (defaultBranch && values.branch && values.branch !== defaultBranch) {
        setHint(ui.branch, `Repo default is “${defaultBranch}”`, 'ok');
      }

      // Then, check root folder existence
      try {
        const dirs = await window.api.githubListDirs();
        const root = sanitizeFolder(values.rootDir || 'images');
        const rootOk = dirs.includes(root);
        if (!rootOk) {
          setHint(ui.root, `Folder “${root}” not found in repo`, 'error');
          showRootCreateAction(true, root);
          setConnStatus('warn', 'Connected — root missing');
        } else {
          setHint(ui.root, '', 'muted');
          showRootCreateAction(false);
          setConnStatus('ok', `Connected ✓`);
        }
      } catch {
        showRootCreateAction(false);
        setConnStatus('ok', `Connected ✓`);
      }

      toast(`Connected: ${r.repoName}`);
    } catch (e) {
      console.error(e);
      setConnStatus('error', 'Connection failed');
      toast(e.message || 'Settings test failed', false);
    } finally {
      ui.btnTest.disabled = false;
      setBusy(false);
    }
  }

  /* ---------- Bindings ---------- */

  function bindCore() {
    // Titlebar & footer buttons
    ui.settingsClose?.addEventListener('click', maybeCloseDialog);
    ui.btnCancel?.addEventListener('click', maybeCloseDialog);
    ui.btnSave?.addEventListener('click', saveSettings);
    ui.btnTest?.addEventListener('click', testSettings);

    // ESC = cancel with confirm if dirty
    ui.dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      maybeCloseDialog();
    });

    // Enter on any input = Save (if valid)
    ui.dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        saveSettings();
      }
    });

    // Field changes => reflect dirty & previews + update repo card
    const inputs = [
      ui.owner, ui.repo, ui.branch, ui.root, ui.defaultSelect,
      ui.name, ui.email, ui.rename,
      ui.threads, ui.uploadOpen, ui.autoCopy, ui.openAfter,
      ui.theme, ui.confirmExit, ui.apiBase, ui.safeMode, ui.token
    ].filter(Boolean);

    inputs.forEach((el) => {
      const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        reflectDirtyUI();
        if (el === ui.rename) onRenameRuleInput();
        if (el === ui.defaultSelect) onDefaultSelectInput();
        if (el === ui.root) onRootInput();
        if (el === ui.owner || el === ui.repo) softValidateIds();

        // keep the glance card live
        if (el === ui.owner || el === ui.repo || el === ui.branch || el === ui.root) {
          updateRepoCard({
            owner: ui.owner.value.trim(),
            repo: ui.repo.value.trim(),
            branch: ui.branch.value.trim(),
            rootDir: ui.root.value.trim(),
          });
        }
      });
    });

    // Reset all settings (local + some persisted)
    ui.resetAll?.addEventListener('click', async () => {
      if (!confirm('Reset all settings and local preferences? You will need to re-enter the GitHub token.')) return;
      try {
        // Clear local prefs
        localStorage.removeItem('defSelect');
        localStorage.removeItem('renameRule');
        localStorage.removeItem('theme');
        localStorage.removeItem('uploadOpen');
        localStorage.removeItem('upload_threads');
        localStorage.removeItem('upload_autoCopy');
        localStorage.removeItem('upload_openAfter');
        localStorage.removeItem('confirm_exit');
        localStorage.removeItem('apiBase');
        localStorage.removeItem('safe_mode');

        // Persist blanks to main
        await window.api.saveSettings({
          owner: '',
          repo: '',
          branch: 'main',
          rootDir: 'images',
          committerName: 'Swift Image Host',
          committerEmail: '',
          token: '' // clears token
        });

        await loadSettings();
        toast('Settings reset. Re-enter your GitHub details.');
      } catch (e) {
        console.error(e);
        toast(e.message || 'Failed to reset settings', false);
      }
    });
  }

  /* ---------- Public API ---------- */
  window.Settings = {
    init() {
      bindTabs();
      bindCore();
      ensureRepoCard(); // create the glance card once
    },
    async prefill() {
      await loadSettings();
    },
    open() {
      loadSettings().then(() => ui.dlg.showModal());
    },
    // getters used by renderer
    getOwner() { return ui.owner.value.trim(); },
    getRepo() { return ui.repo.value.trim(); },
    getBranch() { return ui.branch.value.trim() || 'main'; },
    getRoot() { return ui.root.value.trim() || 'images'; },
    getDefaultSelect() { return localStorage.getItem('defSelect') || ''; }
  };
})();
