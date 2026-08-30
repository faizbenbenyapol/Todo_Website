const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eisenhower-board-workflow-'));
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
const { nextRenewalDate } = require('../src/services/subscriptions');
const { writeBackups, buildExport } = require('../src/services/backup');

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

test('วันต่ออายุรอบถัดไปคำนวณตามรอบบิล', () => {
  const today = '2026-08-30';
  assert.equal(nextRenewalDate('2026-08-24', 'monthly', today), '2026-09-24');
  assert.equal(nextRenewalDate('2026-09-05', 'monthly', today), '2026-10-05');
  assert.equal(nextRenewalDate('2026-08-24', 'quarterly', today), '2026-11-24');
  assert.equal(nextRenewalDate('2026-08-18', 'yearly', today), '2027-08-18');
  assert.equal(nextRenewalDate('2026-08-24', 'weekly', today), '2026-08-31');
  // ค้างมาหลายรอบต้องข้ามมาที่รอบถัดไปในอนาคต ไม่ใช่ขยับทีละรอบให้ยังอยู่ในอดีต
  assert.equal(nextRenewalDate('2026-01-15', 'monthly', today), '2026-09-15');
  // วันสิ้นเดือนต้องหดตามเดือนสั้น แล้วกลับมาเต็มเดือนเมื่อทำได้
  assert.equal(nextRenewalDate('2026-01-31', 'monthly', '2026-02-01'), '2026-02-28');
  assert.equal(nextRenewalDate('2026-08-24', 'one_time', today), null);
  assert.equal(nextRenewalDate('ไม่ใช่วันที่', 'monthly', today), null);
});

test('ต่ออายุ Subscription จัดลำดับงาน สถิติ และสำรองข้อมูล', async (t) => {
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

  // ---------- ต่ออายุ Subscription ----------
  const past = new Date(Date.now() - (10 * 86400000)).toISOString().slice(0, 10);
  result = await owner.request('POST', '/api/subscriptions', {
    name: 'Netflix', renewal_date: past, amount: 419, currency: 'THB', billing_cycle: 'monthly', category: 'บันเทิง',
  });
  assert.equal(result.response.status, 201);
  const subscriptionId = result.data.id;

  result = await owner.request('POST', `/api/subscriptions/${subscriptionId}/renew`);
  assert.equal(result.response.status, 200);
  assert.equal(result.data.paid_on, past);
  assert.ok(result.data.subscription.renewal_date > past, 'วันต่ออายุต้องขยับไปข้างหน้า');
  assert.equal(result.data.subscription.notified, 0, 'ต้องเปิดให้แจ้งเตือนรอบใหม่ได้อีกครั้ง');
  const renewedDate = result.data.subscription.renewal_date;

  result = await owner.request('GET', '/api/subscriptions/payments');
  assert.equal(result.response.status, 200);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].paid_on, past);
  assert.equal(result.data[0].amount, 419);
  assert.equal(result.data[0].name, 'Netflix');

  // ต่ออายุซ้ำต้องขยับไปอีกรอบ ไม่ใช่ค้างที่เดิม
  result = await owner.request('POST', `/api/subscriptions/${subscriptionId}/renew`);
  assert.ok(result.data.subscription.renewal_date > renewedDate);

  result = await owner.request('POST', '/api/subscriptions', {
    name: 'ไลเซนส์ถาวร', renewal_date: '2026-12-01', amount: 2500, billing_cycle: 'one_time',
  });
  const oneTimeId = result.data.id;
  result = await owner.request('POST', `/api/subscriptions/${oneTimeId}/renew`);
  assert.equal(result.response.status, 400, 'รายการจ่ายครั้งเดียวต้องต่ออายุไม่ได้');

  result = await owner.request('POST', '/api/subscriptions/999999/renew');
  assert.equal(result.response.status, 404);

  // ---------- จัดลำดับงาน ----------
  const created = [];
  for (const title of ['งาน A', 'งาน B', 'งาน C']) {
    result = await owner.request('POST', '/api/tasks', { title, quadrant: 1 });
    created.push(result.data);
  }
  assert.deepEqual(created.map((task) => task.position), [1, 2, 3]);

  result = await owner.request('PUT', '/api/tasks/reorder', {
    items: [
      { id: created[2].id, quadrant: 1, position: 1 },
      { id: created[0].id, quadrant: 1, position: 2 },
      { id: created[1].id, quadrant: 2, position: 1 },
    ],
  });
  assert.equal(result.response.status, 200);
  const ordered = result.data;
  const quadrantOne = ordered.filter((task) => task.quadrant === 1).map((task) => task.title);
  assert.deepEqual(quadrantOne, ['งาน C', 'งาน A'], 'ลำดับใหม่ในช่องเดิมต้องสลับตามที่ส่งไป');
  assert.equal(ordered.find((task) => task.title === 'งาน B').quadrant, 2, 'งานต้องย้ายข้ามช่องได้');

  result = await owner.request('PUT', '/api/tasks/reorder', { items: [{ id: 999999, quadrant: 1, position: 1 }] });
  assert.equal(result.response.status, 404);
  result = await owner.request('PUT', '/api/tasks/reorder', { items: [{ id: created[0].id, quadrant: 9, position: 1 }] });
  assert.equal(result.response.status, 400);
  result = await owner.request('PUT', '/api/tasks/reorder', { items: 'ไม่ใช่รายการ' });
  assert.equal(result.response.status, 400);

  // ---------- สถิติ ----------
  result = await owner.request('PUT', `/api/tasks/${created[0].id}`, { completed: true });
  assert.equal(result.response.status, 200);
  assert.ok(result.data.completed_at, 'ปิดงานแล้วต้องบันทึกเวลาที่ปิด');
  const completedAt = result.data.completed_at;

  // แก้ไขเรื่องอื่นภายหลังต้องไม่ขยับเวลาที่ปิดงาน
  result = await owner.request('PUT', `/api/tasks/${created[0].id}`, { title: 'งาน A (แก้ชื่อ)' });
  assert.equal(result.data.completed_at, completedAt);

  // เปิดงานกลับมาแล้วเวลาที่ปิดต้องถูกล้าง
  result = await owner.request('PUT', `/api/tasks/${created[0].id}`, { completed: false });
  assert.equal(result.data.completed_at, null);
  await owner.request('PUT', `/api/tasks/${created[0].id}`, { completed: true });

  result = await owner.request('GET', '/api/stats');
  assert.equal(result.response.status, 200);
  const stats = result.data;
  assert.equal(stats.tasks.total, 3);
  assert.equal(stats.tasks.completed, 1);
  assert.equal(stats.tasks.pending, 2);
  assert.equal(stats.tasks.completed_last_7_days, 1);
  assert.equal(stats.tasks.daily_completed.length, 14);
  assert.equal(stats.tasks.daily_completed[13].count, 1, 'งานที่เพิ่งปิดต้องนับอยู่ในวันนี้');
  assert.equal(stats.tasks.quadrants.length, 4);
  assert.equal(stats.subscriptions.total, 2);
  const thb = stats.subscriptions.totals.find((entry) => entry.currency === 'THB');
  assert.equal(Math.round(thb.monthly), 419, 'จ่ายครั้งเดียวต้องไม่ถูกนับในยอดต่อเดือน');
  assert.ok(stats.subscriptions.by_category.some((entry) => entry.category === 'บันเทิง'));
  const paid = stats.subscriptions.paid_this_year.find((entry) => entry.currency === 'THB');
  assert.equal(paid.count, 2, 'ประวัติการจ่ายต้องนับทั้งสองรอบที่กดต่ออายุ');

  // ---------- สำรองข้อมูลอัตโนมัติ ----------
  const backupDir = path.join(dataDir, 'backups');
  let backup = writeBackups({ directory: backupDir, keep: 2, date: '2026-08-01' });
  assert.equal(backup.written.length, 1);
  assert.equal(backup.removed.length, 0);
  writeBackups({ directory: backupDir, keep: 2, date: '2026-08-02' });
  backup = writeBackups({ directory: backupDir, keep: 2, date: '2026-08-03' });
  assert.equal(backup.removed.length, 1, 'ต้องลบไฟล์เก่าที่เกินจำนวนที่เก็บไว้');
  const remaining = fs.readdirSync(backupDir).sort();
  assert.deepEqual(remaining, [
    'eisenhower-board-user1-2026-08-02.json',
    'eisenhower-board-user1-2026-08-03.json',
  ]);

  const saved = JSON.parse(fs.readFileSync(path.join(backupDir, remaining[1]), 'utf8'));
  assert.equal(saved.app, 'eisenhower-board');
  assert.equal(saved.tasks.length, 3);
  assert.equal(saved.subscription_payments.length, 2);
  assert.ok(!('telegram_bot_token' in (saved.settings || {})), 'ไฟล์สำรองต้องไม่มี Bot Token');
  assert.deepEqual(Object.keys(buildExport(1)).sort(), Object.keys(saved).sort());
});
