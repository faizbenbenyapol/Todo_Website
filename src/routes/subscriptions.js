const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
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

  return { name, planName, price, renewalDate, reminderDays, notes };
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
  const info = db.prepare(
    'INSERT INTO subscriptions (user_id, name, plan_name, price, renewal_date, reminder_days, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    req.session.userId,
    fields.name,
    fields.planName,
    fields.price,
    fields.renewalDate,
    fields.reminderDays,
    fields.notes,
  );
  res.status(201).json(db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const id = positiveId(req.params.id, 'รหัส Subscription');
  const body = assertPlainObject(req.body);
  const subscription = db.prepare('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?')
    .get(id, req.session.userId);
  if (!subscription) return res.status(404).json({ error: 'ไม่พบ Subscription นี้' });

  const allowedFields = ['name', 'plan_name', 'price', 'renewal_date', 'reminder_days', 'notes'];
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
  const reminderChanged = renewalDate !== subscription.renewal_date
    || reminderDays !== subscription.reminder_days;

  db.prepare(
    "UPDATE subscriptions SET name = ?, plan_name = ?, price = ?, renewal_date = ?, reminder_days = ?, notes = ?, notified = ?, notification_claimed_at = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
  ).run(
    name,
    planName,
    price,
    renewalDate,
    reminderDays,
    notes,
    reminderChanged ? 0 : subscription.notified,
    id,
    req.session.userId,
  );

  return res.json(db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id));
});

router.delete('/:id', (req, res) => {
  const id = positiveId(req.params.id, 'รหัส Subscription');
  const result = db.prepare('DELETE FROM subscriptions WHERE id = ? AND user_id = ?')
    .run(id, req.session.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'ไม่พบ Subscription นี้' });
  return res.json({ ok: true });
});

module.exports = router;
