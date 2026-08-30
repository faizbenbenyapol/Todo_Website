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
    filter: { status: 'all', tag: '' },
    draftTags: [],
    draftSubtasks: [],
    subscriptionGroupBy: 'category',
    taskSourceNoteId: null,
  };

  const FILTER_STORAGE_KEY = 'eisenhower-filter';
  const SUBSCRIPTION_GROUP_KEY = 'eisenhower-subscription-group';

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

  function setDueTimeEnabled(enabled) {
    const toggle = el('taskHasTimeToggle');
    toggle.classList.toggle('on', enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    el('taskDueTime').classList.toggle('hidden', !enabled);
  }

  function isDueTimeEnabled() {
    return el('taskHasTimeToggle').classList.contains('on');
  }

  function setTaskDueValue(dueDate, hasTime = false) {
    const dateInput = el('taskDueDate');
    const picker = el('taskDuePicker');
    const timeInput = el('taskDueTime');

    dateInput.setCustomValidity('');

    const date = new Date(dueDate);
    if (!dueDate || Number.isNaN(date.getTime())) {
      dateInput.value = '';
      picker.value = '';
      timeInput.value = '09:00';
      setDueTimeEnabled(false);
      return;
    }

    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    dateInput.value = `${day}/${month}/${year}`;
    picker.value = `${year}-${month}-${day}`;
    timeInput.value = hasTime ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}` : '09:00';
    setDueTimeEnabled(Boolean(hasTime));
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

    if (isDueTimeEnabled()) {
      const timeInput = el('taskDueTime');
      const time = String(timeInput.value || '').match(/^(\d{2}):(\d{2})$/);
      if (!time) {
        timeInput.setCustomValidity('กรุณาระบุเวลาให้ถูกต้อง');
        timeInput.reportValidity();
        return undefined;
      }
      timeInput.setCustomValidity('');
      return new Date(year, month - 1, day, Number(time[1]), Number(time[2]), 0, 0).toISOString();
    }

    // A date-only deadline means the end of that local day.
    return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
  }

  function formatDueDate(dueDate) {
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return dueDate;
    return `${pad2(due.getDate())}/${pad2(due.getMonth() + 1)}/${due.getFullYear()}`;
  }

  function formatTaskDue(task) {
    if (!task.due_date) return '';
    const due = new Date(task.due_date);
    if (Number.isNaN(due.getTime())) return task.due_date;
    const date = formatDueDate(due);
    return task.due_has_time ? `${date} ${pad2(due.getHours())}:${pad2(due.getMinutes())}` : date;
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

  // ---------------- version / what's new ----------------

  const CHANGELOG = [
    {
      version: '0.7.0',
      date: '2026-08-30',
      items: [
        'ลากวางงานข้ามช่องและจัดลำดับได้ รองรับทั้งเมาส์ การลากด้วยนิ้ว และปุ่มลูกศรเมื่อโฟกัสที่ปุ่มจับ',
        'ปุ่มยืนยันการจ่าย Subscription ที่เลื่อนวันต่ออายุไปรอบถัดไปให้อัตโนมัติ พร้อมเก็บประวัติการจ่าย',
        'สร้างงานจากบันทึกด่วนได้ในคลิกเดียว',
        'เพิ่มหน้าสถิติ: งานที่ปิดได้รายวัน งานค้างแยกตามช่อง และค่าใช้จ่าย Subscription',
        'สำรองข้อมูลอัตโนมัติวันละครั้งลงโฟลเดอร์ data/backups',
      ],
    },
    {
      version: '0.6.0',
      date: '2026-08-22',
      items: [
        'กรองงานบนบอร์ดตามสถานะ กำหนดส่ง และแท็กได้',
        'ตั้งเวลาในกำหนดส่ง และตั้งงานประจำที่สร้างรอบถัดไปให้อัตโนมัติ',
        'เพิ่มแท็กและงานย่อยในแต่ละงาน',
        'สำรองและกู้คืนข้อมูลทั้งหมดเป็นไฟล์ JSON',
        'ติดตั้งเป็นแอปบนมือถือได้ และเปิดดูงานได้แม้ออฟไลน์',
        'Subscription เก็บราคาเป็นตัวเลข พร้อมสกุลเงินและรอบบิล แล้วสรุปยอดรวมต่อเดือนและต่อปีให้',
        'จัดกลุ่ม Subscription ตามกลุ่มที่ตั้งเอง รอบบิล หรือสถานะ พร้อมยอดรวมของแต่ละกลุ่ม',
      ],
    },
    {
      version: '0.5.0',
      date: '2026-08-12',
      items: [
        'งานที่เสร็จแล้วเลือกได้ว่าจะเก็บถาวรหรือลบทิ้ง',
        'เพิ่มหน้าต่าง "งานที่เก็บถาวร" ดูย้อนหลัง กู้คืน หรือลบถาวรได้',
        'จัดกลุ่มงานที่เก็บถาวรตามเดือน เลื่อนดูทีละเดือนได้',
      ],
    },
    {
      version: '0.4.0',
      date: '2026-07-27',
      items: [
        'เพิ่มการแจ้งเตือน Subscription ใกล้หมดอายุผ่าน Telegram',
        'เพิ่มตัวเลือกวันที่แบบปฏิทิน (date picker) ในฟอร์มงานและ Subscription',
        'เพิ่มธีมสีนุ่มตาใหม่หลายแบบ',
      ],
    },
    {
      version: '0.3.0',
      date: '2026-07-23',
      items: ['ปรับดีไซน์ทั้งแอปใหม่ในสไตล์ flat/minimal'],
    },
    {
      version: '0.2.0',
      date: '2026-07-23',
      items: ['เพิ่มการแจ้งเตือนผ่าน Push Notification และขยายความสามารถจัดการงาน'],
    },
    {
      version: '0.1.0',
      date: '2026-07-19',
      items: ['เปิดตัว Eisenhower Board เวอร์ชันแรก จัดการงานด้วยตาราง 4 ช่อง ด่วน/สำคัญ'],
    },
  ];
  const CURRENT_VERSION = CHANGELOG[0];

  function renderVersionPanel() {
    el('versionBadgeLabel').textContent = `v${CURRENT_VERSION.version}`;
    const body = el('versionPanelBody');
    body.innerHTML = '';

    const current = document.createElement('div');
    current.className = 'version-entry-current';
    const head = document.createElement('div');
    head.innerHTML = `<span class="version-entry-tag">v${CURRENT_VERSION.version}</span><span class="version-entry-date">${formatDueDate(CURRENT_VERSION.date)}</span>`;
    current.appendChild(head);
    const list = document.createElement('ul');
    list.className = 'version-entry-list';
    CURRENT_VERSION.items.forEach((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
    current.appendChild(list);
    body.appendChild(current);

    const previous = CHANGELOG.slice(1);
    if (previous.length > 0) {
      body.appendChild(document.createElement('hr')).className = 'version-panel-divider';
      const label = document.createElement('div');
      label.className = 'version-panel-prev-label';
      label.textContent = 'เวอร์ชันก่อนหน้า';
      body.appendChild(label);
      previous.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'version-prev-row';
        row.innerHTML = `<span class="version-entry-tag">v${entry.version}</span><span class="version-entry-date">${formatDueDate(entry.date)}</span>`;
        body.appendChild(row);
      });
    }
  }

  function toggleVersionPanel(show) {
    const panel = el('versionPanel');
    const open = show === undefined ? panel.classList.contains('hidden') : show;
    panel.classList.toggle('hidden', !open);
    el('versionBadgeBtn').setAttribute('aria-expanded', String(open));
  }

  renderVersionPanel();
  el('versionBadgeBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleVersionPanel();
  });
  el('closeVersionPanelBtn').addEventListener('click', () => toggleVersionPanel(false));
  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.version-badge-wrap');
    if (wrap && !wrap.contains(e.target)) toggleVersionPanel(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleVersionPanel(false);
  });

  // ---------------- nav ----------------

  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item[data-view]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      el('view-' + btn.dataset.view).classList.add('active');
      el('quickJotFab').hidden = btn.dataset.view === 'settings';
      if (btn.dataset.view === 'settings') updateGoogleConnectionUi();
      if (btn.dataset.view === 'stats') loadStats();
    });
  });

  // ---------------- tasks / matrix ----------------

  async function loadTasks() {
    state.tasks = await api('GET', '/api/tasks');
  }

  function byPosition(a, b) {
    return (a.position - b.position) || (a.id - b.id);
  }

  function dueBadgeInfo(task) {
    if (!task.due_date) return null;
    const due = new Date(task.due_date);
    const now = new Date();
    const label = formatTaskDue(task);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfDueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());

    if (due < now) return { label, cls: 'overdue' };
    if (startOfDueDay.getTime() === startOfToday.getTime()) return { label, cls: 'today' };
    return { label, cls: '' };
  }

  // ---------------- ตัวกรองงาน ----------------

  const FILTER_LABELS = {
    all: 'ทั้งหมด',
    pending: 'ยังไม่เสร็จ',
    completed: 'เสร็จแล้ว',
    overdue: 'เลยกำหนด',
    today: 'ครบกำหนดวันนี้',
    week: 'ภายใน 7 วัน',
  };

  function readFilterPreference() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(FILTER_STORAGE_KEY) || '{}');
      return {
        status: FILTER_LABELS[saved.status] ? saved.status : 'all',
        tag: typeof saved.tag === 'string' ? saved.tag : '',
      };
    } catch {
      return { status: 'all', tag: '' };
    }
  }

  function saveFilterPreference() {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(state.filter));
    } catch { /* โหมดส่วนตัวของเบราว์เซอร์อาจปิดการเขียน */ }
  }

  function matchesFilter(task) {
    const { status, tag } = state.filter;
    if (tag && !(task.tags || []).some((item) => item.toLowerCase() === tag.toLowerCase())) return false;
    if (status === 'all') return true;
    if (status === 'pending') return !task.completed;
    if (status === 'completed') return Boolean(task.completed);

    if (!task.due_date) return false;
    const due = new Date(task.due_date);
    if (Number.isNaN(due.getTime())) return false;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfDueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());

    if (status === 'overdue') return !task.completed && due < now;
    if (status === 'today') return startOfDueDay.getTime() === startOfToday.getTime();
    if (status === 'week') {
      const weekAhead = startOfToday.getTime() + (7 * 86400000);
      return startOfDueDay.getTime() >= startOfToday.getTime() && startOfDueDay.getTime() <= weekAhead;
    }
    return true;
  }

  function filterIsActive() {
    return state.filter.status !== 'all' || Boolean(state.filter.tag);
  }

  function allTags() {
    const seen = new Map();
    state.tasks.forEach((task) => {
      (task.tags || []).forEach((tag) => {
        const key = tag.toLowerCase();
        if (!seen.has(key)) seen.set(key, tag);
      });
    });
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'th'));
  }

  function renderTagFilterOptions() {
    const select = el('taskTagFilter');
    const tags = allTags();
    const current = state.filter.tag;
    select.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'ทุกแท็ก';
    select.appendChild(allOption);
    tags.forEach((tag) => {
      const option = document.createElement('option');
      option.value = tag;
      option.textContent = tag;
      select.appendChild(option);
    });
    // แท็กที่ถูกลบไปแล้วต้องไม่ค้างเป็นตัวกรองที่ไม่มีวันตรงกับงานใด
    if (current && !tags.some((tag) => tag === current)) state.filter.tag = '';
    select.value = state.filter.tag;

    const suggestions = el('taskTagSuggestions');
    suggestions.innerHTML = '';
    tags.forEach((tag) => {
      const option = document.createElement('option');
      option.value = tag;
      suggestions.appendChild(option);
    });
  }

  function renderFilterBar(visibleCount) {
    document.querySelectorAll('.filter-chip').forEach((chip) => {
      const active = chip.dataset.filter === state.filter.status;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
    });
    el('clearFilterBtn').classList.toggle('hidden', !filterIsActive());

    const summary = el('filterSummary');
    if (!filterIsActive()) {
      summary.classList.add('hidden');
      summary.textContent = '';
      return;
    }
    const parts = [FILTER_LABELS[state.filter.status]];
    if (state.filter.tag) parts.push(`แท็ก “${state.filter.tag}”`);
    summary.textContent = `กำลังกรอง: ${parts.join(' · ')} — พบ ${visibleCount} จาก ${state.tasks.length} งาน`;
    summary.classList.remove('hidden');
  }

  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.filter.status = chip.dataset.filter;
      saveFilterPreference();
      renderMatrix();
    });
  });

  el('taskTagFilter').addEventListener('change', (event) => {
    state.filter.tag = event.target.value;
    saveFilterPreference();
    renderMatrix();
  });

  el('clearFilterBtn').addEventListener('click', () => {
    state.filter = { status: 'all', tag: '' };
    saveFilterPreference();
    renderMatrix();
  });

  function updateSidebarTaskCount() {
    const pending = state.tasks.filter((task) => !task.completed).length;
    el('sidebarTaskCount').textContent = pending;
    const dashboardPending = el('dashboardPendingCount');
    if (dashboardPending) dashboardPending.textContent = pending;
  }

  function renderMatrix() {
    updateSidebarTaskCount();
    renderTagFilterOptions();
    const visible = state.tasks.filter(matchesFilter);
    const grouped = new Map(QUADRANTS.map((quadrant) => [quadrant, []]));
    visible.forEach((task) => grouped.get(task.quadrant)?.push(task));
    QUADRANTS.forEach((q) => {
      // เรียงตาม position ทุกครั้ง ไม่พึ่งลำดับใน state.tasks ซึ่งอาจค้างของเดิมหลังลากวางหรือย้ายช่อง
      const list = grouped.get(q).sort(byPosition);
      const container = document.querySelector(`[data-list="${q}"]`);
      const countEl = document.querySelector(`[data-count="${q}"]`);
      countEl.textContent = list.length;

      container.innerHTML = '';
      if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'quad-empty';
        empty.textContent = filterIsActive() ? 'ไม่มีงานที่ตรงกับตัวกรอง' : 'ยังไม่มีงานในหมวดนี้';
        container.appendChild(empty);
        return;
      }

      list.forEach((task) => {
        container.appendChild(renderTaskCard(task));
      });
    });
    renderFilterBar(visible.length);
  }

  const RECUR_LABELS = {
    daily: 'ทุกวัน',
    weekly: 'ทุกสัปดาห์',
    monthly: 'ทุกเดือน',
    yearly: 'ทุกปี',
  };
  const RECUR_UNITS = { daily: 'วัน', weekly: 'สัปดาห์', monthly: 'เดือน', yearly: 'ปี' };

  function recurLabel(task) {
    if (!task.recur_rule || !RECUR_LABELS[task.recur_rule]) return '';
    const interval = Number(task.recur_interval) || 1;
    if (interval === 1) return RECUR_LABELS[task.recur_rule];
    return `ทุก ${interval} ${RECUR_UNITS[task.recur_rule]}`;
  }

  // สลับสถานะงานย่อยโดยส่งรายการทั้งชุดกลับไป เพราะ API เก็บงานย่อยเป็นชุดเดียวกับงาน
  async function toggleSubtask(task, index) {
    const subtasks = task.subtasks.map((subtask, position) => ({
      title: subtask.title,
      completed: position === index ? !subtask.completed : subtask.completed,
    }));
    const updated = await api('PUT', `/api/tasks/${task.id}`, { subtasks });
    const idx = state.tasks.findIndex((item) => item.id === task.id);
    if (idx >= 0) state.tasks[idx] = updated;
    renderMatrix();
  }

  function renderTaskCard(task) {
    const card = document.createElement('div');
    card.className = 'task-card' + (task.completed ? ' completed' : '');
    card.dataset.taskId = String(task.id);

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
        if (updated.next_task) {
          state.tasks.push(updated.next_task);
          showToast(`สร้างงานรอบถัดไปแล้ว — กำหนด ${formatTaskDue(updated.next_task)}`);
        }
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

    const subtasks = task.subtasks || [];
    if (subtasks.length > 0) {
      const done = subtasks.filter((subtask) => subtask.completed).length;
      const progress = document.createElement('div');
      progress.className = 'subtask-progress';

      const bar = document.createElement('span');
      bar.className = 'subtask-bar';
      const fill = document.createElement('span');
      fill.style.width = `${Math.round((done / subtasks.length) * 100)}%`;
      bar.appendChild(fill);
      progress.appendChild(bar);

      const count = document.createElement('span');
      count.className = 'subtask-count';
      count.textContent = `${done}/${subtasks.length}`;
      progress.appendChild(count);
      main.appendChild(progress);

      const list = document.createElement('ul');
      list.className = 'subtask-list';
      subtasks.forEach((subtask, index) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'subtask-item' + (subtask.completed ? ' done' : '');
        button.innerHTML = '<span class="subtask-tick" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m3.5 8 3 3 6-6"/></svg></span>';
        const label = document.createElement('span');
        label.textContent = subtask.title;
        button.appendChild(label);
        button.setAttribute('aria-pressed', String(Boolean(subtask.completed)));
        button.setAttribute(
          'aria-label',
          `งานย่อย ${subtask.title} — ${subtask.completed ? 'เสร็จแล้ว' : 'ยังไม่เสร็จ'}`,
        );
        button.addEventListener('click', async (e) => {
          e.stopPropagation();
          setButtonLoading(button, true);
          try {
            await toggleSubtask(task, index);
          } catch (err) {
            showToast(err.message, true);
            setButtonLoading(button, false);
          }
        });
        item.appendChild(button);
        list.appendChild(item);
      });
      main.appendChild(list);
    }

    const meta = document.createElement('div');
    meta.className = 'task-meta';

    const badge = dueBadgeInfo(task);
    if (badge) {
      const due = document.createElement('span');
      due.className = 'task-due ' + badge.cls;
      due.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg><span>' + badge.label + '</span>';
      meta.appendChild(due);
    }

    const recurring = recurLabel(task);
    if (recurring) {
      const chip = document.createElement('span');
      chip.className = 'task-recur';
      chip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9a8 8 0 0 1 13.6-4.6L20 7M20 15a8 8 0 0 1-13.6 4.6L4 17"/><path d="M20 4v3h-3M4 20v-3h3"/></svg><span>' + recurring + '</span>';
      meta.appendChild(chip);
    }

    (task.tags || []).forEach((tag) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'task-tag' + (state.filter.tag === tag ? ' active' : '');
      chip.textContent = tag;
      chip.title = `กรองเฉพาะแท็ก ${tag}`;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        state.filter.tag = state.filter.tag === tag ? '' : tag;
        saveFilterPreference();
        renderMatrix();
      });
      meta.appendChild(chip);
    });

    if (meta.childElementCount > 0) main.appendChild(meta);

    main.addEventListener('click', () => openTaskModal(task.quadrant, task));

    const actions = document.createElement('div');
    actions.className = 'task-actions';

    const handle = document.createElement('button');
    handle.className = 'icon-btn task-drag-handle';
    handle.type = 'button';
    handle.title = 'ลากเพื่อย้าย หรือโฟกัสปุ่มนี้แล้วใช้ลูกศร (ซ้าย/ขวา = เปลี่ยนช่อง, ขึ้น/ลง = จัดลำดับ)';
    handle.setAttribute('aria-label', `ย้ายงาน ${task.title} — ลากได้ หรือใช้ปุ่มลูกศรเมื่อโฟกัสอยู่ที่ปุ่มนี้`);
    handle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startDrag(e, card, task);
    });
    handle.addEventListener('keydown', (e) => {
      const actions = {
        ArrowLeft: () => moveTaskToQuadrant(task, -1),
        ArrowRight: () => moveTaskToQuadrant(task, 1),
        ArrowUp: () => moveTaskWithinQuadrant(task, -1),
        ArrowDown: () => moveTaskWithinQuadrant(task, 1),
      };
      const action = actions[e.key];
      if (!action) return;
      e.preventDefault();
      action();
    });
    actions.appendChild(handle);

    if (task.completed) {
      const archive = document.createElement('button');
      archive.className = 'icon-btn';
      archive.type = 'button';
      archive.title = 'เก็บถาวร';
      archive.setAttribute('aria-label', `เก็บถาวรงาน ${task.title}`);
      archive.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v3H4z"/><path d="M5 9v11h14V9M10 13h4"/></svg>';
      archive.addEventListener('click', async (e) => {
        e.stopPropagation();
        setButtonLoading(archive, true);
        try {
          await api('PUT', `/api/tasks/${task.id}`, { archived: true });
          state.tasks = state.tasks.filter((t) => t.id !== task.id);
          renderMatrix();
        } catch (err) {
          showToast(err.message, true);
          setButtonLoading(archive, false);
        }
      });
      actions.appendChild(archive);
    }

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

  // ---------------- ลากวางงาน ----------------

  // ใช้ pointer events แทน HTML5 drag เพื่อให้ลากด้วยนิ้วบนมือถือได้เหมือนกับเมาส์
  const drag = {
    active: false,
    taskId: null,
    ghost: null,
    placeholder: null,
    pointerId: null,
    offsetX: 0,
    offsetY: 0,
    startX: 0,
    startY: 0,
    started: false,
  };
  const DRAG_THRESHOLD = 6;

  function createPlaceholder(height) {
    const placeholder = document.createElement('div');
    placeholder.className = 'task-placeholder';
    placeholder.style.height = `${height}px`;
    return placeholder;
  }

  // ชี้ตรงไหนของช่องก็ได้ ไม่ต้องเล็งให้โดนรายการงานพอดี
  function findDropBody(clientX, clientY) {
    const direct = document.elementFromPoint(clientX, clientY)?.closest('.quad-body');
    if (direct) return direct;
    return [...document.querySelectorAll('.quad-body')].find((body) => {
      const rect = (body.closest('.quad-card') || body).getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }) || null;
  }

  // รายการงานในช่องเลื่อนได้ จึงต้องเลื่อนตามเมื่อลากไปชิดขอบ ไม่งั้นวางท้ายรายการยาว ๆ ไม่ได้
  function autoScrollBody(body, clientY) {
    const rect = body.getBoundingClientRect();
    const edge = 40;
    if (clientY > rect.bottom - edge) body.scrollTop += 14;
    else if (clientY < rect.top + edge) body.scrollTop -= 14;
  }

  function movePlaceholder(clientX, clientY) {
    const body = findDropBody(clientX, clientY);
    if (!body) return;
    autoScrollBody(body, clientY);
    const cards = [...body.querySelectorAll('.task-card')].filter((card) => !card.classList.contains('dragging'));
    const next = cards.find((card) => {
      const rect = card.getBoundingClientRect();
      return clientY < rect.top + (rect.height / 2);
    });
    if (next) body.insertBefore(drag.placeholder, next);
    else body.appendChild(drag.placeholder);
  }

  // แปลงตำแหน่งที่วางเป็นลำดับจริง โดยอ้างอิงงานที่มองเห็นอยู่ เพื่อให้ลากตอนเปิดตัวกรองไว้ก็ยังถูกต้อง
  function buildReorderPayload(taskId, targetQuadrant, siblingIdsAfterDrop) {
    const dragged = state.tasks.find((task) => task.id === taskId);
    if (!dragged) return null;
    const sourceQuadrant = dragged.quadrant;

    // ต้องเรียงตาม position เสมอ เพราะลำดับใน state.tasks ไม่ขยับตามตอนอัปเดตหน้าจอแบบทันที
    const targetList = state.tasks
      .filter((task) => task.quadrant === targetQuadrant && task.id !== taskId)
      .sort(byPosition);
    const visibleOrder = siblingIdsAfterDrop;
    const dropIndexInVisible = visibleOrder.indexOf(taskId);
    const beforeId = dropIndexInVisible > 0 ? visibleOrder[dropIndexInVisible - 1] : null;
    const insertAt = beforeId === null
      ? 0
      : targetList.findIndex((task) => task.id === beforeId) + 1;

    const reordered = [...targetList];
    reordered.splice(insertAt < 0 ? reordered.length : insertAt, 0, dragged);

    const items = reordered.map((task, index) => ({
      id: task.id,
      quadrant: targetQuadrant,
      position: index + 1,
    }));

    if (sourceQuadrant !== targetQuadrant) {
      state.tasks
        .filter((task) => task.quadrant === sourceQuadrant && task.id !== taskId)
        .sort(byPosition)
        .forEach((task, index) => items.push({ id: task.id, quadrant: sourceQuadrant, position: index + 1 }));
    }
    return items;
  }

  async function finishDrag(commit, moved = commit) {
    const card = document.querySelector('.task-card.dragging');
    const placeholder = drag.placeholder;
    const taskId = drag.taskId;
    const body = placeholder && placeholder.parentElement;

    if (drag.ghost) drag.ghost.remove();
    if (card) card.classList.remove('dragging');
    document.body.classList.remove('dragging-task');

    drag.active = false;
    drag.started = false;
    drag.ghost = null;
    drag.placeholder = null;
    drag.taskId = null;
    drag.pointerId = null;

    if (!commit || !placeholder || !body) {
      if (placeholder) placeholder.remove();
      // แค่กดปุ่มจับแล้วปล่อยโดยไม่ลาก ไม่ต้องวาดบอร์ดใหม่ ไม่งั้นโฟกัสของปุ่มหลุดจนใช้คีย์ลัดต่อไม่ได้
      if (moved) renderMatrix();
      return;
    }

    const targetQuadrant = Number(body.dataset.list);
    // การ์ดต้นทางยังอยู่ในหน้าเดิมระหว่างลาก ถ้าไม่ตัดออกจะได้รหัสงานซ้ำและอ่านตำแหน่งที่วางผิด
    const visibleOrder = [...body.children]
      .filter((child) => child === placeholder || !child.classList.contains('dragging'))
      .map((child) => (child === placeholder ? taskId : Number(child.dataset.taskId)))
      .filter((value) => Number.isInteger(value));
    placeholder.remove();

    const items = buildReorderPayload(taskId, targetQuadrant, visibleOrder);
    if (!items) {
      renderMatrix();
      return;
    }

    // อัปเดตหน้าจอทันทีเพื่อไม่ให้การ์ดกระโดดกลับ แล้วค่อยยืนยันกับเซิร์ฟเวอร์
    const positions = new Map(items.map((item) => [item.id, item]));
    state.tasks = state.tasks.map((task) => (
      positions.has(task.id)
        ? { ...task, quadrant: positions.get(task.id).quadrant, position: positions.get(task.id).position }
        : task
    ));
    renderMatrix();

    await saveOrder(items);
  }

  // ลากติด ๆ กันหลายครั้ง คำตอบของรอบเก่าอาจกลับมาทีหลังและทับลำดับล่าสุด จึงรับเฉพาะคำตอบของรอบล่าสุด
  let reorderSequence = 0;

  async function saveOrder(items) {
    reorderSequence += 1;
    const sequence = reorderSequence;
    try {
      const tasks = await api('PUT', '/api/tasks/reorder', { items });
      if (sequence !== reorderSequence) return;
      state.tasks = tasks;
      renderMatrix();
    } catch (error) {
      showToast(error.message, true);
      if (sequence !== reorderSequence) return;
      try {
        await loadTasks();
      } catch { /* จะซิงก์ใหม่ตอนโหลดหน้าถัดไป */ }
      renderMatrix();
    }
  }

  function onDragMove(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (moved < DRAG_THRESHOLD) return;
      drag.started = true;
    }
    event.preventDefault();
    drag.ghost.style.left = `${event.clientX - drag.offsetX}px`;
    drag.ghost.style.top = `${event.clientY - drag.offsetY}px`;
    drag.ghost.hidden = true;
    movePlaceholder(event.clientX, event.clientY);
    drag.ghost.hidden = false;
  }

  function onDragEnd(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragCancel);
    finishDrag(drag.started);
  }

  function onDragCancel(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragCancel);
    finishDrag(false, drag.started);
  }

  function startDrag(event, card, task) {
    if (event.button !== undefined && event.button !== 0) return;
    // preventDefault กันการลากเลือกข้อความ แต่ทำให้ปุ่มไม่ได้โฟกัสเอง จึงต้องสั่งโฟกัสให้
    if (event.currentTarget && typeof event.currentTarget.focus === 'function') event.currentTarget.focus();
    const rect = card.getBoundingClientRect();

    drag.active = true;
    drag.started = false;
    drag.taskId = task.id;
    drag.pointerId = event.pointerId;
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.offsetX = event.clientX - rect.left;
    drag.offsetY = event.clientY - rect.top;

    const ghost = card.cloneNode(true);
    ghost.classList.add('task-ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    document.body.appendChild(ghost);
    drag.ghost = ghost;

    drag.placeholder = createPlaceholder(rect.height);
    card.parentElement.insertBefore(drag.placeholder, card.nextSibling);
    card.classList.add('dragging');
    document.body.classList.add('dragging-task');

    window.addEventListener('pointermove', onDragMove, { passive: false });
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragCancel);
  }

  // ทางลัดคีย์บอร์ดสำหรับคนที่ลากไม่ได้ — ใช้ลูกศรตอนโฟกัสอยู่ที่ปุ่มจับ
  // เลี่ยง Alt + ลูกศร เพราะเป็นปุ่มถอยหลัง/ไปหน้าของเบราว์เซอร์
  async function moveTaskToQuadrant(task, delta) {
    const target = task.quadrant + delta;
    if (target < 1 || target > 4) return;
    // งานที่ย้ายเข้าช่องใหม่ต้องไปต่อท้าย ไม่ใช่แทรกทับลำดับเดิมของช่องนั้น
    const lastPosition = state.tasks
      .filter((item) => item.quadrant === target && item.id !== task.id)
      .reduce((max, item) => Math.max(max, item.position), 0);
    try {
      const updated = await api('PUT', `/api/tasks/${task.id}`, { quadrant: target, position: lastPosition + 1 });
      const index = state.tasks.findIndex((item) => item.id === task.id);
      if (index >= 0) state.tasks[index] = updated;
      renderMatrix();
      showToast(`ย้ายไปช่อง Q${target} แล้ว`);
      focusDragHandle(task.id);
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function moveTaskWithinQuadrant(task, delta) {
    const list = state.tasks.filter((item) => item.quadrant === task.quadrant).sort(byPosition);
    const index = list.findIndex((item) => item.id === task.id);
    const swapWith = index + delta;
    if (index < 0 || swapWith < 0 || swapWith >= list.length) return;

    const reordered = [...list];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
    const items = reordered.map((item, order) => ({
      id: item.id,
      quadrant: task.quadrant,
      position: order + 1,
    }));

    await saveOrder(items);
    focusDragHandle(task.id);
  }

  // หลังวาดบอร์ดใหม่ ปุ่มจับเป็นคนละ element แล้ว จึงต้องคืนโฟกัสให้งานเดิม
  function focusDragHandle(taskId) {
    const card = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
    const handle = card && card.querySelector('.task-drag-handle');
    if (handle) handle.focus();
  }

  // ---------------- archived tasks ----------------

  const THAI_MONTHS = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ];

  state.archiveMonthGroups = [];
  state.archiveMonthIndex = 0;

  function archivedAtDate(task) {
    return new Date(task.updated_at.replace(' ', 'T') + 'Z');
  }

  function groupArchivedByMonth(tasks) {
    const groups = new Map();
    tasks.forEach((task) => {
      const date = archivedAtDate(task);
      const key = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
      if (!groups.has(key)) groups.set(key, { key, year: date.getFullYear(), month: date.getMonth(), tasks: [] });
      groups.get(key).tasks.push(task);
    });
    return Array.from(groups.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
  }

  function renderArchiveMonthNav() {
    const groups = state.archiveMonthGroups;
    const hasGroups = groups.length > 0;
    const current = hasGroups ? groups[state.archiveMonthIndex] : null;
    el('archiveMonthLabel').textContent = current ? `${THAI_MONTHS[current.month]} ${current.year}` : '—';
    el('archivePrevMonthBtn').disabled = !hasGroups || state.archiveMonthIndex >= groups.length - 1;
    el('archiveNextMonthBtn').disabled = !hasGroups || state.archiveMonthIndex <= 0;
  }

  function renderArchiveList() {
    const list = el('archiveList');
    list.innerHTML = '';
    renderArchiveMonthNav();

    const group = state.archiveMonthGroups[state.archiveMonthIndex];
    if (!group || group.tasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'archive-empty';
      empty.textContent = 'ยังไม่มีงานที่เก็บถาวร';
      list.appendChild(empty);
      return;
    }

    group.tasks.forEach((task) => {
      const item = document.createElement('div');
      item.className = 'archive-item';

      const main = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'archive-item-title';
      title.textContent = task.title;
      main.appendChild(title);
      const time = document.createElement('div');
      time.className = 'archive-item-time';
      time.textContent = 'เก็บถาวรเมื่อ ' + formatDisplayDateTime(task.updated_at.replace(' ', 'T') + 'Z');
      main.appendChild(time);

      const actions = document.createElement('div');
      actions.className = 'archive-item-actions';

      const restore = document.createElement('button');
      restore.className = 'icon-btn';
      restore.type = 'button';
      restore.title = 'กู้คืน';
      restore.setAttribute('aria-label', `กู้คืนงาน ${task.title}`);
      restore.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 1 3 6.7"/><path d="M3 12V6m0 6h6"/></svg>';
      restore.addEventListener('click', async () => {
        setButtonLoading(restore, true);
        try {
          await api('PUT', `/api/tasks/${task.id}`, { archived: false });
          await loadTasks();
          renderMatrix();
          await refreshArchiveModal();
        } catch (err) {
          showToast(err.message, true);
          setButtonLoading(restore, false);
        }
      });

      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.type = 'button';
      del.title = 'ลบถาวร';
      del.setAttribute('aria-label', `ลบถาวรงาน ${task.title}`);
      del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M9 7V4h6v3m-9 0 1 13h10l1-13"/></svg>';
      del.addEventListener('click', async () => {
        const confirmed = await confirmDialog({
          title: 'ลบงานนี้ถาวรเลยไหม?',
          text: 'เมื่อลบแล้วจะไม่สามารถกู้คืนได้',
          confirmText: 'ลบถาวร',
        });
        if (!confirmed) return;
        setButtonLoading(del, true);
        try {
          await api('DELETE', `/api/tasks/${task.id}`);
          await refreshArchiveModal();
        } catch (err) {
          showToast(err.message, true);
          setButtonLoading(del, false);
        }
      });

      actions.appendChild(restore);
      actions.appendChild(del);
      item.appendChild(main);
      item.appendChild(actions);
      list.appendChild(item);
    });
  }

  async function refreshArchiveModal() {
    const currentKey = state.archiveMonthGroups[state.archiveMonthIndex]
      ? state.archiveMonthGroups[state.archiveMonthIndex].key
      : null;
    try {
      const tasks = await api('GET', '/api/tasks/archived');
      state.archiveMonthGroups = groupArchivedByMonth(tasks);
    } catch (err) {
      showToast(err.message, true);
      state.archiveMonthGroups = [];
    }
    const keptIndex = currentKey ? state.archiveMonthGroups.findIndex((g) => g.key === currentKey) : -1;
    state.archiveMonthIndex = keptIndex >= 0
      ? keptIndex
      : Math.min(state.archiveMonthIndex, Math.max(state.archiveMonthGroups.length - 1, 0));
    renderArchiveList();
  }

  async function openArchiveModal() {
    state.modalReturnFocus = document.activeElement;
    state.archiveMonthIndex = 0;
    await refreshArchiveModal();
    el('archiveModalBackdrop').classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closeArchiveModal() {
    el('archiveModalBackdrop').classList.add('hidden');
    document.body.classList.remove('modal-open');
    if (state.modalReturnFocus && document.contains(state.modalReturnFocus)) state.modalReturnFocus.focus();
    state.modalReturnFocus = null;
  }

  el('openArchiveBtn').addEventListener('click', openArchiveModal);
  el('closeArchiveBtn').addEventListener('click', closeArchiveModal);
  el('archiveModalBackdrop').addEventListener('click', (e) => {
    if (e.target === el('archiveModalBackdrop')) closeArchiveModal();
  });
  el('archivePrevMonthBtn').addEventListener('click', () => {
    if (state.archiveMonthIndex >= state.archiveMonthGroups.length - 1) return;
    state.archiveMonthIndex += 1;
    renderArchiveList();
  });
  el('archiveNextMonthBtn').addEventListener('click', () => {
    if (state.archiveMonthIndex <= 0) return;
    state.archiveMonthIndex -= 1;
    renderArchiveList();
  });

  // ---------------- แท็กและงานย่อยในฟอร์มงาน ----------------

  const MAX_TAGS = 10;
  const MAX_SUBTASKS = 50;

  function renderDraftTags() {
    const list = el('taskTagList');
    list.innerHTML = '';
    state.draftTags.forEach((tag, index) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      const label = document.createElement('span');
      label.textContent = tag;
      chip.appendChild(label);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'tag-chip-remove';
      remove.setAttribute('aria-label', `ลบแท็ก ${tag}`);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      remove.addEventListener('click', () => {
        state.draftTags.splice(index, 1);
        renderDraftTags();
      });
      chip.appendChild(remove);
      list.appendChild(chip);
    });
  }

  function addDraftTag(rawValue) {
    const value = String(rawValue || '').trim().replace(/,+$/, '').trim();
    if (!value) return;
    if (state.draftTags.length >= MAX_TAGS) {
      showToast(`ใส่แท็กได้สูงสุด ${MAX_TAGS} แท็ก`, true);
      return;
    }
    if (state.draftTags.some((tag) => tag.toLowerCase() === value.toLowerCase())) return;
    state.draftTags.push(value.slice(0, 30));
    renderDraftTags();
  }

  el('taskTagInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addDraftTag(event.target.value);
      event.target.value = '';
      return;
    }
    if (event.key === 'Backspace' && !event.target.value && state.draftTags.length > 0) {
      state.draftTags.pop();
      renderDraftTags();
    }
  });

  el('taskTagInput').addEventListener('blur', (event) => {
    addDraftTag(event.target.value);
    event.target.value = '';
  });

  function renderDraftSubtasks() {
    const list = el('taskSubtaskList');
    list.innerHTML = '';
    state.draftSubtasks.forEach((subtask, index) => {
      const row = document.createElement('div');
      row.className = 'subtask-edit-row';

      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'task-check small' + (subtask.completed ? ' checked' : '');
      check.setAttribute('aria-pressed', String(Boolean(subtask.completed)));
      check.setAttribute('aria-label', `สลับสถานะงานย่อย ${subtask.title}`);
      check.addEventListener('click', () => {
        state.draftSubtasks[index].completed = !subtask.completed;
        renderDraftSubtasks();
      });
      row.appendChild(check);

      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 200;
      input.value = subtask.title;
      input.className = 'subtask-edit-input' + (subtask.completed ? ' done' : '');
      input.addEventListener('input', () => {
        state.draftSubtasks[index].title = input.value;
      });
      row.appendChild(input);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn';
      remove.setAttribute('aria-label', `ลบงานย่อย ${subtask.title}`);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      remove.addEventListener('click', () => {
        state.draftSubtasks.splice(index, 1);
        renderDraftSubtasks();
      });
      row.appendChild(remove);

      list.appendChild(row);
    });
  }

  function addDraftSubtask(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return;
    if (state.draftSubtasks.length >= MAX_SUBTASKS) {
      showToast(`ใส่งานย่อยได้สูงสุด ${MAX_SUBTASKS} รายการ`, true);
      return;
    }
    state.draftSubtasks.push({ title: value.slice(0, 200), completed: false });
    renderDraftSubtasks();
  }

  el('addSubtaskBtn').addEventListener('click', () => {
    const input = el('taskSubtaskInput');
    addDraftSubtask(input.value);
    input.value = '';
    input.focus();
  });

  el('taskSubtaskInput').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addDraftSubtask(event.target.value);
    event.target.value = '';
  });

  function syncRecurControls() {
    const rule = el('taskRecurRule').value;
    el('taskRecurIntervalField').classList.toggle('hidden', !rule);
    if (rule) el('taskRecurUnitLabel').textContent = RECUR_UNITS[rule];
  }

  el('taskRecurRule').addEventListener('change', syncRecurControls);

  el('taskHasTimeToggle').addEventListener('click', () => {
    setDueTimeEnabled(!isDueTimeEnabled());
    if (isDueTimeEnabled()) el('taskDueTime').focus();
  });

  function openTaskModal(quadrant, task, prefill = null) {
    state.modalReturnFocus = document.activeElement;
    state.editingTaskId = task ? task.id : null;
    state.taskSourceNoteId = prefill ? prefill.sourceNoteId : null;
    el('taskModalTitle').textContent = task ? 'แก้ไขงาน' : 'เพิ่มงานใหม่';
    el('taskId').value = task ? task.id : '';
    el('taskTitle').value = task ? task.title : (prefill ? prefill.title : '');
    el('taskDesc').value = task ? (task.description || '') : (prefill ? prefill.description : '');
    el('taskQuadrant').value = String(task ? task.quadrant : quadrant);
    syncCustomSelect(el('taskQuadrant'));
    setTaskDueValue(task && task.due_date ? task.due_date : '', task ? task.due_has_time : false);

    el('taskRecurRule').value = task && task.recur_rule ? task.recur_rule : '';
    syncCustomSelect(el('taskRecurRule'));
    el('taskRecurInterval').value = String(task && task.recur_interval ? task.recur_interval : 1);
    syncRecurControls();

    state.draftTags = task ? [...(task.tags || [])] : [];
    state.draftSubtasks = task
      ? (task.subtasks || []).map((subtask) => ({ title: subtask.title, completed: Boolean(subtask.completed) }))
      : [];
    el('taskTagInput').value = '';
    el('taskSubtaskInput').value = '';
    renderDraftTags();
    renderDraftSubtasks();

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

    const recurRule = el('taskRecurRule').value;
    if (recurRule && !dueDate) {
      showToast('งานประจำต้องระบุกำหนดวันที่ด้วย', true);
      el('taskDueDate').focus();
      return;
    }

    // แท็กหรืองานย่อยที่ยังค้างอยู่ในช่องพิมพ์ต้องถูกบันทึกไปด้วย ไม่ใช่หายไปเงียบ ๆ
    addDraftTag(el('taskTagInput').value);
    el('taskTagInput').value = '';
    addDraftSubtask(el('taskSubtaskInput').value);
    el('taskSubtaskInput').value = '';

    const payload = {
      title: el('taskTitle').value,
      description: el('taskDesc').value,
      quadrant: Number(el('taskQuadrant').value),
      due_date: dueDate,
      due_has_time: Boolean(dueDate) && isDueTimeEnabled(),
      recur_rule: recurRule,
      recur_interval: Math.min(Math.max(Number(el('taskRecurInterval').value) || 1, 1), 365),
      tags: state.draftTags,
      subtasks: state.draftSubtasks
        .map((subtask) => ({ title: subtask.title.trim(), completed: subtask.completed }))
        .filter((subtask) => subtask.title.length > 0),
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
      const sourceNoteId = state.editingTaskId ? null : state.taskSourceNoteId;
      renderMatrix();
      closeTaskModal();
      if (sourceNoteId) await offerNoteCleanup(sourceNoteId);
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

  // ---------------- ยอดเงินและการจัดกลุ่ม Subscription ----------------

  const CYCLE_LABELS = {
    weekly: 'ต่อสัปดาห์',
    monthly: 'ต่อเดือน',
    quarterly: 'ต่อไตรมาส',
    yearly: 'ต่อปี',
    one_time: 'จ่ายครั้งเดียว',
  };
  const CYCLE_ORDER = ['monthly', 'quarterly', 'yearly', 'weekly', 'one_time'];
  // จ่ายครั้งเดียวไม่ใช่ค่าใช้จ่ายประจำ จึงไม่ถูกนับในยอดรวม
  const MONTHLY_FACTOR = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12, one_time: 0 };
  const YEARLY_FACTOR = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1, one_time: 0 };
  const UNCATEGORIZED = 'ไม่ระบุกลุ่ม';

  // null/undefined/'' แปลงเป็น 0 ได้ด้วย Number() จึงต้องคัดออกก่อน ไม่งั้นรายการที่ไม่ได้ใส่ราคาจะถูกนับเป็นศูนย์บาท
  function hasAmount(subscription) {
    const amount = subscription.amount;
    if (amount === null || amount === undefined || amount === '') return false;
    return Number.isFinite(Number(amount));
  }

  function monthlyAmount(subscription) {
    if (!hasAmount(subscription)) return 0;
    return Number(subscription.amount) * (MONTHLY_FACTOR[subscription.billing_cycle] ?? 0);
  }

  function yearlyAmount(subscription) {
    if (!hasAmount(subscription)) return 0;
    return Number(subscription.amount) * (YEARLY_FACTOR[subscription.billing_cycle] ?? 0);
  }

  function formatMoney(amount, currency = 'THB') {
    const value = Number(amount);
    if (!Number.isFinite(value)) return '';
    try {
      return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency,
        minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      return `${value.toLocaleString('th-TH')} ${currency}`;
    }
  }

  // รายการเก่าที่ยังเก็บราคาเป็นข้อความอิสระต้องแสดงผลได้เหมือนเดิม
  function subscriptionPriceLabel(subscription) {
    if (!hasAmount(subscription)) return subscription.price || '';
    const money = formatMoney(subscription.amount, subscription.currency || 'THB');
    const cycle = CYCLE_LABELS[subscription.billing_cycle] || '';
    return cycle ? `${money} ${cycle}` : money;
  }

  // รวมยอดแยกตามสกุลเงิน เพราะระบบไม่แปลงค่าเงินให้
  function summarizeSubscriptions(subscriptions) {
    const totals = new Map();
    subscriptions.forEach((subscription) => {
      if (!hasAmount(subscription)) return;
      const currency = subscription.currency || 'THB';
      if (!totals.has(currency)) totals.set(currency, { currency, monthly: 0, yearly: 0, count: 0 });
      const entry = totals.get(currency);
      entry.monthly += monthlyAmount(subscription);
      entry.yearly += yearlyAmount(subscription);
      entry.count += 1;
    });
    return [...totals.values()].sort((a, b) => b.yearly - a.yearly);
  }

  function formatTotals(totals, field) {
    if (totals.length === 0) return '—';
    return totals.map((entry) => formatMoney(entry[field], entry.currency)).join(' + ');
  }

  // ยอดจ่ายครั้งเดียวไม่เข้ายอดประจำ จึงต้องบอกแยกไว้ ไม่ให้ดูเหมือนเงินหายไป
  function oneTimeTotals(subscriptions) {
    const totals = new Map();
    subscriptions.forEach((subscription) => {
      if (!hasAmount(subscription) || subscription.billing_cycle !== 'one_time') return;
      const currency = subscription.currency || 'THB';
      totals.set(currency, (totals.get(currency) || 0) + Number(subscription.amount));
    });
    return [...totals.entries()].map(([currency, amount]) => formatMoney(amount, currency));
  }

  function subscriptionCategories() {
    const seen = new Map();
    state.subscriptions.forEach((subscription) => {
      const value = String(subscription.category || '').trim();
      if (!value) return;
      const key = value.toLowerCase();
      if (!seen.has(key)) seen.set(key, value);
    });
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'th'));
  }

  function renderCategorySuggestions() {
    const list = el('subscriptionCategorySuggestions');
    list.innerHTML = '';
    subscriptionCategories().forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      list.appendChild(option);
    });
  }

  function readGroupPreference() {
    try {
      const saved = window.localStorage.getItem(SUBSCRIPTION_GROUP_KEY);
      return ['category', 'billing_cycle', 'status', 'none'].includes(saved) ? saved : 'category';
    } catch {
      return 'category';
    }
  }

  function groupSubscriptions(entries, groupBy) {
    if (groupBy === 'none') return [{ key: 'all', label: 'ทั้งหมด', entries }];

    const groups = new Map();
    entries.forEach((entry) => {
      let key = UNCATEGORIZED;
      if (groupBy === 'category') key = String(entry.subscription.category || '').trim() || UNCATEGORIZED;
      else if (groupBy === 'billing_cycle') key = CYCLE_LABELS[entry.subscription.billing_cycle] || 'ไม่ระบุรอบบิล';
      else if (groupBy === 'status') {
        const cls = entry.status.cls;
        key = cls === 'expired' ? 'หมดอายุแล้ว' : cls === 'today' ? 'หมดอายุวันนี้' : cls === 'soon' ? 'ใกล้หมดอายุ' : 'ยังมีเวลา';
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });

    const order = groupBy === 'billing_cycle'
      ? CYCLE_ORDER.map((cycle) => CYCLE_LABELS[cycle])
      : groupBy === 'status'
        ? ['หมดอายุแล้ว', 'หมดอายุวันนี้', 'ใกล้หมดอายุ', 'ยังมีเวลา']
        : null;

    return [...groups.entries()]
      .map(([label, items]) => ({ key: label, label, entries: items }))
      .sort((a, b) => {
        if (order) return order.indexOf(a.label) - order.indexOf(b.label);
        if (a.label === UNCATEGORIZED) return 1;
        if (b.label === UNCATEGORIZED) return -1;
        return a.label.localeCompare(b.label, 'th');
      });
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

    const totals = summarizeSubscriptions(subscriptions);
    const withoutAmount = subscriptions.filter((subscription) => !hasAmount(subscription)).length;
    el('subscriptionMonthlyTotal').textContent = formatTotals(totals, 'monthly');
    el('subscriptionYearlyTotal').textContent = formatTotals(totals, 'yearly');
    const oneTime = oneTimeTotals(subscriptions);
    const monthlyNotes = [];
    if (withoutAmount > 0) monthlyNotes.push(`ยังไม่ได้ใส่ราคา ${withoutAmount} รายการ`);
    if (oneTime.length > 0) monthlyNotes.push(`ไม่รวมจ่ายครั้งเดียว ${oneTime.join(' + ')}`);
    el('subscriptionMonthlyNote').textContent = monthlyNotes.length > 0
      ? monthlyNotes.join(' · ')
      : 'คิดจากทุกรายการที่ระบุราคาไว้';
    el('subscriptionYearlyNote').textContent = totals.length > 1
      ? 'แยกตามสกุลเงิน ไม่ได้แปลงค่าเงินให้'
      : 'คิดจากรอบบิลของแต่ละรายการ';

    renderCategorySuggestions();
    list.innerHTML = '';
    el('subscriptionEmpty').classList.toggle('hidden', subscriptions.length > 0);
    if (subscriptions.length === 0) return;

    const groups = groupSubscriptions(statuses, state.subscriptionGroupBy);
    groups.forEach((group) => {
      const section = document.createElement('section');
      section.className = 'subscription-group';

      if (state.subscriptionGroupBy !== 'none') {
        const head = document.createElement('div');
        head.className = 'subscription-group-head';

        const title = document.createElement('div');
        title.className = 'subscription-group-title';
        const label = document.createElement('strong');
        label.textContent = group.label;
        const count = document.createElement('span');
        count.className = 'subscription-group-count';
        count.textContent = `${group.entries.length} รายการ`;
        title.append(label, count);

        const groupSubscriptions = group.entries.map((entry) => entry.subscription);
        const groupTotals = summarizeSubscriptions(groupSubscriptions);
        const groupOneTime = oneTimeTotals(groupSubscriptions);
        const recurring = groupTotals.filter((entry) => entry.monthly > 0);
        const parts = [];
        if (recurring.length > 0) parts.push(`${formatTotals(recurring, 'monthly')} ต่อเดือน`);
        if (groupOneTime.length > 0) parts.push(`ครั้งเดียว ${groupOneTime.join(' + ')}`);
        const subtotal = document.createElement('span');
        subtotal.className = 'subscription-group-total';
        subtotal.textContent = parts.length > 0 ? parts.join(' · ') : 'ไม่ได้ระบุราคา';

        head.append(title, subtotal);
        section.appendChild(head);
      }

      const groupList = document.createElement('div');
      groupList.className = 'subscription-group-items';
      section.appendChild(groupList);
      list.appendChild(section);
      group.entries.forEach((entry) => renderSubscriptionItem(entry, groupList));
    });
  }

  function renderSubscriptionItem({ subscription, status }, list) {
    {
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
      const priceText = subscriptionPriceLabel(subscription);
      if (priceText) {
        const price = document.createElement('span');
        price.className = 'subscription-meta-entry subscription-meta-price';
        price.textContent = priceText;
        meta.appendChild(price);
      }
      if (hasAmount(subscription) && subscription.billing_cycle !== 'monthly' && subscription.billing_cycle !== 'one_time') {
        const perMonth = document.createElement('span');
        perMonth.className = 'subscription-meta-entry subscription-meta-permonth';
        perMonth.textContent = `≈ ${formatMoney(monthlyAmount(subscription), subscription.currency || 'THB')} ต่อเดือน`;
        meta.appendChild(perMonth);
      }
      if (subscription.category && state.subscriptionGroupBy !== 'category') {
        const category = document.createElement('span');
        category.className = 'subscription-meta-entry subscription-meta-category';
        category.textContent = subscription.category;
        meta.appendChild(category);
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

      if (subscription.billing_cycle !== 'one_time') {
        const renew = document.createElement('button');
        renew.className = 'icon-btn subscription-renew-btn';
        renew.type = 'button';
        renew.title = 'ยืนยันว่าจ่ายรอบนี้แล้ว';
        renew.setAttribute('aria-label', `ยืนยันว่าจ่าย ${subscription.name} รอบนี้แล้ว`);
        renew.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 9a8 8 0 0 1 13.6-4.6L20 7M20 15a8 8 0 0 1-13.6 4.6L4 17"/><path d="M20 4v3h-3M4 20v-3h3"/></svg>';
        renew.addEventListener('click', async () => {
          const confirmed = await confirmDialog({
            title: 'จ่ายรอบนี้แล้วใช่ไหม?',
            text: `ระบบจะบันทึกว่าจ่าย ${subscription.name} รอบวันที่ ${formatSubscriptionDate(subscription.renewal_date)} แล้ว `
              + 'จากนั้นเลื่อนวันต่ออายุไปรอบถัดไปให้อัตโนมัติ',
            confirmText: 'ยืนยันการจ่าย',
            danger: false,
          });
          if (!confirmed) return;
          setButtonLoading(renew, true);
          try {
            const result = await api('POST', `/api/subscriptions/${subscription.id}/renew`);
            const index = state.subscriptions.findIndex((item) => item.id === subscription.id);
            if (index >= 0) state.subscriptions[index] = result.subscription;
            renderSubscriptions();
            showToast(`ต่ออายุแล้ว — รอบถัดไป ${formatSubscriptionDate(result.subscription.renewal_date)}`);
          } catch (error) {
            showToast(error.message, true);
            setButtonLoading(renew, false);
          }
        });
        actions.appendChild(renew);
      }

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
    }
  }

  function openSubscriptionModal(subscription) {
    state.modalReturnFocus = document.activeElement;
    state.editingSubscriptionId = subscription ? subscription.id : null;
    el('subscriptionModalTitle').textContent = subscription ? 'แก้ไข Subscription' : 'เพิ่ม Subscription';
    el('subscriptionName').value = subscription ? subscription.name : '';
    el('subscriptionPlan').value = subscription ? (subscription.plan_name || '') : '';
    el('subscriptionAmount').value = subscription && hasAmount(subscription) ? String(subscription.amount) : '';
    el('subscriptionCurrency').value = subscription ? (subscription.currency || 'THB') : 'THB';
    el('subscriptionBillingCycle').value = subscription && subscription.billing_cycle
      ? subscription.billing_cycle
      : 'monthly';
    el('subscriptionCategory').value = subscription ? (subscription.category || '') : '';
    renderCategorySuggestions();
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

  el('subscriptionGroupBy').addEventListener('change', (event) => {
    state.subscriptionGroupBy = event.target.value;
    try {
      window.localStorage.setItem(SUBSCRIPTION_GROUP_KEY, state.subscriptionGroupBy);
    } catch { /* โหมดส่วนตัวของเบราว์เซอร์อาจปิดการเขียน */ }
    renderSubscriptions();
  });

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
    const amountInput = el('subscriptionAmount');
    const amountText = amountInput.value.trim();
    amountInput.setCustomValidity('');
    let amount = null;
    if (amountText) {
      amount = Number(amountText);
      if (!Number.isFinite(amount) || amount < 0) {
        amountInput.setCustomValidity('กรุณาระบุราคาเป็นตัวเลขที่ไม่ติดลบ');
        amountInput.reportValidity();
        return;
      }
    }

    const currencyInput = el('subscriptionCurrency');
    const currency = currencyInput.value.trim().toUpperCase() || 'THB';
    currencyInput.setCustomValidity('');
    if (!/^[A-Z]{3}$/.test(currency)) {
      currencyInput.setCustomValidity('สกุลเงินต้องเป็นรหัส 3 ตัวอักษร เช่น THB');
      currencyInput.reportValidity();
      return;
    }

    const payload = {
      name: el('subscriptionName').value,
      plan_name: el('subscriptionPlan').value,
      renewal_date: parsedRenewal.iso,
      reminder_days: Number(el('subscriptionReminderDays').value),
      notes: el('subscriptionNotes').value,
      amount,
      currency,
      billing_cycle: el('subscriptionBillingCycle').value,
      category: el('subscriptionCategory').value,
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

      const noteActions = document.createElement('div');
      noteActions.className = 'note-actions';

      const convert = document.createElement('button');
      convert.className = 'icon-btn';
      convert.type = 'button';
      convert.title = 'สร้างเป็นงาน';
      convert.setAttribute('aria-label', 'สร้างงานจากบันทึกนี้');
      convert.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M4 12h7M4 18h7"/><path d="M17 11v8M13 15h8"/></svg>';
      convert.addEventListener('click', () => openTaskFromNote(note));
      noteActions.appendChild(convert);

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

      noteActions.appendChild(del);
      item.appendChild(left);
      item.appendChild(noteActions);
      list.appendChild(item);
    });
  }

  // บันทึกด่วนคือที่พักไอเดีย จึงต้องส่งต่อเป็นงานได้โดยไม่ต้องพิมพ์ใหม่
  function openTaskFromNote(note) {
    const lines = String(note.content).split('\n');
    const title = lines[0].trim().slice(0, 200);
    const description = lines.slice(1).join('\n').trim().slice(0, 5000);
    document.querySelector('.nav-item[data-view="dashboard"]').click();
    openTaskModal(2, null, { title, description, sourceNoteId: note.id });
  }

  async function offerNoteCleanup(noteId) {
    const note = state.notes.find((item) => item.id === noteId);
    const confirmed = await confirmDialog({
      title: 'ลบบันทึกต้นทางไหม?',
      text: note
        ? `สร้างงานเรียบร้อยแล้ว ต้องการลบบันทึก “${note.content.split('\n')[0].slice(0, 60)}” ทิ้งหรือเก็บไว้ก่อน`
        : 'สร้างงานเรียบร้อยแล้ว ต้องการลบบันทึกต้นทางไหม',
      confirmText: 'ลบบันทึก',
      cancelText: 'เก็บไว้',
    });
    if (!confirmed) return;
    try {
      await api('DELETE', `/api/notes/${noteId}`);
      state.notes = state.notes.filter((item) => item.id !== noteId);
      state.notesTotal = Math.max(0, state.notesTotal - 1);
      renderNotes();
    } catch (error) {
      showToast(error.message, true);
    }
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

  // ---------------- สถิติ ----------------

  const QUADRANT_SHORT = {
    1: 'Q1 ทำทันที',
    2: 'Q2 วางแผนทำ',
    3: 'Q3 มอบหมาย',
    4: 'Q4 ทำทีหลัง',
  };

  function renderDailyChart(days) {
    const chart = el('statsDailyChart');
    chart.innerHTML = '';
    const max = Math.max(1, ...days.map((day) => day.count));
    days.forEach((day) => {
      const column = document.createElement('div');
      column.className = 'stats-chart-col';
      const bar = document.createElement('div');
      bar.className = 'stats-chart-bar' + (day.count === 0 ? ' empty' : '');
      bar.style.height = `${Math.round((day.count / max) * 100)}%`;
      bar.title = `${day.date} — ปิดได้ ${day.count} งาน`;
      const label = document.createElement('span');
      label.className = 'stats-chart-label';
      label.textContent = day.date.slice(8);
      const value = document.createElement('span');
      value.className = 'stats-chart-value';
      value.textContent = day.count > 0 ? String(day.count) : '';
      column.append(value, bar, label);
      chart.appendChild(column);
    });
  }

  function renderBarList(container, rows) {
    container.innerHTML = '';
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'stats-empty';
      empty.textContent = 'ยังไม่มีข้อมูล';
      container.appendChild(empty);
      return;
    }
    const max = Math.max(...rows.map((row) => row.value), 1);
    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'stats-bar-row';
      const label = document.createElement('span');
      label.className = 'stats-bar-label';
      label.textContent = row.label;
      const track = document.createElement('span');
      track.className = 'stats-bar-track';
      const fill = document.createElement('span');
      fill.className = 'stats-bar-fill';
      fill.style.width = `${Math.round((row.value / max) * 100)}%`;
      if (row.tone) fill.dataset.tone = row.tone;
      track.appendChild(fill);
      const value = document.createElement('span');
      value.className = 'stats-bar-value';
      value.textContent = row.display;
      item.append(label, track, value);
      container.appendChild(item);
    });
  }

  function renderStats(stats) {
    renderDailyChart(stats.tasks.daily_completed);
    el('statsWeekCount').textContent = stats.tasks.completed_last_7_days;
    el('statsMonthCount').textContent = stats.tasks.completed_last_30_days;
    el('statsOverdueCount').textContent = stats.tasks.overdue;

    renderBarList(el('statsQuadrantBars'), stats.tasks.quadrants.map((entry) => ({
      label: QUADRANT_SHORT[entry.quadrant],
      value: entry.pending,
      display: `${entry.pending} งาน`,
      tone: `q${entry.quadrant}`,
    })));

    const busiest = [...stats.tasks.quadrants].sort((a, b) => b.pending - a.pending)[0];
    el('statsQuadrantHint').textContent = busiest && busiest.pending > 0
      ? `งานค้างมากที่สุดอยู่ที่ ${QUADRANT_SHORT[busiest.quadrant]} — ปิดได้ ${busiest.completed_last_30_days} งานใน 30 วันที่ผ่านมา`
      : 'ยังไม่มีงานค้าง';

    renderBarList(el('statsCategoryBars'), stats.subscriptions.by_category.map((entry) => ({
      label: `${entry.category}${entry.currency !== 'THB' ? ` (${entry.currency})` : ''}`,
      value: entry.monthly,
      display: formatMoney(entry.monthly, entry.currency),
    })));

    const paid = stats.subscriptions.paid_this_year
      .map((entry) => `${formatMoney(entry.total, entry.currency)} (${entry.count} ครั้ง)`);
    el('statsSpendHint').textContent = paid.length > 0
      ? `จ่ายไปแล้วปีนี้ ${paid.join(' + ')}`
      : 'ยังไม่มีประวัติการจ่าย — กดปุ่มต่ออายุที่หน้า Subscription เมื่อจ่ายแล้ว';

    const upcoming = el('statsUpcoming');
    upcoming.innerHTML = '';
    if (stats.subscriptions.upcoming_30_days.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'stats-empty';
      empty.textContent = 'ไม่มีรายการที่ครบกำหนดใน 30 วันข้างหน้า';
      upcoming.appendChild(empty);
      return;
    }
    stats.subscriptions.upcoming_30_days.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'stats-upcoming-row';
      const date = document.createElement('span');
      date.className = 'stats-upcoming-date';
      date.textContent = formatSubscriptionDate(item.renewal_date);
      const name = document.createElement('span');
      name.className = 'stats-upcoming-name';
      name.textContent = item.name + (item.category ? ` · ${item.category}` : '');
      const amount = document.createElement('span');
      amount.className = 'stats-upcoming-amount';
      amount.textContent = hasAmount(item) ? formatMoney(item.amount, item.currency || 'THB') : '—';
      row.append(date, name, amount);
      upcoming.appendChild(row);
    });
  }

  async function loadStats() {
    const button = el('refreshStatsBtn');
    setButtonLoading(button, true);
    try {
      renderStats(await api('GET', '/api/stats'));
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setButtonLoading(button, false);
    }
  }

  el('refreshStatsBtn').addEventListener('click', loadStats);

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

  // ---------------- สำรองและกู้คืนข้อมูล ----------------

  function showDataMessage(text, isError) {
    const box = el('dataMsg');
    box.textContent = text;
    box.className = isError ? 'form-error' : 'form-success';
  }

  el('exportDataBtn').addEventListener('click', async () => {
    const button = el('exportDataBtn');
    setButtonLoading(button, true);
    try {
      const backup = await api('GET', '/api/data/export');
      const stamp = new Date();
      const name = `eisenhower-board-${stamp.getFullYear()}${pad2(stamp.getMonth() + 1)}${pad2(stamp.getDate())}.json`;
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      showDataMessage(`ดาวน์โหลดไฟล์ ${name} แล้ว`, false);
    } catch (error) {
      showDataMessage(error.message, true);
    } finally {
      setButtonLoading(button, false);
    }
  });

  el('importDataBtn').addEventListener('click', () => el('importFileInput').click());

  el('importFileInput').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;

    const mode = el('importMode').value;
    const confirmed = await confirmDialog({
      title: mode === 'replace' ? 'แทนที่ข้อมูลเดิมทั้งหมด?' : 'นำเข้าข้อมูลจากไฟล์นี้?',
      text: mode === 'replace'
        ? `งาน บันทึก และ Subscription ที่มีอยู่จะถูกลบ แล้วแทนที่ด้วยข้อมูลในไฟล์ ${file.name}`
        : `ข้อมูลในไฟล์ ${file.name} จะถูกเพิ่มต่อจากข้อมูลเดิม`,
      confirmText: mode === 'replace' ? 'แทนที่ทั้งหมด' : 'นำเข้า',
      danger: mode === 'replace',
    });
    if (!confirmed) return;

    const button = el('importDataBtn');
    setButtonLoading(button, true);
    try {
      const text = await file.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('ไฟล์นี้ไม่ใช่ JSON ที่อ่านได้');
      }
      const result = await api('POST', '/api/data/import', { mode, data });
      await Promise.all([loadTasks(), loadSettings()]);
      state.notes = [];
      state.notesNextCursor = null;
      await loadNotes();
      state.subscriptions = await api('GET', '/api/subscriptions');
      renderMatrix();
      renderNotes();
      renderSubscriptions();
      renderSettings();
      const counts = result.imported;
      showDataMessage(
        `นำเข้าสำเร็จ — งาน ${counts.tasks} รายการ, บันทึก ${counts.notes} รายการ, Subscription ${counts.subscriptions} รายการ`,
        false,
      );
      showToast('นำเข้าข้อมูลเรียบร้อย');
    } catch (error) {
      showDataMessage(error.message, true);
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
  state.filter = readFilterPreference();
  state.subscriptionGroupBy = readGroupPreference();
  el('subscriptionGroupBy').value = state.subscriptionGroupBy;

  // ติดตั้ง service worker เพื่อให้เปิดแอปได้แม้ออฟไลน์ และติดตั้งลงหน้าจอโฮมได้
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('ลงทะเบียน service worker ไม่สำเร็จ', error);
      });
    });
  }

  // ทางลัด "จดด่วน" จาก manifest เปิดหน้าต่างจดให้ทันที
  function handleLaunchAction() {
    const action = new URLSearchParams(window.location.search).get('action');
    if (action !== 'jot' || !state.authenticated) return;
    window.history.replaceState({}, '', window.location.pathname);
    el('quickJotFab').click();
  }

  initAuth().then(async () => {
    if (state.authenticated) {
      handleLaunchAction();
      return null;
    }
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
