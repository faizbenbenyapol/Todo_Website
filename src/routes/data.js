// นำข้อมูลทั้งหมดของผู้ใช้ออกเป็นไฟล์ JSON และนำกลับเข้าระบบ
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { BILLING_CYCLES } = require('../services/subscriptions');
const { buildExport, FORMAT_VERSION } = require('../services/backup');
const {
  tagsValue,
  subtasksValue,
  recurRuleValue,
  withDetails,
  replaceSubtasks,
  nextPosition,
  insertTaskRow,
} = require('../services/tasks');
const {
  assertPlainObject,
  stringValue,
  booleanValue,
  integerValue,
  isoDateValue,
  dateValue,
  timeValue,
  ValidationError,
} = require('../validation');

const router = express.Router();
router.use(requireAuth);

const MAX_IMPORT_TASKS = 2000;
const MAX_IMPORT_NOTES = 5000;
const MAX_IMPORT_SUBSCRIPTIONS = 500;
const MAX_IMPORT_PAYMENTS = 5000;
// ต้องตรงกับตัวเลือกใน /api/settings เพื่อไม่ให้ไฟล์นำเข้าตั้งค่าที่หน้าตั้งค่าเลือกไม่ได้
const NOTIFY_BEFORE_CHOICES = [15, 30, 60, 180, 1440];

const importLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'นำเข้าข้อมูลบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' },
});

// ไฟล์ส่งออกใหญ่กว่าคำขอปกติมาก จึงต้องใช้ตัวอ่าน JSON ที่ผ่อนขนาดเฉพาะเส้นทางนี้
const importBodyParser = express.json({ limit: '8mb', strict: true });

router.get('/export', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(buildExport(req.session.userId));
});

function readTaskRecord(item) {
  const entry = assertPlainObject(item, 'รูปแบบงานในไฟล์ไม่ถูกต้อง');
  const dueDate = isoDateValue(entry.due_date, 'กำหนดวันที่', { optional: true }) ?? null;
  const recurRule = recurRuleValue(entry.recur_rule, { optional: true }) ?? '';
  if (recurRule && !dueDate) throw new ValidationError('งานประจำในไฟล์ต้องมีกำหนดวันที่');
  return {
    title: stringValue(entry.title, 'ชื่องาน', { required: true, min: 1, max: 200 }),
    description: stringValue(entry.description, 'รายละเอียด', { max: 5000 }) ?? '',
    quadrant: integerValue(entry.quadrant, 'หมวดหมู่', { allowed: [1, 2, 3, 4] }),
    dueDate,
    dueHasTime: dueDate && booleanValue(entry.due_has_time ?? false, 'การระบุเวลา') ? 1 : 0,
    completed: booleanValue(entry.completed ?? false, 'สถานะเสร็จสิ้น') ? 1 : 0,
    archived: booleanValue(entry.archived ?? false, 'สถานะเก็บถาวร') ? 1 : 0,
    recurRule,
    recurInterval: integerValue(entry.recur_interval ?? 1, 'ความถี่งานประจำ', { min: 1, max: 365 }),
    tags: JSON.stringify(tagsValue(entry.tags, { optional: true }) ?? []),
    subtasks: subtasksValue(entry.subtasks, { optional: true }) ?? [],
  };
}

function readNoteRecord(item) {
  const entry = assertPlainObject(item, 'รูปแบบบันทึกในไฟล์ไม่ถูกต้อง');
  return {
    content: stringValue(entry.content, 'ข้อความ', { required: true, min: 1, max: 5000 }),
  };
}

function readSubscriptionRecord(item) {
  const entry = assertPlainObject(item, 'รูปแบบ Subscription ในไฟล์ไม่ถูกต้อง');
  let amount = null;
  if (entry.amount !== undefined && entry.amount !== null && entry.amount !== '') {
    if (typeof entry.amount !== 'number' || !Number.isFinite(entry.amount) || entry.amount < 0) {
      throw new ValidationError('ราคาของ Subscription ในไฟล์ไม่ถูกต้อง');
    }
    amount = Math.round(entry.amount * 100) / 100;
  }
  const currency = entry.currency === undefined || entry.currency === null || entry.currency === ''
    ? 'THB'
    : String(entry.currency);
  if (!/^[A-Za-z]{3}$/.test(currency)) throw new ValidationError('สกุลเงินในไฟล์ต้องเป็นรหัส 3 ตัวอักษร');
  const billingCycle = entry.billing_cycle === undefined || entry.billing_cycle === null || entry.billing_cycle === ''
    ? 'monthly'
    : entry.billing_cycle;
  if (!BILLING_CYCLES.includes(billingCycle)) throw new ValidationError('รอบการจ่ายเงินในไฟล์ไม่ถูกต้อง');

  return {
    name: stringValue(entry.name, 'ชื่อบริการ', { required: true, min: 1, max: 200 }),
    planName: stringValue(entry.plan_name, 'ชื่อแพ็กเกจ', { max: 200 }) ?? '',
    price: stringValue(entry.price, 'ราคา', { max: 50 }) ?? '',
    renewalDate: dateValue(entry.renewal_date, 'วันต่ออายุ', { required: true }),
    reminderDays: integerValue(entry.reminder_days ?? 7, 'จำนวนวันที่แจ้งเตือนล่วงหน้า', { min: 1, max: 365 }),
    notes: stringValue(entry.notes, 'โน้ต', { max: 5000 }) ?? '',
    amount,
    currency: currency.toUpperCase(),
    billingCycle,
    category: stringValue(entry.category, 'กลุ่ม', { max: 40 }) ?? '',
  };
}

function readPaymentRecord(item) {
  const entry = assertPlainObject(item, 'รูปแบบประวัติการจ่ายในไฟล์ไม่ถูกต้อง');
  let amount = null;
  if (entry.amount !== undefined && entry.amount !== null && entry.amount !== '') {
    if (typeof entry.amount !== 'number' || !Number.isFinite(entry.amount) || entry.amount < 0) {
      throw new ValidationError('ยอดจ่ายในไฟล์ไม่ถูกต้อง');
    }
    amount = Math.round(entry.amount * 100) / 100;
  }
  const currency = entry.currency === undefined || entry.currency === null || entry.currency === ''
    ? 'THB'
    : String(entry.currency);
  if (!/^[A-Za-z]{3}$/.test(currency)) throw new ValidationError('สกุลเงินในประวัติการจ่ายต้องเป็นรหัส 3 ตัวอักษร');
  const billingCycle = entry.billing_cycle === undefined || entry.billing_cycle === null || entry.billing_cycle === ''
    ? 'monthly'
    : entry.billing_cycle;
  if (!BILLING_CYCLES.includes(billingCycle)) throw new ValidationError('รอบการจ่ายในประวัติไม่ถูกต้อง');

  return {
    subscriptionName: stringValue(entry.subscription_name, 'ชื่อบริการในประวัติการจ่าย', { max: 200 }) ?? '',
    paidOn: dateValue(entry.paid_on, 'วันที่จ่าย', { required: true }),
    amount,
    currency: currency.toUpperCase(),
    billingCycle,
  };
}

function readSettingsRecord(value) {
  if (value === undefined || value === null) return null;
  const entry = assertPlainObject(value, 'รูปแบบการตั้งค่าในไฟล์ไม่ถูกต้อง');
  return {
    notifyBeforeMinutes: integerValue(entry.notify_before_minutes ?? 60, 'เวลาแจ้งเตือนล่วงหน้า', {
      allowed: NOTIFY_BEFORE_CHOICES,
    }),
    subscriptionNotifyEnabled: booleanValue(entry.subscription_notify_enabled ?? true, 'การแจ้งเตือน Subscription') ? 1 : 0,
    dailySummaryEnabled: booleanValue(entry.daily_summary_enabled ?? false, 'สรุปงานประจำวัน') ? 1 : 0,
    dailySummaryTime: timeValue(entry.daily_summary_time ?? '08:00', 'เวลาสรุปงานประจำวัน'),
  };
}

router.post('/import', importLimiter, importBodyParser, (req, res) => {
  const body = assertPlainObject(req.body);
  const mode = body.mode === undefined ? 'merge' : body.mode;
  if (mode !== 'merge' && mode !== 'replace') throw new ValidationError('โหมดนำเข้าต้องเป็น merge หรือ replace');

  const payload = assertPlainObject(body.data ?? body, 'ไฟล์นำเข้าไม่ถูกต้อง');
  if (payload.format_version !== undefined && Number(payload.format_version) > FORMAT_VERSION) {
    throw new ValidationError('ไฟล์นี้มาจากเวอร์ชันที่ใหม่กว่า กรุณาอัปเดตแอปก่อนนำเข้า');
  }

  const rawTasks = payload.tasks ?? [];
  const rawNotes = payload.notes ?? [];
  const rawSubscriptions = payload.subscriptions ?? [];
  const rawPayments = payload.subscription_payments ?? [];
  if (!Array.isArray(rawTasks) || !Array.isArray(rawNotes) || !Array.isArray(rawSubscriptions) || !Array.isArray(rawPayments)) {
    throw new ValidationError('ไฟล์นำเข้าไม่ถูกต้อง');
  }
  if (rawPayments.length > MAX_IMPORT_PAYMENTS) {
    throw new ValidationError('นำเข้าประวัติการจ่ายได้ไม่เกิน ' + MAX_IMPORT_PAYMENTS + ' รายการ');
  }
  if (rawTasks.length > MAX_IMPORT_TASKS) throw new ValidationError('นำเข้างานได้ไม่เกิน ' + MAX_IMPORT_TASKS + ' รายการ');
  if (rawNotes.length > MAX_IMPORT_NOTES) throw new ValidationError('นำเข้าบันทึกได้ไม่เกิน ' + MAX_IMPORT_NOTES + ' รายการ');
  if (rawSubscriptions.length > MAX_IMPORT_SUBSCRIPTIONS) {
    throw new ValidationError('นำเข้า Subscription ได้ไม่เกิน ' + MAX_IMPORT_SUBSCRIPTIONS + ' รายการ');
  }

  // ตรวจข้อมูลทั้งไฟล์ให้ผ่านก่อน แล้วค่อยเขียนลงฐานข้อมูลในธุรกรรมเดียว
  const tasks = rawTasks.map(readTaskRecord);
  const notes = rawNotes.map(readNoteRecord);
  const subscriptions = rawSubscriptions.map(readSubscriptionRecord);
  const payments = rawPayments.map(readPaymentRecord);
  const settings = readSettingsRecord(payload.settings);

  const userId = req.session.userId;
  let importedPayments = 0;
  const runImport = db.transaction(() => {
    if (mode === 'replace') {
      db.prepare('DELETE FROM tasks WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM notes WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(userId);
    }

    const positions = new Map();
    for (const task of tasks) {
      const base = positions.get(task.quadrant) ?? (nextPosition(userId, task.quadrant) - 1);
      const position = base + 1;
      positions.set(task.quadrant, position);
      const info = insertTaskRow({
        userId,
        title: task.title,
        description: task.description,
        quadrant: task.quadrant,
        dueDate: task.dueDate,
        dueHasTime: task.dueHasTime,
        recurRule: task.recurRule,
        recurInterval: task.recurInterval,
        tags: task.tags,
        position,
        completed: task.completed,
        archived: task.archived,
      });
      replaceSubtasks(info.lastInsertRowid, userId, task.subtasks);
    }

    const insertNote = db.prepare('INSERT INTO notes (user_id, content) VALUES (?, ?)');
    for (const note of notes) insertNote.run(userId, note.content);

    const insertSubscription = db.prepare(`
      INSERT INTO subscriptions
        (user_id, name, plan_name, price, renewal_date, reminder_days, notes, amount, currency, billing_cycle, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const subscriptionIdsByName = new Map();
    for (const subscription of subscriptions) {
      const info = insertSubscription.run(
        userId,
        subscription.name,
        subscription.planName,
        subscription.price,
        subscription.renewalDate,
        subscription.reminderDays,
        subscription.notes,
        subscription.amount,
        subscription.currency,
        subscription.billingCycle,
        subscription.category,
      );
      if (!subscriptionIdsByName.has(subscription.name)) {
        subscriptionIdsByName.set(subscription.name, info.lastInsertRowid);
      }
    }

    // ประวัติการจ่ายอ้างอิงด้วยชื่อบริการ เพราะ id เดิมใช้ไม่ได้หลังสร้างรายการใหม่
    const insertPayment = db.prepare(`
      INSERT INTO subscription_payments (subscription_id, user_id, paid_on, amount, currency, billing_cycle)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const payment of payments) {
      const subscriptionId = subscriptionIdsByName.get(payment.subscriptionName);
      if (!subscriptionId) continue;
      insertPayment.run(
        subscriptionId,
        userId,
        payment.paidOn,
        payment.amount,
        payment.currency,
        payment.billingCycle,
      );
      importedPayments += 1;
    }

    if (settings) {
      db.prepare('INSERT OR IGNORE INTO settings (user_id) VALUES (?)').run(userId);
      db.prepare(`
        UPDATE settings SET
          notify_before_minutes = ?, subscription_notify_enabled = ?,
          daily_summary_enabled = ?, daily_summary_time = ?
        WHERE user_id = ?
      `).run(
        settings.notifyBeforeMinutes,
        settings.subscriptionNotifyEnabled,
        settings.dailySummaryEnabled,
        settings.dailySummaryTime,
        userId,
      );
    }
  });
  runImport.immediate();

  return res.json({
    ok: true,
    mode,
    imported: {
      tasks: tasks.length,
      notes: notes.length,
      subscriptions: subscriptions.length,
      subscription_payments: importedPayments,
      settings: Boolean(settings),
    },
  });
});

module.exports = router;
