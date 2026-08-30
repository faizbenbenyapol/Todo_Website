const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eisenhower-board-edge-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dataDir;
process.env.PORT = '3000';
process.env.SESSION_SECRET = 'test-session-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
process.env.APP_ENCRYPTION_KEY = 'test-encryption-key-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
process.env.SETUP_TOKEN = 'test-first-setup-token';
process.env.COOKIE_SECURE = 'false';
process.env.TRUST_PROXY = 'false';

const { startServer } = require('../server');
const { checkDueReminders, checkDailySummaries } = require('../src/services/scheduler');
const db = require('../src/db');

function createClient(baseUrl) {
  let cookie = '';
  return {
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

test('เคสขอบของงาน Subscription และการนำข้อมูลเข้า-ออก', async (t) => {
  const server = startServer(0, { runScheduler: false });
  if (!server.listening) await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const owner = createClient(baseUrl);
  const other = createClient(baseUrl);
  let result = await owner.request('POST', '/api/setup', {
    username: 'owner', password: 'StrongPassword#123', setup_token: 'test-first-setup-token',
  });
  assert.equal(result.response.status, 200);

  // ---------- ข้อมูลของคนอื่นต้องแตะไม่ได้ ----------
  result = await owner.request('POST', '/api/tasks', { title: 'งานของเจ้าของ', quadrant: 1 });
  const ownedTaskId = result.data.id;
  result = await other.request('PUT', '/api/tasks/reorder', {
    items: [{ id: ownedTaskId, quadrant: 4, position: 1 }],
  });
  assert.equal(result.response.status, 401, 'คนที่ยังไม่ล็อกอินต้องจัดลำดับงานคนอื่นไม่ได้');
  result = await other.request('GET', '/api/stats');
  assert.equal(result.response.status, 401);

  // ---------- จัดลำดับด้วยข้อมูลผิดรูปแบบ ----------
  for (const items of [
    [{ id: ownedTaskId, quadrant: 1 }],
    [{ id: ownedTaskId, position: 1 }],
    [{ id: 'abc', quadrant: 1, position: 1 }],
    [{ id: ownedTaskId, quadrant: 1, position: -1 }],
    ['ไม่ใช่วัตถุ'],
  ]) {
    result = await owner.request('PUT', '/api/tasks/reorder', { items });
    assert.equal(result.response.status, 400, `ต้องปฏิเสธ ${JSON.stringify(items)}`);
  }

  // งานที่เก็บถาวรแล้วต้องไม่ถูกลากกลับมาผ่าน reorder
  result = await owner.request('POST', '/api/tasks', { title: 'งานเก็บถาวร', quadrant: 2 });
  const archivedId = result.data.id;
  await owner.request('PUT', `/api/tasks/${archivedId}`, { completed: true });
  await owner.request('PUT', `/api/tasks/${archivedId}`, { archived: true });
  result = await owner.request('PUT', '/api/tasks/reorder', {
    items: [{ id: archivedId, quadrant: 1, position: 1 }],
  });
  assert.equal(result.response.status, 404);

  // ---------- ลำดับต้องเรียงตาม position จริง ๆ ----------
  const ids = [];
  for (const title of ['A', 'B', 'C']) {
    result = await owner.request('POST', '/api/tasks', { title, quadrant: 3 });
    ids.push(result.data.id);
  }
  result = await owner.request('PUT', '/api/tasks/reorder', {
    items: [
      { id: ids[2], quadrant: 3, position: 1 },
      { id: ids[1], quadrant: 3, position: 2 },
      { id: ids[0], quadrant: 3, position: 3 },
    ],
  });
  assert.equal(result.response.status, 200);
  const quadrantThree = result.data.filter((task) => task.quadrant === 3).map((task) => task.title);
  assert.deepEqual(quadrantThree, ['C', 'B', 'A'], 'API ต้องคืนงานเรียงตาม position');

  // ---------- เวลาที่ปิดงานต้องนับตามวันแบบไทย ----------
  const bangkokToday = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  db.prepare("UPDATE tasks SET completed = 1, completed_at = ? WHERE id = ?")
    .run(`${bangkokToday}T17:30:00.000Z`, ids[0]); // 00:30 ของวันถัดไปตามเวลาไทย
  result = await owner.request('GET', '/api/stats');
  assert.equal(result.response.status, 200);
  const stats = result.data;
  const totalDaily = stats.tasks.daily_completed.reduce((sum, day) => sum + day.count, 0);
  const quadrantCompleted = stats.tasks.quadrants.reduce((sum, q) => sum + q.completed_last_30_days, 0);
  assert.equal(
    quadrantCompleted,
    stats.tasks.completed_last_30_days,
    'ยอดรวมรายช่องต้องตรงกับยอดรวม 30 วัน (ต้องใช้เขตเวลาเดียวกัน)',
  );
  assert.ok(totalDaily <= stats.tasks.completed_last_30_days);

  // ---------- Subscription: รอบบิลเปลี่ยนเป็นจ่ายครั้งเดียวแล้วต่ออายุไม่ได้ ----------
  result = await owner.request('POST', '/api/subscriptions', {
    name: 'บริการทดสอบ', renewal_date: '2026-01-15', amount: 100, billing_cycle: 'monthly', category: 'ทดสอบ',
  });
  const subscriptionId = result.data.id;
  result = await owner.request('PUT', `/api/subscriptions/${subscriptionId}`, { billing_cycle: 'one_time' });
  assert.equal(result.response.status, 200);
  result = await owner.request('POST', `/api/subscriptions/${subscriptionId}/renew`);
  assert.equal(result.response.status, 400);
  await owner.request('PUT', `/api/subscriptions/${subscriptionId}`, { billing_cycle: 'monthly' });

  // ล้างราคาทิ้งได้ และต้องไม่กลายเป็นศูนย์บาท
  result = await owner.request('PUT', `/api/subscriptions/${subscriptionId}`, { amount: null });
  assert.equal(result.data.amount, null);
  result = await owner.request('GET', '/api/stats');
  const testCategory = result.data.subscriptions.by_category.find((entry) => entry.category === 'ทดสอบ');
  assert.equal(testCategory, undefined, 'รายการที่ไม่มีราคาต้องไม่โผล่ในสรุปค่าใช้จ่าย');
  await owner.request('PUT', `/api/subscriptions/${subscriptionId}`, { amount: 100 });

  // ต่ออายุรายการที่ไม่มีราคาได้ และประวัติต้องบันทึก amount เป็น null ไม่ใช่ 0
  result = await owner.request('POST', '/api/subscriptions', {
    name: 'ไม่ระบุราคา', renewal_date: '2026-01-10', billing_cycle: 'monthly',
  });
  const noPriceId = result.data.id;
  result = await owner.request('POST', `/api/subscriptions/${noPriceId}/renew`);
  assert.equal(result.response.status, 200);
  result = await owner.request('GET', '/api/subscriptions/payments');
  const noPricePayment = result.data.find((payment) => payment.subscription_id === noPriceId);
  assert.equal(noPricePayment.amount, null);

  // ---------- นำข้อมูลออกแล้วนำกลับเข้าต้องได้ของครบ ----------
  result = await owner.request('GET', '/api/data/export');
  const backup = result.data;
  assert.ok(Array.isArray(backup.subscription_payments));
  assert.ok(backup.subscription_payments.length >= 1, 'ไฟล์สำรองต้องมีประวัติการจ่าย');

  result = await owner.request('POST', '/api/data/import', { mode: 'replace', data: backup });
  assert.equal(result.response.status, 200);
  result = await owner.request('GET', '/api/subscriptions/payments');
  assert.equal(
    result.data.length,
    backup.subscription_payments.length,
    'นำเข้าแบบแทนที่ต้องกู้ประวัติการจ่ายกลับมาด้วย',
  );

  const afterImport = (await owner.request('GET', '/api/stats')).data;
  assert.ok(
    afterImport.subscriptions.paid_this_year.length >= 0,
    'สรุปยอดที่จ่ายไปแล้วต้องอ่านได้หลังนำเข้า',
  );

  // ---------- งานที่เก็บถาวรต้องไม่ถูกแจ้งเตือนอีก ----------
  result = await owner.request('POST', '/api/tasks', {
    title: 'งานเลยกำหนดที่เก็บถาวรแล้ว', quadrant: 1, due_date: '2020-01-01T00:00:00.000Z',
  });
  const staleId = result.data.id;
  await owner.request('PUT', `/api/tasks/${staleId}`, { archived: true });

  // ตั้งค่า Telegram ปลอมเพื่อให้ scheduler หยิบผู้ใช้รายนี้ขึ้นมาตรวจ
  db.prepare(`
    INSERT INTO settings (user_id, telegram_bot_token, telegram_chat_id, notify_before_minutes, daily_summary_enabled, daily_summary_time)
    VALUES (?, 'dummy-token', '1', 60, 1, '00:00')
    ON CONFLICT(user_id) DO UPDATE SET
      telegram_bot_token = 'dummy-token', telegram_chat_id = '1', notify_before_minutes = 60,
      daily_summary_enabled = 1, daily_summary_time = '00:00', daily_summary_last_sent = ''
  `).run(1);

  await checkDueReminders(new Date());
  const claimed = db.prepare('SELECT notified, notification_claimed_at FROM tasks WHERE id = ?').get(staleId);
  assert.equal(claimed.notification_claimed_at, null, 'งานที่เก็บถาวรต้องไม่ถูกหยิบไปแจ้งเตือน');

  await checkDailySummaries(new Date());
  const summarySent = db.prepare('SELECT daily_summary_last_sent FROM settings WHERE user_id = 1').get();
  assert.equal(summarySent.daily_summary_last_sent, '', 'ส่ง Telegram ไม่สำเร็จก็ต้องไม่บันทึกว่าส่งแล้ว');
  db.prepare("UPDATE settings SET telegram_bot_token = '', telegram_chat_id = '', daily_summary_enabled = 0 WHERE user_id = 1").run();

  // ---------- ไฟล์นำเข้าที่ไม่ถูกต้องต้องไม่ทำให้ข้อมูลเดิมหาย ----------
  const before = (await owner.request('GET', '/api/tasks')).data.length;
  result = await owner.request('POST', '/api/data/import', {
    mode: 'replace',
    data: { tasks: [{ title: 'ดี', quadrant: 1 }, { title: 'พัง', quadrant: 99 }] },
  });
  assert.equal(result.response.status, 400);
  const after = (await owner.request('GET', '/api/tasks')).data.length;
  assert.equal(after, before, 'ไฟล์ที่ตรวจไม่ผ่านต้องไม่ลบข้อมูลเดิมทิ้ง');
});
