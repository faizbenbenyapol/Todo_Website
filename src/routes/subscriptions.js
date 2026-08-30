const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { BILLING_CYCLES, nextRenewalDate } = require('../services/subscriptions');
const { APP_TIME_ZONE } = require('../services/recurrence');
const {
  assertPlainObject,
  stringValue,
  integerValue,
  positiveId,
  dateValue,
  ValidationError,
} = require('../validation');

const router = express.Router();
router.use(requireAuth);

const MAX_AMOUNT = 100000000;

function amountValue(value, options = {}) {
  if (value === undefined) return options.partial ? undefined : null;
  if (value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ValidationError('ราคาต้องเป็นตัวเลข');
  if (value < 0) throw new ValidationError('ราคาต้องไม่ติดลบ');
  if (value > MAX_AMOUNT) throw new ValidationError('ราคาสูงเกินกว่าที่ระบบรองรับ');
  return Math.round(value * 100) / 100;
}

function currencyValue(value, options = {}) {
  if (value === undefined) return options.partial ? undefined : 'THB';
  if (value === null || value === '') return 'THB';
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value.trim())) {
    throw new ValidationError('สกุลเงินต้องเป็นรหัส 3 ตัวอักษร เช่น THB หรือ USD');
  }
  return value.trim().toUpperCase();
}

function billingCycleValue(value, options = {}) {
  if (value === undefined) return options.partial ? undefined : 'monthly';
  if (value === null || value === '') return 'monthly';
  if (typeof value !== 'string' || !BILLING_CYCLES.includes(value)) {
    throw new ValidationError('รอบการจ่ายเงินไม่ถูกต้อง');
  }
  return value;
}

function subscriptionFields(body, options = {}) {
  const partial = options.partial === true;
  const name = body.name === undefined && partial
    ? undefined
    : stringValue(body.name, 'ชื่อบริการ', { required: true, min: 1, max: 200 });
  const planName = body.plan_name === undefined && partial
    ? undefined
    : stringValue(body.plan_name, 'ชื่อแพ็กเกจ', { max: 200 }) ?? '';
  const price = body.price === undefined && partial
    ? undefined
    : stringValue(body.price, 'ราคา', { max: 50 }) ?? '';
  const renewalDate = body.renewal_date === undefined && partial
    ? undefined
    : dateValue(body.renewal_date, 'วันต่ออายุ', { required: true });
  const reminderDays = body.reminder_days === undefined && partial
    ? undefined
    : integerValue(body.reminder_days ?? 7, 'จำนวนวันที่แจ้งเตือนล่วงหน้า', { min: 1, max: 365 });
  const notes = body.notes === undefined && partial
    ? undefined
    : stringValue(body.notes, 'โน้ต', { max: 5000 }) ?? '';
  const amount = amountValue(body.amount, { partial });
  const currency = currencyValue(body.currency, { partial });
  const billingCycle = billingCycleValue(body.billing_cycle, { partial });
  const category = body.category === undefined && partial
    ? undefined
    : stringValue(body.category, 'กลุ่ม', { max: 40 }) ?? '';

  return { name, planName, price, renewalDate, reminderDays, notes, amount, currency, billingCycle, category };
}

router.get('/', (req, res) => {
  const subscriptions = db.prepare(
    'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY renewal_date, id',
  ).all(req.session.userId);
  res.json(subscriptions);
});

router.post('/', (req, res) => {
  const body = assertPlainObject(req.body);
  const fields = subscriptionFields(body);
  const info = db.prepare(`
    INSERT INTO subscriptions
      (user_id, name, plan_name, price, renewal_date, reminder_days, notes, amount, currency, billing_cycle, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.session.userId,
    fields.name,
    fields.planName,
    fields.price,
    fields.renewalDate,
    fields.reminderDays,
    fields.notes,
    fields.amount,
    fields.currency,
    fields.billingCycle,
    fields.category,
  );
  res.status(201).json(db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const id = positiveId(req.params.id, 'รหัส Subscription');
  const body = assertPlainObject(req.body);
  const subscription = db.prepare('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?')
    .get(id, req.session.userId);
  if (!subscription) return res.status(404).json({ error: 'ไม่พบ Subscription นี้' });

  const allowedFields = [
    'name', 'plan_name', 'price', 'renewal_date', 'reminder_days', 'notes',
    'amount', 'currency', 'billing_cycle', 'category',
  ];
  if (!allowedFields.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
    throw new ValidationError('ไม่มีข้อมูลที่ต้องการแก้ไข');
  }

  const fields = subscriptionFields(body, { partial: true });
  const name = fields.name ?? subscription.name;
  const planName = fields.planName ?? subscription.plan_name;
  const price = fields.price ?? subscription.price;
  const renewalDate = fields.renewalDate ?? subscription.renewal_date;
  const reminderDays = fields.reminderDays ?? subscription.reminder_days;
  const notes = fields.notes ?? subscription.notes;
  const amount = fields.amount === undefined ? subscription.amount : fields.amount;
  const currency = fields.currency ?? subscription.currency;
  const billingCycle = fields.billingCycle ?? subscription.billing_cycle;
  const category = fields.category ?? subscription.category;
  const reminderChanged = renewalDate !== subscription.renewal_date
    || reminderDays !== subscription.reminder_days;

  db.prepare(`
    UPDATE subscriptions SET
      name = ?, plan_name = ?, price = ?, renewal_date = ?, reminder_days = ?, notes = ?,
      amount = ?, currency = ?, billing_cycle = ?, category = ?,
      notified = ?, notification_claimed_at = NULL, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(
    name,
    planName,
    price,
    renewalDate,
    reminderDays,
    notes,
    amount,
    currency,
    billingCycle,
    category,
    reminderChanged ? 0 : subscription.notified,
    id,
    req.session.userId,
  );

  return res.json(db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id));
});

// ยืนยันว่าจ่ายรอบนี้แล้ว: บันทึกประวัติ เลื่อนวันต่ออายุไปรอบถัดไป และเปิดให้แจ้งเตือนรอบใหม่ได้
router.post('/:id/renew', (req, res) => {
  const id = positiveId(req.params.id, 'รหัส Subscription');
  const subscription = db.prepare('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?')
    .get(id, req.session.userId);
  if (!subscription) return res.status(404).json({ error: 'ไม่พบ Subscription นี้' });
  if (subscription.billing_cycle === 'one_time') {
    throw new ValidationError('รายการจ่ายครั้งเดียวไม่มีรอบต่ออายุ');
  }

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: APP_TIME_ZONE });
  const upcoming = nextRenewalDate(subscription.renewal_date, subscription.billing_cycle, today);
  if (!upcoming) throw new ValidationError('คำนวณวันต่ออายุรอบถัดไปไม่สำเร็จ');

  const renew = db.transaction(() => {
    db.prepare(`
      INSERT INTO subscription_payments (subscription_id, user_id, paid_on, amount, currency, billing_cycle)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.session.userId,
      subscription.renewal_date,
      subscription.amount,
      subscription.currency || 'THB',
      subscription.billing_cycle,
    );
    db.prepare(`
      UPDATE subscriptions
      SET renewal_date = ?, notified = 0, notification_claimed_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(upcoming, id, req.session.userId);
  });
  renew.immediate();

  return res.json({
    subscription: db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id),
    paid_on: subscription.renewal_date,
  });
});

router.get('/payments', (req, res) => {
  const payments = db.prepare(`
    SELECT p.id, p.subscription_id, p.paid_on, p.amount, p.currency, p.billing_cycle, s.name, s.category
    FROM subscription_payments p
    LEFT JOIN subscriptions s ON s.id = p.subscription_id
    WHERE p.user_id = ?
    ORDER BY p.paid_on DESC, p.id DESC
    LIMIT 200
  `).all(req.session.userId);
  res.json(payments);
});

router.delete('/:id', (req, res) => {
  const id = positiveId(req.params.id, 'รหัส Subscription');
  const result = db.prepare('DELETE FROM subscriptions WHERE id = ? AND user_id = ?')
    .run(id, req.session.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'ไม่พบ Subscription นี้' });
  return res.json({ ok: true });
});

module.exports = router;
