const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eisenhower-board-features-'));
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
const { nextDueDate } = require('../src/services/recurrence');
const { formatTaskDue } = require('../src/services/scheduler');
const { parseLegacyPrice, summarize, priceLabel } = require('../src/services/subscriptions');

function createClient(baseUrl) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async request(method, pathname, body) {
      const headers = {};
      if (cookie) headers.Cookie = cookie;
      let requestBody;
      if (body !== undefined) {
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

test('งานประจำเลื่อนกำหนดส่งตามปฏิทินเวลาไทย', () => {
  const now = new Date('2026-08-22T12:00:00Z');
  assert.equal(nextDueDate('2026-08-22T16:59:59.999Z', 'daily', 1, now), '2026-08-23T16:59:59.999Z');
  assert.equal(nextDueDate('2026-08-22T16:59:59.999Z', 'weekly', 1, now), '2026-08-29T16:59:59.999Z');
  assert.equal(nextDueDate('2026-08-22T16:59:59.999Z', 'monthly', 3, now), '2026-11-22T16:59:59.999Z');
  assert.equal(nextDueDate('2026-02-28T16:59:59.999Z', 'yearly', 1, now), '2027-02-28T16:59:59.999Z');
  // งานที่ทำช้ากว่ากำหนดหลายรอบต้องข้ามมาที่รอบถัดไปในอนาคต ไม่ใช่ค้างอยู่ในอดีต
  assert.equal(nextDueDate('2026-01-05T16:59:59.999Z', 'daily', 1, now), '2026-08-22T16:59:59.999Z');
  // วันสิ้นเดือนต้องหดลงตามจำนวนวันของเดือนปลายทาง แล้วกลับมาเต็มเดือนเมื่อทำได้
  assert.equal(
    nextDueDate('2026-01-31T16:59:59.999Z', 'monthly', 1, new Date('2026-02-01T00:00:00Z')),
    '2026-02-28T16:59:59.999Z',
  );
  assert.equal(nextDueDate('2026-08-22T16:59:59.999Z', '', 1, now), null);
  assert.equal(nextDueDate(null, 'daily', 1, now), null);
});

test('ข้อความแจ้งเตือนแสดงเวลาเฉพาะงานที่ระบุเวลาไว้', () => {
  const dateOnly = formatTaskDue({ due_date: '2026-08-22T16:59:59.999Z', due_has_time: 0 });
  const withTime = formatTaskDue({ due_date: '2026-08-22T07:30:00.000Z', due_has_time: 1 });
  assert.ok(!/\d{1,2}:\d{2}/.test(dateOnly));
  assert.match(withTime, /14:30/);
  assert.equal(formatTaskDue({ due_date: null, due_has_time: 1 }), 'ไม่ระบุวันที่');
});

test('อ่านราคาแบบข้อความเดิมและรวมยอด Subscription', () => {
  assert.deepEqual(parseLegacyPrice('419 บาท/เดือน'), { amount: 419, currency: 'THB', billingCycle: 'monthly' });
  assert.deepEqual(parseLegacyPrice('1,290 บาท/ปี'), { amount: 1290, currency: 'THB', billingCycle: 'yearly' });
  assert.deepEqual(parseLegacyPrice('$9.99/mo'), { amount: 9.99, currency: 'USD', billingCycle: 'monthly' });
  assert.deepEqual(parseLegacyPrice('890 บาท ทุก 3 เดือน'), { amount: 890, currency: 'THB', billingCycle: 'quarterly' });
  // ไม่ระบุรอบบิลให้ถือเป็นรายเดือน ซึ่งเป็นรอบที่พบบ่อยที่สุด
  assert.deepEqual(parseLegacyPrice('250'), { amount: 250, currency: 'THB', billingCycle: 'monthly' });
  assert.equal(parseLegacyPrice('ฟรี'), null);
  assert.equal(parseLegacyPrice(''), null);

  const totals = summarize([
    { amount: 100, currency: 'THB', billing_cycle: 'monthly' },
    { amount: 1200, currency: 'THB', billing_cycle: 'yearly' },
    { amount: 300, currency: 'THB', billing_cycle: 'quarterly' },
    { amount: 5000, currency: 'THB', billing_cycle: 'one_time' },
    { amount: 10, currency: 'USD', billing_cycle: 'monthly' },
    { amount: null, currency: 'THB', billing_cycle: 'monthly' },
  ]);
  const thb = totals.find((entry) => entry.currency === 'THB');
  const usd = totals.find((entry) => entry.currency === 'USD');
  assert.equal(Math.round(thb.monthly), 300); // 100 + 100 + 100 + 0
  assert.equal(Math.round(thb.yearly), 3600);
  assert.equal(usd.monthly, 10);
  assert.equal(usd.yearly, 120);
  // รายการที่ไม่ได้ใส่ราคาไม่ถูกนับ แต่รายการจ่ายครั้งเดียวยังถูกนับเป็นจำนวนรายการ
  assert.equal(thb.count, 4);

  assert.match(priceLabel({ amount: 419, currency: 'THB', billing_cycle: 'monthly' }), /419.*ต่อเดือน/);
  assert.equal(priceLabel({ amount: null, price: 'จ่ายตามใช้งาน' }), 'จ่ายตามใช้งาน');
});

test('แท็ก งานย่อย งานประจำ และการนำข้อมูลเข้า-ออก', async (t) => {
  const server = startServer(0, { runScheduler: false });
  if (!server.listening) await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const owner = createClient(baseUrl);

  let result = await owner.request('POST', '/api/setup', {
    username: 'owner', password: 'StrongPassword#123', setup_token: 'test-first-setup-token',
  });
  assert.equal(result.response.status, 200);

  // ---------- แท็ก งานย่อย และเวลาในกำหนดส่ง ----------
  result = await owner.request('POST', '/api/tasks', {
    title: 'ส่งรายงาน',
    quadrant: 1,
    due_date: '2026-09-01T07:30:00.000Z',
    due_has_time: true,
    tags: ['งาน', 'ด่วน', 'งาน'],
    subtasks: [{ title: 'ร่างเนื้อหา' }, { title: 'ตรวจทาน', completed: true }],
  });
  assert.equal(result.response.status, 201);
  const taskId = result.data.id;
  assert.deepEqual(result.data.tags, ['งาน', 'ด่วน']);
  assert.equal(result.data.due_has_time, 1);
  assert.equal(result.data.subtasks.length, 2);
  assert.equal(result.data.subtasks[0].title, 'ร่างเนื้อหา');
  assert.equal(result.data.subtasks[1].completed, true);

  result = await owner.request('GET', '/api/tasks');
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data[0].tags, ['งาน', 'ด่วน']);
  assert.equal(result.data[0].subtasks.length, 2);

  result = await owner.request('PUT', `/api/tasks/${taskId}`, {
    subtasks: [{ title: 'ร่างเนื้อหา', completed: true }],
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.subtasks.length, 1);
  assert.equal(result.data.subtasks[0].completed, true);

  // ล้างกำหนดส่งแล้วต้องไม่เหลือธงว่ามีเวลากำกับ
  result = await owner.request('PUT', `/api/tasks/${taskId}`, { due_date: null });
  assert.equal(result.data.due_has_time, 0);

  result = await owner.request('POST', '/api/tasks', {
    title: 'แท็กเยอะเกิน',
    quadrant: 2,
    tags: Array.from({ length: 11 }, (_, index) => `tag${index}`),
  });
  assert.equal(result.response.status, 400);

  result = await owner.request('POST', '/api/tasks', {
    title: 'งานย่อยไม่ถูกต้อง', quadrant: 2, subtasks: [{ title: '' }],
  });
  assert.equal(result.response.status, 400);

  // ---------- งานประจำ ----------
  result = await owner.request('POST', '/api/tasks', {
    title: 'งานประจำไม่มีกำหนด', quadrant: 2, recur_rule: 'weekly',
  });
  assert.equal(result.response.status, 400);

  result = await owner.request('POST', '/api/tasks', {
    title: 'รดน้ำต้นไม้', quadrant: 2, recur_rule: 'nonsense', due_date: '2026-09-01T16:59:59.999Z',
  });
  assert.equal(result.response.status, 400);

  result = await owner.request('POST', '/api/tasks', {
    title: 'รดน้ำต้นไม้',
    quadrant: 2,
    due_date: '2026-09-01T16:59:59.999Z',
    recur_rule: 'weekly',
    recur_interval: 2,
    tags: ['บ้าน'],
    subtasks: [{ title: 'เติมน้ำ' }],
  });
  assert.equal(result.response.status, 201);
  const recurringId = result.data.id;

  result = await owner.request('PUT', `/api/tasks/${recurringId}`, { completed: true });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.completed, 1);
  assert.ok(result.data.next_task, 'งานประจำต้องสร้างรอบถัดไปให้อัตโนมัติ');
  const spawned = result.data.next_task;
  assert.equal(spawned.title, 'รดน้ำต้นไม้');
  assert.equal(spawned.completed, 0);
  assert.equal(spawned.recur_rule, 'weekly');
  assert.deepEqual(spawned.tags, ['บ้าน']);
  assert.equal(spawned.subtasks.length, 1);
  assert.equal(spawned.subtasks[0].completed, false, 'งานย่อยของรอบใหม่ต้องเริ่มจากยังไม่เสร็จ');
  assert.ok(new Date(spawned.due_date).getTime() > new Date('2026-09-01T16:59:59.999Z').getTime());

  // ปิดงานเดิมซ้ำอีกครั้งต้องไม่แตกรอบใหม่เพิ่ม
  result = await owner.request('PUT', `/api/tasks/${recurringId}`, { completed: true });
  assert.equal(result.data.next_task, undefined);

  // เปิดงานกลับมาแล้วกดเสร็จใหม่ ก็ต้องไม่ได้งานรอบเดียวกันซ้ำอีกใบ
  await owner.request('PUT', `/api/tasks/${recurringId}`, { completed: false });
  result = await owner.request('PUT', `/api/tasks/${recurringId}`, { completed: true });
  assert.equal(result.data.next_task, undefined);
  const sameRound = (await owner.request('GET', '/api/tasks')).data
    .filter((task) => task.title === 'รดน้ำต้นไม้' && task.due_date === spawned.due_date);
  assert.equal(sameRound.length, 1);

  // งานที่ไม่ใช่งานประจำต้องไม่สร้างรอบใหม่
  result = await owner.request('POST', '/api/tasks', {
    title: 'งานครั้งเดียว', quadrant: 3, due_date: '2026-09-05T16:59:59.999Z',
  });
  const onceOnlyId = result.data.id;
  result = await owner.request('PUT', `/api/tasks/${onceOnlyId}`, { completed: true });
  assert.equal(result.data.next_task, undefined);

  // ---------- นำข้อมูลออก ----------
  await owner.request('POST', '/api/notes', { content: 'ไอเดียตอนเช้า' });
  await owner.request('POST', '/api/subscriptions', {
    name: 'Netflix',
    plan_name: 'Premium',
    renewal_date: '2026-12-31',
    reminder_days: 7,
    amount: 419,
    currency: 'THB',
    billing_cycle: 'monthly',
    category: 'บันเทิง',
  });
  let subscriptionResult = await owner.request('POST', '/api/subscriptions', {
    name: 'iCloud', renewal_date: '2026-11-01', amount: 1290, currency: 'usd', billing_cycle: 'yearly', category: 'คลาวด์',
  });
  assert.equal(subscriptionResult.response.status, 201);
  assert.equal(subscriptionResult.data.currency, 'USD', 'สกุลเงินต้องถูกทำให้เป็นตัวพิมพ์ใหญ่');
  assert.equal(subscriptionResult.data.billing_cycle, 'yearly');
  assert.equal(subscriptionResult.data.category, 'คลาวด์');

  subscriptionResult = await owner.request('POST', '/api/subscriptions', {
    name: 'ราคาติดลบ', renewal_date: '2026-11-01', amount: -5,
  });
  assert.equal(subscriptionResult.response.status, 400);
  subscriptionResult = await owner.request('POST', '/api/subscriptions', {
    name: 'รอบบิลมั่ว', renewal_date: '2026-11-01', amount: 10, billing_cycle: 'hourly',
  });
  assert.equal(subscriptionResult.response.status, 400);
  subscriptionResult = await owner.request('POST', '/api/subscriptions', {
    name: 'สกุลเงินมั่ว', renewal_date: '2026-11-01', amount: 10, currency: 'BAHT',
  });
  assert.equal(subscriptionResult.response.status, 400);
  await owner.request('PUT', '/api/settings', {
    telegram_chat_id: '123456789', notify_before_minutes: 180, daily_summary_enabled: true, daily_summary_time: '07:30',
  });

  result = await owner.request('GET', '/api/data/export');
  assert.equal(result.response.status, 200);
  const backup = result.data;
  assert.equal(backup.app, 'eisenhower-board');
  assert.equal(backup.format_version, 1);
  assert.equal(backup.notes.length, 1);
  assert.equal(backup.subscriptions.length, 2);
  const netflix = backup.subscriptions.find((item) => item.name === 'Netflix');
  assert.equal(netflix.amount, 419);
  assert.equal(netflix.currency, 'THB');
  assert.equal(netflix.billing_cycle, 'monthly');
  assert.equal(netflix.category, 'บันเทิง');
  assert.equal(backup.settings.notify_before_minutes, 180);
  assert.equal(backup.settings.daily_summary_time, '07:30');
  assert.ok(!('telegram_bot_token' in backup.settings), 'ไฟล์สำรองต้องไม่มี Bot Token');
  assert.ok(!('telegram_chat_id' in backup.settings), 'ไฟล์สำรองต้องไม่มี Chat ID');
  const exportedRecurring = backup.tasks.find((task) => task.title === 'รดน้ำต้นไม้' && !task.completed);
  assert.ok(exportedRecurring);
  assert.deepEqual(exportedRecurring.tags, ['บ้าน']);
  assert.equal(exportedRecurring.subtasks.length, 1);

  // ---------- นำข้อมูลเข้า ----------
  result = await owner.request('POST', '/api/data/import', { mode: 'nope', data: backup });
  assert.equal(result.response.status, 400);

  result = await owner.request('POST', '/api/data/import', {
    mode: 'merge',
    data: { tasks: [{ title: 'ไม่มีหมวด' }] },
  });
  assert.equal(result.response.status, 400);

  result = await owner.request('POST', '/api/data/import', {
    mode: 'merge', data: { format_version: 99, tasks: [] },
  });
  assert.equal(result.response.status, 400);

  const beforeImport = (await owner.request('GET', '/api/tasks')).data.length;
  result = await owner.request('POST', '/api/data/import', { mode: 'merge', data: backup });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.imported.notes, 1);
  const afterMerge = (await owner.request('GET', '/api/tasks')).data;
  assert.ok(afterMerge.length > beforeImport, 'โหมด merge ต้องเพิ่มข้อมูลทับของเดิม');

  result = await owner.request('POST', '/api/data/import', { mode: 'replace', data: backup });
  assert.equal(result.response.status, 200);
  const afterReplace = (await owner.request('GET', '/api/tasks')).data;
  assert.equal(
    afterReplace.length,
    backup.tasks.filter((task) => !task.archived).length,
    'โหมด replace ต้องเหลือเท่าจำนวนในไฟล์',
  );
  const restored = afterReplace.find((task) => task.title === 'รดน้ำต้นไม้' && !task.completed);
  assert.ok(restored);
  assert.deepEqual(restored.tags, ['บ้าน']);
  assert.equal(restored.subtasks.length, 1);
  assert.equal(restored.recur_rule, 'weekly');
  assert.equal(restored.recur_interval, 2);

  const notesAfterReplace = (await owner.request('GET', '/api/notes')).data;
  assert.equal(notesAfterReplace.totalCount, 1);

  // ไฟล์สำรองใหญ่กว่าคำขอปกติได้ แต่ยังต้องมีเพดานของตัวเอง
  result = await owner.request('POST', '/api/data/import', {
    mode: 'merge',
    data: {
      tasks: Array.from({ length: 60 }, (_, index) => ({
        title: `งานนำเข้า ${index}`, quadrant: (index % 4) + 1, description: 'ก'.repeat(2000),
      })),
    },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.imported.tasks, 60);

  result = await owner.request('POST', '/api/data/import', {
    mode: 'merge',
    data: { tasks: Array.from({ length: 2001 }, () => ({ title: 'เกิน', quadrant: 1 })) },
  });
  assert.equal(result.response.status, 400);

  // ---------- ต้องเข้าสู่ระบบก่อนเสมอ ----------
  const stranger = createClient(baseUrl);
  result = await stranger.request('GET', '/api/data/export');
  assert.equal(result.response.status, 401);
  result = await stranger.request('POST', '/api/data/import', { mode: 'merge', data: { tasks: [] } });
  assert.equal(result.response.status, 401);
});
