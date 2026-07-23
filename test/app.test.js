const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eisenhower-board-test-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dataDir;
process.env.PORT = '3000';
process.env.SESSION_SECRET = 'test-session-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
process.env.APP_ENCRYPTION_KEY = 'test-encryption-key-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
process.env.SETUP_TOKEN = 'test-first-setup-token';
process.env.COOKIE_SECURE = 'false';
process.env.TRUST_PROXY = 'false';

const { startServer } = require('../server');
const db = require('../src/db');
const {
  buildDailySummary,
  escapeTelegramHtml,
  daysUntilDate,
} = require('../src/services/scheduler');

function createClient(baseUrl) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    set cookie(value) { cookie = value; },
    async request(method, pathname, body, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (cookie) headers.Cookie = cookie;
      let requestBody;
      if (options.rawBody !== undefined) {
        requestBody = options.rawBody;
      } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        requestBody = JSON.stringify(body);
      }
      const response = await fetch(`${baseUrl}${pathname}`, { method, headers, body: requestBody });
      const setCookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean);
      if (setCookies.length > 0) cookie = setCookies[0].split(';')[0];
      let data = null;
      try { data = await response.json(); } catch { /* no JSON */ }
      return { response, data };
    },
  };
}

test('API integration, security, validation and session invalidation', async (t) => {
  const server = startServer(0, { runScheduler: false });
  if (!server.listening) await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const owner = createClient(baseUrl);

  let result = await owner.request('GET', '/api/health');
  assert.equal(result.response.status, 200);
  assert.equal(result.data.ok, true);
  assert.equal(result.response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(result.response.headers.get('content-security-policy'), /frame-ancestors 'none'/);

  result = await owner.request('GET', '/api/setup-status');
  assert.deepEqual(result.data, { needsSetup: true, requiresSetupToken: true });

  result = await owner.request('POST', '/api/setup', {
    username: 'owner', password: 'StrongPassword#123', setup_token: 'wrong',
  });
  assert.equal(result.response.status, 403);

  result = await owner.request('POST', '/api/setup', {
    username: 'owner', password: 'StrongPassword#123', setup_token: 'test-first-setup-token',
  });
  assert.equal(result.response.status, 200);
  assert.match(owner.cookie, /^eb\.sid=/);

  result = await owner.request('POST', '/api/setup', {
    username: 'other', password: 'AnotherPassword#123', setup_token: 'test-first-setup-token',
  });
  assert.equal(result.response.status, 403);

  result = await owner.request('POST', '/api/login', {
    username: 'missing-user', password: 'AnyPassword#123', remember_device: false,
  });
  assert.equal(result.response.status, 401);

  result = await owner.request('POST', '/api/tasks', {
    title: 'งาน UTC', description: '', quadrant: 1, due_date: '2026-07-20T03:00:00.000Z',
  });
  assert.equal(result.response.status, 201);
  const taskId = result.data.id;
  assert.equal(result.data.due_date, '2026-07-20T03:00:00.000Z');

  result = await owner.request('POST', '/api/subscriptions', {
    name: 'Netflix',
    plan_name: 'Premium',
    price: '419 บาท/เดือน',
    renewal_date: '2026-12-31',
    reminder_days: 7,
    notes: 'ใช้บัญชีครอบครัว',
  });
  assert.equal(result.response.status, 201);
  const subscriptionId = result.data.id;
  assert.equal(result.data.name, 'Netflix');
  assert.equal(result.data.renewal_date, '2026-12-31');
  assert.equal(result.data.reminder_days, 7);

  result = await owner.request('POST', '/api/subscriptions', {
    name: 'Invalid date',
    renewal_date: '2026-02-30',
  });
  assert.equal(result.response.status, 400);

  result = await owner.request('PUT', '/api/subscriptions/' + subscriptionId, {
    renewal_date: '2027-01-15',
    reminder_days: 14,
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.renewal_date, '2027-01-15');
  assert.equal(result.data.reminder_days, 14);

  result = await owner.request('DELETE', '/api/subscriptions/' + subscriptionId);
  assert.equal(result.response.status, 200);

  result = await owner.request('PUT', `/api/tasks/${taskId}`, { completed: 'false' });
  assert.equal(result.response.status, 400);
  result = await owner.request('PUT', `/api/tasks/${taskId}`, { completed: false });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.completed, 0);

  result = await owner.request('POST', '/api/notes', { content: 'หนึ่ง' });
  assert.equal(result.response.status, 201);
  await owner.request('POST', '/api/notes', { content: 'สอง' });
  result = await owner.request('GET', '/api/notes?limit=1');
  assert.equal(result.data.items.length, 1);
  assert.ok(result.data.nextCursor);
  assert.equal(result.data.totalCount, 2);

  result = await owner.request('PUT', '/api/settings', {
    telegram_bot_token: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcd',
    telegram_chat_id: '123456789',
    notify_before_minutes: 60,
    daily_summary_enabled: false,
    daily_summary_time: '08:00',
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.telegram_bot_token, '');
  assert.equal(result.data.telegram_bot_configured, true);
  const storedToken = db.prepare('SELECT telegram_bot_token FROM settings WHERE user_id = 1').get().telegram_bot_token;
  assert.match(storedToken, /^enc:v2:/);
  assert.doesNotMatch(storedToken, /ABCDEFGHIJKLMNOPQRSTUVWXYZ/);

  result = await owner.request('PUT', '/api/settings', {
    notify_before_minutes: -1,
    daily_summary_enabled: 'false',
    daily_summary_time: '99:99',
  });
  assert.equal(result.response.status, 400);

  result = await owner.request('POST', '/api/tasks', undefined, {
    rawBody: '{broken',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(result.response.status, 400);

  result = await owner.request('POST', '/api/notes', { content: 'blocked' }, {
    headers: { Origin: 'https://attacker.example' },
  });
  assert.equal(result.response.status, 403);

  const secondSession = createClient(baseUrl);
  result = await secondSession.request('POST', '/api/login', {
    username: 'owner', password: 'StrongPassword#123', remember_device: true,
  });
  assert.equal(result.response.status, 200);

  result = await owner.request('PUT', '/api/settings/password', {
    current_password: 'StrongPassword#123', new_password: 'NewStrongPassword#456',
  });
  assert.equal(result.response.status, 200);

  result = await secondSession.request('GET', '/api/tasks');
  assert.equal(result.response.status, 401);
  result = await owner.request('GET', '/api/tasks');
  assert.equal(result.response.status, 200);

  assert.equal(escapeTelegramHtml('<b>&'), '&lt;b&gt;&amp;');
  const manyTasks = Array.from({ length: 100 }, (_, index) => ({
    quadrant: (index % 4) + 1,
    title: `งาน ${index} ${'ก'.repeat(180)}`,
    due_date: '2026-07-20T03:00:00.000Z',
  }));
  assert.ok(buildDailySummary(manyTasks).length <= 3900);
});

test('subscription date countdown uses the Bangkok calendar date', () => {
  const now = new Date('2026-07-22T12:00:00+07:00');
  assert.equal(daysUntilDate('2026-07-22', now), 0);
  assert.equal(daysUntilDate('2026-07-29', now), 7);
  assert.equal(daysUntilDate('2026-07-21', now), -1);
});
