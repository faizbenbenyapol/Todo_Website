(() => {
  const QUADRANTS = [1, 2, 3, 4];
  let state = {
    tasks: [],
    subscriptions: [],
    notes: [],
    notesNextCursor: null,
    notesTotal: 0,
    settings: null,
    themePreference: 'system',
    editingTaskId: null,
    editingSubscriptionId: null,
    authenticated: false,
    googleConfig: null,
    googleReady: false,
    googleBusy: false,
    modalReturnFocus: null,
  };

  // ---------------- helpers ----------------

  async function api(method, url, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('เซิร์ฟเวอร์ตอบสนองช้าเกินไป กรุณาลองใหม่');
      throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อ');
    } finally {
      clearTimeout(timeout);
    }
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      if (res.status === 401 && state.authenticated) handleSessionExpired();
      const error = new Error((data && data.error) || 'เกิดข้อผิดพลาด');
      error.status = res.status;
      throw error;
    }
    return data;
  }

  function handleSessionExpired() {
    state.authenticated = false;
    state.tasks = [];
    state.subscriptions = [];
    state.notes = [];
    state.notesNextCursor = null;
    state.notesTotal = 0;
    state.settings = null;
    el('appScreen').classList.add('hidden');
    el('authScreen').classList.remove('hidden');
    el('setupForm').classList.add('hidden');
    el('loginForm').classList.remove('hidden');
    showAuthError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }

  function showToast(msg, isError) {
    const e = document.getElementById('toast');
    e.textContent = msg;
    e.classList.toggle('error', !!isError);
    e.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => e.classList.remove('show'), 2600);
  }

  function el(id) { return document.getElementById(id); }

  function confirmDialog({ title = 'ยืนยันการทำรายการ', text = '', confirmText = 'ยืนยัน', cancelText = 'ยกเลิก', danger = true } = {}) {
    return new Promise((resolve) => {
      const backdrop = el('confirmDialogBackdrop');
      const confirmBtn = el('confirmDialogConfirmBtn');
      const cancelBtn = el('confirmDialogCancelBtn');
      const previousFocus = document.activeElement;

      el('confirmDialogTitle').textContent = title;
      el('confirmDialogText').textContent = text;
      confirmBtn.textContent = confirmText;
      cancelBtn.textContent = cancelText;
      confirmBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');

      function cleanup(result) {
        backdrop.classList.add('hidden');
        document.body.classList.remove('modal-open');
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        backdrop.removeEventListener('click', onBackdropClick);
        document.removeEventListener('keydown', onKeydown);
        if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
        resolve(result);
      }
      function onConfirm() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onBackdropClick(event) { if (event.target === backdrop) cleanup(false); }
      function onKeydown(event) { if (event.key === 'Escape') cleanup(false); }

      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
      backdrop.addEventListener('click', onBackdropClick);
      document.addEventListener('keydown', onKeydown);

      backdrop.classList.remove('hidden');
      document.body.classList.add('modal-open');
      cancelBtn.focus();
    });
  }

  function closeCustomSelect(wrapper, restoreFocus = false) {
    if (!wrapper || !wrapper.classList.contains('open')) return;
    wrapper.classList.remove('open');
    const trigger = wrapper.querySelector('.custom-select-trigger');
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }

  function closeAllCustomSelects(except = null) {
    document.querySelectorAll('.custom-select.open').forEach((wrapper) => {
      if (wrapper !== except) closeCustomSelect(wrapper);
    });
  }

  function setupCustomSelect(select) {
    if (!select || select.dataset.enhanced === 'true') return;
    select.dataset.enhanced = 'true';

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.id = `${select.id}Trigger`;
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const value = document.createElement('span');
    value.className = 'custom-select-value';
    const chevron = document.createElement('span');
    chevron.className = 'custom-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(value, chevron);

    const menu = document.createElement('div');
    menu.className = 'custom-select-menu';
    menu.id = `${select.id}Menu`;
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-labelledby', trigger.id);
    trigger.setAttribute('aria-controls', menu.id);

    const optionButtons = Array.from(select.options).map((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'custom-select-option';
      button.dataset.value = option.value;
      button.setAttribute('role', 'option');

      const label = document.createElement('span');
      label.className = 'custom-select-option-label';
      label.textContent = option.textContent;
      const check = document.createElement('span');
      check.className = 'custom-select-option-check';
      check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
      check.setAttribute('aria-hidden', 'true');
      button.append(label, check);

      button.addEventListener('click', () => {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        closeCustomSelect(wrapper, true);
      });
      menu.appendChild(button);
      return button;
    });

    function sync() {
      const selected = select.selectedOptions[0] || select.options[0];
      value.textContent = selected ? selected.textContent : '';
      const linkedLabel = document.querySelector(`label[for="${trigger.id}"]`);
      const accessibleLabel = select.getAttribute('aria-label') || linkedLabel?.textContent.trim() || 'เลือกตัวเลือก';
      trigger.setAttribute('aria-label', `${accessibleLabel}: ${selected ? selected.textContent : ''}`);
      optionButtons.forEach((button) => {
        const active = button.dataset.value === select.value;
        button.classList.toggle('selected', active);
        button.setAttribute('aria-selected', String(active));
      });
    }

    function focusOption(index) {
      const safeIndex = Math.max(0, Math.min(optionButtons.length - 1, index));
      optionButtons[safeIndex]?.focus();
    }

    function open(preferredIndex = null) {
      closeAllCustomSelects(wrapper);
      wrapper.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      const selectedIndex = Math.max(0, optionButtons.findIndex((button) => button.classList.contains('selected')));
      requestAnimationFrame(() => focusOption(preferredIndex ?? selectedIndex));
    }

    trigger.addEventListener('click', () => {
      if (wrapper.classList.contains('open')) closeCustomSelect(wrapper);
      else open();
    });

    trigger.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') open(0);
      else if (event.key === 'End') open(optionButtons.length - 1);
      else open();
    });

    menu.addEventListener('keydown', (event) => {
      const currentIndex = optionButtons.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeCustomSelect(wrapper, true);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusOption(currentIndex + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusOption(currentIndex - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        focusOption(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        focusOption(optionButtons.length - 1);
      } else if (event.key === 'Tab') {
        closeCustomSelect(wrapper);
      }
    });

    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(select, trigger, menu);
    select.classList.add('custom-select-native');
    select.tabIndex = -1;
    select.inert = true;
    select.setAttribute('aria-hidden', 'true');
    select.addEventListener('change', sync);
    select._syncCustomSelect = sync;
    sync();
  }

  function setupCustomSelects() {
    document.querySelectorAll('select.field-select').forEach(setupCustomSelect);
    document.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('.custom-select')) closeAllCustomSelects();
    });
  }

  function syncCustomSelect(select) {
    if (select && typeof select._syncCustomSelect === 'function') select._syncCustomSelect();
  }

  const THEME_STORAGE_KEY = 'eisenhower-theme';
  const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const THEME_IDS = ['system', 'light', 'dark', 'sakura', 'mint', 'sky', 'lavender', 'peach', 'sand'];
  const THEME_LABELS = {
    system: 'ตามระบบ',
    light: 'สว่าง',
    dark: 'มืด',
    sakura: 'ซากุระ',
    mint: 'มินต์',
    sky: 'ท้องฟ้า',
    lavender: 'ลาเวนเดอร์',
    peach: 'พีช',
    sand: 'ทราย',
  };
  const THEME_META_COLORS = {
    light: '#F6F6FA',
    dark: '#0B0C10',
    sakura: '#FAF6F7',
    mint: '#F5F7F5',
    sky: '#F5F7F9',
    lavender: '#F6F5F9',
    peach: '#F9F6F3',
    sand: '#F8F6F1',
  };

  function readThemePreference() {
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      return THEME_IDS.includes(saved) ? saved : 'system';
    } catch {
      return 'system';
    }
  }

  function applyTheme(preference, announce = false) {
    const safePreference = THEME_IDS.includes(preference) ? preference : 'system';
    const resolvedTheme = safePreference === 'system'
      ? (systemThemeQuery.matches ? 'dark' : 'light')
      : safePreference;

    state.themePreference = safePreference;
    document.documentElement.dataset.theme = resolvedTheme;
    el('themeColorMeta').setAttribute('content', THEME_META_COLORS[resolvedTheme] || '#F6F6FA');

    try { window.localStorage.setItem(THEME_STORAGE_KEY, safePreference); } catch { /* private mode */ }

    document.querySelectorAll('.theme-option').forEach((button) => {
      const active = button.dataset.themeValue === safePreference;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    el('activeThemeLabel').textContent = THEME_LABELS[safePreference];

    if (announce) showToast(`เปลี่ยนเป็นธีม${THEME_LABELS[safePreference]}แล้ว`);
  }

  function getInitials(username) {
    const parts = String(username || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '·';
    if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join('').toUpperCase();
    return `${Array.from(parts[0])[0] || ''}${Array.from(parts.at(-1))[0] || ''}`.toUpperCase();
  }

  function setSidebarIdentity(username) {
    const safeName = String(username || 'ผู้ใช้งาน');
    el('sidebarUsername').textContent = safeName;
    const avatar = el('sidebarAvatar');
    if (avatar) avatar.textContent = getInitials(safeName);
  }

  function setButtonLoading(button, loading) {
    if (!button) return;
    button.classList.toggle('is-loading', loading);
    button.disabled = loading;
    button.setAttribute('aria-busy', String(loading));
  }

  function loadGoogleIdentityScript() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      return Promise.resolve();
    }
    if (loadGoogleIdentityScript.promise) return loadGoogleIdentityScript.promise;

    loadGoogleIdentityScript.promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('โหลด Google Identity Services ไม่สำเร็จ'));
      document.head.appendChild(script);
    });

    return loadGoogleIdentityScript.promise;
  }

  function renderGoogleButton(container, text) {
    if (!state.googleReady || !container || container.dataset.rendered === 'true') return;
    const availableWidth = Math.floor(container.getBoundingClientRect().width || 280);
    window.google.accounts.id.renderButton(container, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text,
      shape: 'rectangular',
      logo_alignment: 'left',
      width: Math.max(200, Math.min(280, availableWidth)),
    });
    container.dataset.rendered = 'true';
  }

  function updateGoogleConnectionUi() {
    const config = state.googleConfig;
    const badge = el('googleConnectionBadge');
    const status = el('googleConnectionStatus');
    const linkButton = el('googleLinkButton');

    if (!config || !config.enabled) {
      badge.textContent = 'ยังไม่ตั้งค่า';
      badge.className = 'connection-badge';
      status.textContent = 'เพิ่ม GOOGLE_CLIENT_ID ในไฟล์ .env แล้วรีสตาร์ตเซิร์ฟเวอร์เพื่อเปิดใช้งาน';
      linkButton.classList.add('hidden');
      return;
    }

    if (config.linked) {
      badge.textContent = 'เชื่อมแล้ว';
      badge.className = 'connection-badge connected';
      status.textContent = config.email
        ? `บัญชีนี้เชื่อมกับ ${config.email} แล้ว`
        : 'บัญชีนี้เชื่อมกับ Google แล้ว';
      linkButton.classList.add('hidden');
      return;
    }

    badge.textContent = 'พร้อมเชื่อม';
    badge.className = 'connection-badge ready';
    status.textContent = 'เลือกบัญชี Google ที่ต้องการใช้เข้าสู่บอร์ดนี้';
    linkButton.classList.remove('hidden');
    renderGoogleButton(linkButton, 'continue_with');
  }

  async function refreshGoogleAuth() {
    const config = await api('GET', '/api/auth/google/config');
    state.googleConfig = config;

    const loginButton = el('googleLoginButton');
    const placeholder = el('googleLoginPlaceholder');
    const hint = el('googleAuthHint');

    if (!config.enabled) {
      loginButton.classList.add('hidden');
      placeholder.classList.remove('hidden');
      hint.textContent = 'เมื่อใส่ Client ID แล้ว ปุ่ม Google ทางการจะแสดงอัตโนมัติ';
      updateGoogleConnectionUi();
      return config;
    }

    placeholder.classList.add('hidden');
    loginButton.classList.remove('hidden');
    hint.textContent = 'เข้าสู่ระบบด้วยบัญชี Google ที่เชื่อมกับบอร์ดนี้';

    await loadGoogleIdentityScript();
    if (!state.googleReady) {
      window.google.accounts.id.initialize({
        client_id: config.clientId,
        callback: handleGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
        context: 'signin',
      });
      state.googleReady = true;
    }

    renderGoogleButton(loginButton, 'signin_with');
    updateGoogleConnectionUi();
    return config;
  }

  async function handleGoogleCredential(response) {
    if (state.googleBusy || !response || !response.credential) return;
    state.googleBusy = true;
    el('googleLoginButton').classList.add('google-auth-busy');
    el('googleLinkButton').classList.add('google-auth-busy');

    try {
      // ขอ CSRF token ใหม่จาก session ปัจจุบันทันทีก่อนส่ง Google credential
      const config = await api('GET', '/api/auth/google/config');
      state.googleConfig = config;
      const endpoint = state.authenticated ? '/api/auth/google/link' : '/api/auth/google';
      const result = await api('POST', endpoint, {
        credential: response.credential,
        csrf_token: config.csrfToken,
        remember_device: el('rememberDevice').checked,
      });

      if (state.authenticated) {
        state.googleConfig.linked = true;
        state.googleConfig.email = result.email || '';
        setSidebarIdentity(result.username || el('sidebarUsername').textContent);
        updateGoogleConnectionUi();
        showToast('เชื่อมบัญชี Google เรียบร้อยแล้ว');
      } else {
        const session = await api('GET', '/api/session');
        await enterApp(session.username, session);
      }
    } catch (error) {
      if (state.authenticated) showToast(error.message, true);
      else showAuthError(error.message);
    } finally {
      state.googleBusy = false;
      el('googleLoginButton').classList.remove('google-auth-busy');
      el('googleLinkButton').classList.remove('google-auth-busy');
    }
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function parseDisplayDate(value) {
    const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() !== year
      || date.getMonth() !== month - 1
      || date.getDate() !== day
    ) return null;

    return {
      display: `${pad2(day)}/${pad2(month)}/${year}`,
      iso: `${year}-${pad2(month)}-${pad2(day)}`,
    };
  }

  function formatDateInput(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
    const parts = [];
    if (digits.length > 0) parts.push(digits.slice(0, 2));
    if (digits.length > 2) parts.push(digits.slice(2, 4));
    if (digits.length > 4) parts.push(digits.slice(4, 8));
    return parts.join('/');
  }

  function setTaskDueValue(dueDate) {
    const dateInput = el('taskDueDate');
    const picker = el('taskDuePicker');

    dateInput.setCustomValidity('');

    const date = new Date(dueDate);
    if (!dueDate || Number.isNaN(date.getTime())) {
      dateInput.value = '';
      picker.value = '';
      return;
    }

    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    dateInput.value = `${day}/${month}/${year}`;
    picker.value = `${year}-${month}-${day}`;
  }

  function getTaskDueValue() {
    const dateInput = el('taskDueDate');
    const dateText = dateInput.value.trim();

    dateInput.setCustomValidity('');

    if (!dateText) return null;

    const parsed = parseDisplayDate(dateText);
    if (!parsed) {
      dateInput.setCustomValidity('กรุณาระบุวันที่ให้ถูกต้องในรูปแบบ dd/mm/yyyy');
      dateInput.reportValidity();
      return undefined;
    }

    dateInput.value = parsed.display;
    el('taskDuePicker').value = parsed.iso;
    const [year, month, day] = parsed.iso.split('-').map(Number);
    // A date-only deadline means the end of that local day.
    return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
  }

  function formatDueDate(dueDate) {
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return dueDate;
    return `${pad2(due.getDate())}/${pad2(due.getMonth() + 1)}/${due.getFullYear()}`;
  }

  function formatDisplayDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${formatDueDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  // ---------------- auth screen ----------------

  async function initAuth() {
    const session = await api('GET', '/api/session');
    if (session.authenticated) {
      await enterApp(session.username, session);
      return;
    }

    const status = await api('GET', '/api/setup-status');
    el('authScreen').classList.remove('hidden');
    if (status.needsSetup) {
      el('setupForm').classList.remove('hidden');
      el('setupTokenField').classList.toggle('hidden', !status.requiresSetupToken);
      el('setupToken').required = Boolean(status.requiresSetupToken);
    } else {
      el('loginForm').classList.remove('hidden');
    }
  }

  el('setupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();
    const submitButton = el('setupSubmitBtn');
    setButtonLoading(submitButton, true);
    try {
      await api('POST', '/api/setup', {
        username: el('setupUsername').value,
        password: el('setupPassword').value,
        setup_token: el('setupToken').value,
      });
      const session = await api('GET', '/api/session');
      await enterApp(session.username, session);
    } catch (err) {
      showAuthError(err.message);
    } finally {
      setButtonLoading(submitButton, false);
    }
  });

  el('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();
    const submitButton = el('loginSubmitBtn');
    setButtonLoading(submitButton, true);
    try {
      await api('POST', '/api/login', {
        username: el('loginUsername').value,
        password: el('loginPassword').value,
        remember_device: el('rememberDevice').checked,
      });
      const session = await api('GET', '/api/session');
      await enterApp(session.username, session);
    } catch (err) {
      showAuthError(err.message);
    } finally {
      setButtonLoading(submitButton, false);
    }
  });

  function showAuthError(msg) {
    const e = el('authError');
    e.textContent = msg;
    e.classList.remove('hidden');
  }
  function hideAuthError() {
    el('authError').classList.add('hidden');
  }

  el('logoutBtn').addEventListener('click', async () => {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    const button = el('logoutBtn');
    setButtonLoading(button, true);
    try {
      await api('POST', '/api/logout');
      window.location.reload();
    } catch (error) {
      showToast(error.message, true);
      setButtonLoading(button, false);
    }
  });

  // ---------------- enter app ----------------

  async function enterApp(username, sessionInfo = {}) {
    state.authenticated = true;
    el('authScreen').classList.add('hidden');
    const appScreen = el('appScreen');
    appScreen.classList.remove('hidden');
    appScreen.classList.remove('app-ready');
    requestAnimationFrame(() => appScreen.classList.add('app-ready'));
    setSidebarIdentity(username);

    el('todayLabel').textContent = formatDueDate(new Date());

    const googleRefresh = refreshGoogleAuth().catch((error) => {
      console.warn(error);
      el('googleConnectionStatus').textContent = 'โหลดบริการ Google ไม่สำเร็จ แต่ยังใช้ชื่อผู้ใช้และรหัสผ่านได้ตามปกติ';
      return null;
    });
    const results = await Promise.allSettled([
      loadTasks(), loadNotes(), loadSubscriptions(), loadSettings(), googleRefresh,
    ]);
    const essentialErrors = results.slice(0, 4).filter((result) => result.status === 'rejected');
    if (results[0].status === 'rejected') state.tasks = [];
    if (results[1].status === 'rejected') {
      state.notes = [];
      state.notesNextCursor = null;
      state.notesTotal = 0;
    }
    if (results[2].status === 'rejected') state.subscriptions = [];
    if (results[3].status === 'rejected') {
      state.settings = {
        telegram_bot_configured: false,
        telegram_chat_id: '',
        notify_before_minutes: 60,
        subscription_notify_enabled: true,
        daily_summary_enabled: false,
        daily_summary_time: '08:00',
      };
    }
    if (state.googleConfig) {
      state.googleConfig.linked = Boolean(sessionInfo.googleLinked || state.googleConfig.linked);
      state.googleConfig.email = sessionInfo.email || state.googleConfig.email || '';
    }
    renderMatrix();
    renderSubscriptions();
    renderNotes();
    renderSettings();
    if (state.googleConfig) updateGoogleConnectionUi();
    if (essentialErrors.length > 0) {
      showToast('โหลดข้อมูลบางส่วนไม่สำเร็จ กรุณาลองรีเฟรชหน้า', true);
    }
  }

  // ---------------- nav ----------------

  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item[data-view]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      el('view-' + btn.dataset.view).classList.add('active');
      el('quickJotFab').hidden = btn.dataset.view === 'settings';
      if (btn.dataset.view === 'settings') updateGoogleConnectionUi();
    });
  });

  // ---------------- tasks / matrix ----------------

  async function loadTasks() {
    state.tasks = await api('GET', '/api/tasks');
  }

  function dueBadgeInfo(dueDate) {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    const now = new Date();
    const label = formatDueDate(dueDate);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfDueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());

    if (due < now) return { label, cls: 'overdue' };
    if (startOfDueDay.getTime() === startOfToday.getTime()) return { label, cls: 'today' };
    return { label, cls: '' };
  }

  function updateSidebarTaskCount() {
    const pending = state.tasks.filter((task) => !task.completed).length;
    el('sidebarTaskCount').textContent = pending;
    const dashboardPending = el('dashboardPendingCount');
    if (dashboardPending) dashboardPending.textContent = pending;
  }

  function renderMatrix() {
    updateSidebarTaskCount();
    const grouped = new Map(QUADRANTS.map((quadrant) => [quadrant, []]));
    state.tasks.forEach((task) => grouped.get(task.quadrant)?.push(task));
    QUADRANTS.forEach((q) => {
      const list = grouped.get(q);
      const container = document.querySelector(`[data-list="${q}"]`);
      const countEl = document.querySelector(`[data-count="${q}"]`);
      countEl.textContent = list.length;

      container.innerHTML = '';
      if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'quad-empty';
        empty.textContent = 'ยังไม่มีงานในหมวดนี้';
        container.appendChild(empty);
        return;
      }

      list.forEach((task) => {
        container.appendChild(renderTaskCard(task));
      });
    });
  }

  function renderTaskCard(task) {
    const card = document.createElement('div');
    card.className = 'task-card' + (task.completed ? ' completed' : '');

    const check = document.createElement('button');
    check.className = 'task-check' + (task.completed ? ' checked' : '');
    check.type = 'button';
    check.title = task.completed ? 'ทำเครื่องหมายว่ายังไม่เสร็จ' : 'ทำเครื่องหมายว่าเสร็จแล้ว';
    check.setAttribute('aria-label', check.title);
    check.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (check.disabled) return;
      setButtonLoading(check, true);
      try {
        const updated = await api('PUT', `/api/tasks/${task.id}`, { completed: !task.completed });
        const idx = state.tasks.findIndex((t) => t.id === task.id);
        if (idx >= 0) state.tasks[idx] = updated;
        renderMatrix();
      } catch (err) {
        showToast(err.message, true);
      } finally {
        setButtonLoading(check, false);
      }
    });

    const main = document.createElement('div');
    main.className = 'task-main';

    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = task.title;
    main.appendChild(title);

    if (task.description) {
      const desc = document.createElement('div');
      desc.className = 'task-desc';
      desc.textContent = task.description;
      main.appendChild(desc);
    }

    const badge = dueBadgeInfo(task.due_date);
    if (badge) {
      const due = document.createElement('span');
      due.className = 'task-due ' + badge.cls;
      due.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg><span>' + badge.label + '</span>';
      main.appendChild(due);
    }

    main.addEventListener('click', () => openTaskModal(task.quadrant, task));

    const actions = document.createElement('div');
    actions.className = 'task-actions';
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.type = 'button';
    del.title = 'ลบ';
    del.setAttribute('aria-label', `ลบงาน ${task.title}`);
    del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M9 7V4h6v3m-9 0 1 13h10l1-13"/></svg>';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = await confirmDialog({
        title: 'ลบงานนี้เลยไหม?',
        text: 'เมื่อลบแล้วจะไม่สามารถกู้คืนได้',
        confirmText: 'ลบงาน',
      });
      if (!confirmed) return;
      setButtonLoading(del, true);
      try {
        await api('DELETE', `/api/tasks/${task.id}`);
        state.tasks = state.tasks.filter((t) => t.id !== task.id);
        renderMatrix();
      } catch (err) {
        showToast(err.message, true);
        setButtonLoading(del, false);
      }
    });
    actions.appendChild(del);

    card.appendChild(check);
    card.appendChild(main);
    card.appendChild(actions);
    return card;
  }

  document.querySelectorAll('.quad-add').forEach((btn) => {
    btn.addEventListener('click', () => openTaskModal(Number(btn.dataset.addQ), null));
  });

  function openTaskModal(quadrant, task) {
    state.modalReturnFocus = document.activeElement;
    state.editingTaskId = task ? task.id : null;
    el('taskModalTitle').textContent = task ? 'แก้ไขงาน' : 'เพิ่มงานใหม่';
    el('taskId').value = task ? task.id : '';
    el('taskTitle').value = task ? task.title : '';
    el('taskDesc').value = task ? (task.description || '') : '';
    el('taskQuadrant').value = String(task ? task.quadrant : quadrant);
    syncCustomSelect(el('taskQuadrant'));
    setTaskDueValue(task && task.due_date ? task.due_date : '');
    el('deleteTaskBtn').classList.toggle('hidden', !task);
    el('taskModalBackdrop').classList.remove('hidden');
    document.body.classList.add('modal-open');
    el('taskTitle').focus();
  }

  function closeTaskModal() {
    closeAllCustomSelects();
    el('taskModalBackdrop').classList.add('hidden');
    document.body.classList.remove('modal-open');
    if (state.modalReturnFocus && document.contains(state.modalReturnFocus)) state.modalReturnFocus.focus();
    state.modalReturnFocus = null;
  }

  el('cancelTaskBtn').addEventListener('click', closeTaskModal);
  el('taskModalBackdrop').addEventListener('click', (e) => {
    if (e.target === el('taskModalBackdrop')) closeTaskModal();
  });

  el('taskDueDate').addEventListener('input', (e) => {
    e.target.value = formatDateInput(e.target.value);
    e.target.setCustomValidity('');
  });

  el('taskDueDate').addEventListener('blur', (e) => {
    if (!e.target.value) return;
    const parsed = parseDisplayDate(e.target.value);
    if (!parsed) {
      e.target.setCustomValidity('กรุณาระบุวันที่ให้ถูกต้องในรูปแบบ dd/mm/yyyy');
      return;
    }
    e.target.value = parsed.display;
    e.target.setCustomValidity('');
    el('taskDuePicker').value = parsed.iso;
  });

  el('taskDuePicker').addEventListener('change', (e) => {
    if (!e.target.value) return;
    const [year, month, day] = e.target.value.split('-');
    el('taskDueDate').value = `${day}/${month}/${year}`;
    el('taskDueDate').setCustomValidity('');
  });

  el('taskForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dueDate = getTaskDueValue();
    if (dueDate === undefined) return;
    const payload = {
      title: el('taskTitle').value,
      description: el('taskDesc').value,
      quadrant: Number(el('taskQuadrant').value),
      due_date: dueDate,
    };
    const saveButton = el('saveTaskBtn');
    setButtonLoading(saveButton, true);
    try {
      if (state.editingTaskId) {
        const updated = await api('PUT', `/api/tasks/${state.editingTaskId}`, payload);
        const idx = state.tasks.findIndex((t) => t.id === updated.id);
        if (idx >= 0) state.tasks[idx] = updated;
      } else {
        const created = await api('POST', '/api/tasks', payload);
        state.tasks.push(created);
      }
      renderMatrix();
      closeTaskModal();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setButtonLoading(saveButton, false);
    }
  });

  el('deleteTaskBtn').addEventListener('click', async () => {
    if (!state.editingTaskId) return;
    const confirmed = await confirmDialog({
      title: 'ลบงานนี้เลยไหม?',
      text: 'เมื่อลบแล้วจะไม่สามารถกู้คืนได้',
      confirmText: 'ลบงาน',
    });
    if (!confirmed) return;
    const button = el('deleteTaskBtn');
    setButtonLoading(button, true);
    try {
      await api('DELETE', `/api/tasks/${state.editingTaskId}`);
      state.tasks = state.tasks.filter((t) => t.id !== state.editingTaskId);
      renderMatrix();
      closeTaskModal();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setButtonLoading(button, false);
    }
  });

  // ---------------- subscriptions ----------------

  async function loadSubscriptions() {
    state.subscriptions = await api('GET', '/api/subscriptions');
  }

  function localDateFromValue(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (
      date.getFullYear() !== Number(match[1])
      || date.getMonth() !== Number(match[2]) - 1
      || date.getDate() !== Number(match[3])
    ) return null;
    return date;
  }

  function subscriptionDaysLeft(renewalDate) {
    const target = localDateFromValue(renewalDate);
    if (!target) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target.getTime() - today.getTime()) / 86400000);
  }

  function formatSubscriptionDate(renewalDate) {
    const date = localDateFromValue(renewalDate);
    if (!date) return renewalDate || 'ไม่ระบุวันที่';
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
  }

  function subscriptionWeekday(renewalDate, style) {
    const date = localDateFromValue(renewalDate);
    if (!date) return '';
    return new Intl.DateTimeFormat('th-TH', { weekday: style }).format(date);
  }

  function subscriptionDateParts(renewalDate) {
    const date = localDateFromValue(renewalDate);
    if (!date) return { day: '--', month: 'ไม่ระบุ', year: '' };
    return {
      day: new Intl.DateTimeFormat('th-TH', { day: '2-digit' }).format(date),
      month: new Intl.DateTimeFormat('th-TH', { month: 'short' }).format(date).replace('.', ''),
      year: new Intl.DateTimeFormat('th-TH', { year: 'numeric' }).format(date),
    };
  }

  function subscriptionStatus(subscription) {
    const days = subscriptionDaysLeft(subscription.renewal_date);
    if (days === null) return { days: null, label: 'วันที่ไม่ถูกต้อง', cls: 'expired' };
    if (days < 0) return { days, label: 'หมดอายุแล้ว ' + Math.abs(days) + ' วัน', cls: 'expired' };
    if (days === 0) return { days, label: 'หมดอายุวันนี้', cls: 'today' };
    if (days <= Number(subscription.reminder_days)) {
      return { days, label: 'เหลืออีก ' + days + ' วัน', cls: 'soon' };
    }
    return { days, label: 'เหลืออีก ' + days + ' วัน', cls: '' };
  }

  function renderSubscriptions() {
    const list = el('subscriptionList');
    const subscriptions = [...state.subscriptions].sort((a, b) => (
      String(a.renewal_date || '').localeCompare(String(b.renewal_date || ''))
    ));
    const statuses = subscriptions.map((subscription) => ({
      subscription,
      status: subscriptionStatus(subscription),
    }));
    const expiring = statuses.filter(({ subscription, status }) => (
      status.days !== null
      && status.days >= 0
      && status.days <= Number(subscription.reminder_days)
    )).length;
    const expired = statuses.filter(({ status }) => status.days !== null && status.days < 0).length;

    el('subscriptionTotal').textContent = subscriptions.length;
    el('subscriptionExpiring').textContent = expiring;
    el('subscriptionExpired').textContent = expired;
    list.innerHTML = '';
    el('subscriptionEmpty').classList.toggle('hidden', subscriptions.length > 0);
    if (subscriptions.length === 0) return;

    statuses.forEach(({ subscription, status }) => {
      const item = document.createElement('div');
      item.className = 'subscription-item' + (status.cls ? ' ' + status.cls : '');

      const dateBlock = document.createElement('div');
      dateBlock.className = 'subscription-date-block';
      const weekdayTag = document.createElement('span');
      weekdayTag.className = 'subscription-date-weekday';
      weekdayTag.textContent = subscriptionWeekday(subscription.renewal_date, 'short');
      const dateFull = document.createElement('span');
      dateFull.className = 'subscription-date-full';
      dateFull.textContent = formatSubscriptionDate(subscription.renewal_date);
      dateBlock.append(weekdayTag, dateFull);

      const identity = document.createElement('div');
      identity.className = 'subscription-identity';
      identity.appendChild(dateBlock);
      item.appendChild(identity);

      const main = document.createElement('div');
      main.className = 'subscription-item-main';
      const heading = document.createElement('div');
      heading.className = 'subscription-item-heading';
      const name = document.createElement('strong');
      name.className = 'subscription-item-name';
      name.textContent = subscription.name;
      heading.appendChild(name);
      if (subscription.plan_name) {
        const plan = document.createElement('span');
        plan.className = 'subscription-item-plan';
        plan.textContent = subscription.plan_name;
        heading.appendChild(plan);
      }
      main.appendChild(heading);

      const meta = document.createElement('div');
      meta.className = 'subscription-item-meta';
      const renewal = document.createElement('span');
      renewal.className = 'subscription-meta-entry subscription-meta-renewal';
      renewal.textContent = 'ต่ออายุ ' + subscriptionWeekday(subscription.renewal_date, 'long') + ' ' + formatSubscriptionDate(subscription.renewal_date);
      meta.appendChild(renewal);
      if (subscription.price) {
        const price = document.createElement('span');
        price.className = 'subscription-meta-entry subscription-meta-price';
        price.textContent = subscription.price;
        meta.appendChild(price);
      }
      main.appendChild(meta);
      if (subscription.notes) {
        const notes = document.createElement('div');
        notes.className = 'subscription-item-notes';
        notes.textContent = subscription.notes;
        main.appendChild(notes);
      }

      const side = document.createElement('div');
      side.className = 'subscription-item-side';
      const statusBadge = document.createElement('span');
      statusBadge.className = 'subscription-status' + (status.cls ? ' ' + status.cls : '');
      statusBadge.textContent = status.label;
      side.appendChild(statusBadge);

      const actions = document.createElement('div');
      actions.className = 'subscription-item-actions';
      const edit = document.createElement('button');
      edit.className = 'icon-btn';
      edit.type = 'button';
      edit.title = 'แก้ไข Subscription';
      edit.setAttribute('aria-label', 'แก้ไข Subscription ' + subscription.name);
      edit.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m4 16-.7 4.7L8 20l11.3-11.3a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m14.8 6.8 2.4 2.4"/></svg>';
      edit.addEventListener('click', () => openSubscriptionModal(subscription));
      const remove = document.createElement('button');
      remove.className = 'icon-btn';
      remove.type = 'button';
      remove.title = 'ลบ Subscription';
      remove.setAttribute('aria-label', 'ลบ Subscription ' + subscription.name);
      remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M9 7V4h6v3m-9 0 1 13h10l1-13"/></svg>';
      remove.addEventListener('click', async () => {
        const confirmed = await confirmDialog({
          title: 'ลบ Subscription นี้เลยไหม?',
          text: 'ข้อมูลและการแจ้งเตือนของรายการนี้จะถูกลบไปด้วย',
          confirmText: 'ลบรายการ',
        });
        if (!confirmed) return;
        setButtonLoading(remove, true);
        try {
          await api('DELETE', '/api/subscriptions/' + subscription.id);
          state.subscriptions = state.subscriptions.filter((item) => item.id !== subscription.id);
          renderSubscriptions();
        } catch (error) {
          showToast(error.message, true);
          setButtonLoading(remove, false);
        }
      });
      actions.append(edit, remove);
      side.appendChild(actions);

      item.append(main, side);
      list.appendChild(item);
    });
  }

  function openSubscriptionModal(subscription) {
    state.modalReturnFocus = document.activeElement;
    state.editingSubscriptionId = subscription ? subscription.id : null;
    el('subscriptionModalTitle').textContent = subscription ? 'แก้ไข Subscription' : 'เพิ่ม Subscription';
    el('subscriptionName').value = subscription ? subscription.name : '';
    el('subscriptionPlan').value = subscription ? (subscription.plan_name || '') : '';
    el('subscriptionPrice').value = subscription ? (subscription.price || '') : '';
    el('subscriptionRenewalDate').value = subscription ? formatDueDate(subscription.renewal_date) : '';
    el('subscriptionRenewalDate').setCustomValidity('');
    el('subscriptionRenewalPicker').value = subscription && localDateFromValue(subscription.renewal_date)
      ? subscription.renewal_date
      : '';
    el('subscriptionReminderDays').value = String(subscription ? subscription.reminder_days : 7);
    el('subscriptionNotes').value = subscription ? (subscription.notes || '') : '';
    el('deleteSubscriptionBtn').classList.toggle('hidden', !subscription);
    el('subscriptionModalBackdrop').classList.remove('hidden');
    document.body.classList.add('modal-open');
    el('subscriptionName').focus();
  }

  function closeSubscriptionModal() {
    el('subscriptionModalBackdrop').classList.add('hidden');
    document.body.classList.remove('modal-open');
    state.editingSubscriptionId = null;
    if (state.modalReturnFocus && document.contains(state.modalReturnFocus)) state.modalReturnFocus.focus();
    state.modalReturnFocus = null;
  }

  el('addSubscriptionBtn').addEventListener('click', () => openSubscriptionModal(null));
  el('cancelSubscriptionBtn').addEventListener('click', closeSubscriptionModal);
  el('subscriptionRenewalDate').addEventListener('input', (event) => {
    event.target.value = formatDateInput(event.target.value);
    event.target.setCustomValidity('');
  });
  el('subscriptionRenewalDate').addEventListener('blur', (event) => {
    if (!event.target.value) return;
    const parsed = parseDisplayDate(event.target.value);
    if (!parsed) {
      event.target.setCustomValidity('กรุณาระบุวันที่ในรูปแบบ dd/mm/yyyy');
      return;
    }
    event.target.value = parsed.display;
    event.target.setCustomValidity('');
    el('subscriptionRenewalPicker').value = parsed.iso;
  });
  el('subscriptionRenewalPicker').addEventListener('change', (event) => {
    if (!event.target.value) return;
    const [year, month, day] = event.target.value.split('-');
    el('subscriptionRenewalDate').value = `${day}/${month}/${year}`;
    el('subscriptionRenewalDate').setCustomValidity('');
  });
  el('subscriptionModalBackdrop').addEventListener('click', (event) => {
    if (event.target === el('subscriptionModalBackdrop')) closeSubscriptionModal();
  });

  el('subscriptionForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const renewalInput = el('subscriptionRenewalDate');
    const parsedRenewal = parseDisplayDate(renewalInput.value);
    renewalInput.setCustomValidity('');
    if (!parsedRenewal) {
      renewalInput.setCustomValidity('กรุณาระบุวันที่ในรูปแบบ dd/mm/yyyy');
      renewalInput.reportValidity();
      return;
    }
    const payload = {
      name: el('subscriptionName').value,
      plan_name: el('subscriptionPlan').value,
      price: el('subscriptionPrice').value,
      renewal_date: parsedRenewal.iso,
      reminder_days: Number(el('subscriptionReminderDays').value),
      notes: el('subscriptionNotes').value,
    };
    const button = el('saveSubscriptionBtn');
    setButtonLoading(button, true);
    try {
      if (state.editingSubscriptionId) {
        const updated = await api('PUT', '/api/subscriptions/' + state.editingSubscriptionId, payload);
        const index = state.subscriptions.findIndex((item) => item.id === updated.id);
        if (index >= 0) state.subscriptions[index] = updated;
      } else {
        const created = await api('POST', '/api/subscriptions', payload);
        state.subscriptions.push(created);
      }
      renderSubscriptions();
      closeSubscriptionModal();
      showToast('บันทึก Subscription แล้ว');
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setButtonLoading(button, false);
    }
  });

  el('deleteSubscriptionBtn').addEventListener('click', async () => {
    if (!state.editingSubscriptionId) return;
    const confirmed = await confirmDialog({
      title: 'ลบ Subscription นี้เลยไหม?',
      text: 'ข้อมูลและการแจ้งเตือนของรายการนี้จะถูกลบไปด้วย',
      confirmText: 'ลบรายการ',
    });
    if (!confirmed) return;
    const button = el('deleteSubscriptionBtn');
    setButtonLoading(button, true);
    try {
      await api('DELETE', '/api/subscriptions/' + state.editingSubscriptionId);
      state.subscriptions = state.subscriptions.filter((item) => item.id !== state.editingSubscriptionId);
      renderSubscriptions();
      closeSubscriptionModal();
      showToast('ลบ Subscription แล้ว');
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setButtonLoading(button, false);
    }
  });

  // ---------------- notes ----------------

  async function loadNotes(append = false) {
    const query = new URLSearchParams({ limit: '50' });
    if (append && state.notesNextCursor) query.set('before', String(state.notesNextCursor));
    const result = await api('GET', `/api/notes?${query}`);
    state.notes = append ? state.notes.concat(result.items) : result.items;
    state.notesNextCursor = result.nextCursor;
    state.notesTotal = result.totalCount;
  }

  function renderNotes() {
    const list = el('notesList');
    el('sidebarNoteCount').textContent = state.notesTotal;
    list.innerHTML = '';
    el('loadMoreNotesBtn').classList.toggle('hidden', !state.notesNextCursor);
    if (state.notes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'quad-empty';
      empty.textContent = 'ยังไม่มีบันทึกด่วน ลองจดอะไรสักอย่างดูสิ';
      list.appendChild(empty);
      return;
    }
    state.notes.forEach((note) => {
      const item = document.createElement('div');
      item.className = 'note-item';

      const left = document.createElement('div');
      const text = document.createElement('div');
      text.className = 'note-text';
      text.textContent = note.content;
      const time = document.createElement('div');
      time.className = 'note-time';
      time.textContent = formatDisplayDateTime(note.created_at.replace(' ', 'T') + 'Z');
      left.appendChild(text);
      left.appendChild(time);

      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.type = 'button';
      del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M9 7V4h6v3m-9 0 1 13h10l1-13"/></svg>';
      del.title = 'ลบ';
      del.setAttribute('aria-label', 'ลบบันทึกด่วน');
      del.addEventListener('click', async () => {
        setButtonLoading(del, true);
        try {
          await api('DELETE', `/api/notes/${note.id}`);
          state.notes = state.notes.filter((n) => n.id !== note.id);
          state.notesTotal = Math.max(0, state.notesTotal - 1);
          renderNotes();
        } catch (err) {
          showToast(err.message, true);
          setButtonLoading(del, false);
        }
      });

      item.appendChild(left);
      item.appendChild(del);
      list.appendChild(item);
    });
  }

  el('saveNoteBtn').addEventListener('click', async () => {
    const content = el('noteInput').value.trim();
    if (!content) return;
    const button = el('saveNoteBtn');
    setButtonLoading(button, true);
    try {
      const note = await api('POST', '/api/notes', { content });
      state.notes.unshift(note);
      state.notesTotal += 1;
      el('noteInput').value = '';
      renderNotes();
      showToast('บันทึกแล้ว');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setButtonLoading(button, false);
    }
  });

  el('loadMoreNotesBtn').addEventListener('click', async () => {
    const button = el('loadMoreNotesBtn');
    setButtonLoading(button, true);
    try {
      await loadNotes(true);
      renderNotes();
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setButtonLoading(button, false);
    }
  });

  // ---------------- quick jot fab ----------------

  el('quickJotFab').addEventListener('click', () => {
    state.modalReturnFocus = document.activeElement;
    el('jotInput').value = '';
    el('jotModalBackdrop').classList.remove('hidden');
    document.body.classList.add('modal-open');
    el('jotInput').focus();
  });
  function closeJotModal() {
    el('jotModalBackdrop').classList.add('hidden');
    document.body.classList.remove('modal-open');
    if (state.modalReturnFocus && document.contains(state.modalReturnFocus)) state.modalReturnFocus.focus();
    state.modalReturnFocus = null;
  }
  el('cancelJotBtn').addEventListener('click', closeJotModal);
  el('jotModalBackdrop').addEventListener('click', (e) => {
    if (e.target === el('jotModalBackdrop')) closeJotModal();
  });
  document.addEventListener('keydown', (event) => {
    const activeBackdrop = [
      el('taskModalBackdrop'),
      el('jotModalBackdrop'),
      el('subscriptionModalBackdrop'),
    ]
      .find((backdrop) => !backdrop.classList.contains('hidden'));
    if (!activeBackdrop) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (activeBackdrop === el('taskModalBackdrop')) closeTaskModal();
      else if (activeBackdrop === el('jotModalBackdrop')) closeJotModal();
      else closeSubscriptionModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(activeBackdrop.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((item) => !item.classList.contains('hidden') && item.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  el('saveJotBtn').addEventListener('click', async () => {
    const content = el('jotInput').value.trim();
    if (!content) return;
    const button = el('saveJotBtn');
    setButtonLoading(button, true);
    try {
      const note = await api('POST', '/api/notes', { content });
      state.notes.unshift(note);
      state.notesTotal += 1;
      renderNotes();
      closeJotModal();
      showToast('จดด่วนแล้ว');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setButtonLoading(button, false);
    }
  });

  // ---------------- settings ----------------

  async function loadSettings() {
    state.settings = await api('GET', '/api/settings');
  }

  function renderSettings() {
    const s = state.settings;
    el('botToken').value = '';
    el('botTokenStatus').textContent = s.telegram_bot_configured
      ? 'ตั้งค่า Token แล้ว — เว้นว่างไว้เพื่อใช้ค่าเดิม'
      : 'ยังไม่ได้ตั้งค่า Token';
    el('clearTelegramBtn').classList.toggle('hidden', !s.telegram_bot_configured);
    el('chatId').value = s.telegram_chat_id || '';
    el('notifyBefore').value = String(s.notify_before_minutes || 60);
    syncCustomSelect(el('notifyBefore'));
    el('subscriptionNotifyToggle').classList.toggle('on', !!s.subscription_notify_enabled);
    el('subscriptionNotifyToggle').setAttribute('aria-pressed', String(!!s.subscription_notify_enabled));
    el('dailySummaryToggle').classList.toggle('on', !!s.daily_summary_enabled);
    el('dailySummaryToggle').setAttribute('aria-pressed', String(!!s.daily_summary_enabled));
    el('dailySummaryTime').value = s.daily_summary_time || '08:00';
  }

  el('subscriptionNotifyToggle').addEventListener('click', () => {
    const toggle = el('subscriptionNotifyToggle');
    const active = toggle.classList.toggle('on');
    toggle.setAttribute('aria-pressed', String(active));
  });

  el('dailySummaryToggle').addEventListener('click', () => {
    const toggle = el('dailySummaryToggle');
    const active = toggle.classList.toggle('on');
    toggle.setAttribute('aria-pressed', String(active));
  });

  function settingsPayload(options = {}) {
    const payload = {
      telegram_chat_id: el('chatId').value.trim(),
      notify_before_minutes: Number(el('notifyBefore').value),
      subscription_notify_enabled: el('subscriptionNotifyToggle').classList.contains('on'),
      daily_summary_enabled: el('dailySummaryToggle').classList.contains('on'),
      daily_summary_time: el('dailySummaryTime').value,
    };
    const token = el('botToken').value.trim();
    if (token && !options.clearToken) payload.telegram_bot_token = token;
    if (options.clearToken) payload.clear_telegram_bot_token = true;
    return payload;
  }

  el('saveSettingsBtn').addEventListener('click', async () => {
    const button = el('saveSettingsBtn');
    setButtonLoading(button, true);
    try {
      const updated = await api('PUT', '/api/settings', settingsPayload());
      state.settings = updated;
      renderSettings();
      showToast('บันทึกการตั้งค่าแล้ว');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setButtonLoading(button, false);
    }
  });

  el('testTelegramBtn').addEventListener('click', async () => {
    const button = el('testTelegramBtn');
    setButtonLoading(button, true);
    try {
      state.settings = await api('PUT', '/api/settings', settingsPayload());
      renderSettings();
      await api('POST', '/api/settings/test-telegram');
      showToast('ส่งข้อความทดสอบสำเร็จ เช็ค Telegram ได้เลย');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setButtonLoading(button, false);
    }
  });

  el('clearTelegramBtn').addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'ลบ Telegram Bot Token?',
      text: 'ระบบจะหยุดส่งการแจ้งเตือนผ่าน Telegram จนกว่าจะตั้งค่า Token ใหม่',
      confirmText: 'ลบ Token',
    });
    if (!confirmed) return;
    const button = el('clearTelegramBtn');
    setButtonLoading(button, true);
    try {
      state.settings = await api('PUT', '/api/settings', settingsPayload({ clearToken: true }));
      renderSettings();
      showToast('ลบ Telegram Bot Token แล้ว');
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setButtonLoading(button, false);
    }
  });

  el('changePasswordBtn').addEventListener('click', async () => {
    const current = el('currentPassword').value;
    const next = el('newPassword').value;
    const button = el('changePasswordBtn');
    setButtonLoading(button, true);
    try {
      await api('PUT', '/api/settings/password', { current_password: current, new_password: next });
      el('currentPassword').value = '';
      el('newPassword').value = '';
      showToast('เปลี่ยนรหัสผ่านแล้ว');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setButtonLoading(button, false);
    }
  });

  // ---------------- appearance ----------------

  document.querySelectorAll('.theme-option').forEach((button) => {
    button.addEventListener('click', () => applyTheme(button.dataset.themeValue, true));
  });

  systemThemeQuery.addEventListener('change', () => {
    if (state.themePreference === 'system') applyTheme('system');
  });

  // ---------------- boot ----------------

  setupCustomSelects();
  applyTheme(readThemePreference());

  initAuth().then(async () => {
    if (state.authenticated) return null;
    try {
      return await refreshGoogleAuth();
    } catch (error) {
      console.warn(error);
      el('googleLoginPlaceholder').classList.remove('hidden');
      el('googleLoginButton').classList.add('hidden');
      el('googleAuthHint').textContent = 'โหลดบริการ Google ไม่สำเร็จ — ยังเข้าสู่ระบบด้วยรหัสผ่านได้ตามปกติ';
      return null;
    }
  }).catch((err) => {
    console.error(err);
    state.authenticated = false;
    el('appScreen').classList.add('hidden');
    el('authScreen').classList.remove('hidden');
    el('loginForm').classList.remove('hidden');
    showAuthError(
      window.location.protocol === 'file:'
        ? 'กรุณาเปิดแอปผ่านเซิร์ฟเวอร์ที่ http://localhost:3000 ไม่ควรเปิดไฟล์ index.html โดยตรง'
        : 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบว่าเซิร์ฟเวอร์กำลังทำงานแล้วลองใหม่',
    );
  });
})();
