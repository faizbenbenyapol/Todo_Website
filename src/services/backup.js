// สร้างไฟล์สำรองข้อมูล ใช้ร่วมกันระหว่างปุ่มส่งออกในแอปและงานสำรองอัตโนมัติ
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { withDetails } = require('./tasks');

const FORMAT_VERSION = 1;

function exportTask(task) {
  return {
    title: task.title,
    description: task.description,
    quadrant: task.quadrant,
    due_date: task.due_date,
    due_has_time: Boolean(task.due_has_time),
    completed: Boolean(task.completed),
    archived: Boolean(task.archived),
    recur_rule: task.recur_rule,
    recur_interval: task.recur_interval,
    tags: task.tags,
    subtasks: task.subtasks.map((subtask) => ({
      title: subtask.title,
      completed: subtask.completed,
    })),
    created_at: task.created_at,
  };
}

function buildExport(userId) {
  const tasks = db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY quadrant, position, id').all(userId);
  const notes = db.prepare('SELECT content, created_at FROM notes WHERE user_id = ? ORDER BY id').all(userId);
  const subscriptions = db.prepare(`
    SELECT name, plan_name, price, renewal_date, reminder_days, notes,
           amount, currency, billing_cycle, category, created_at
    FROM subscriptions WHERE user_id = ? ORDER BY renewal_date, id
  `).all(userId);
  const payments = db.prepare(`
    SELECT s.name AS subscription_name, p.paid_on, p.amount, p.currency, p.billing_cycle
    FROM subscription_payments p
    LEFT JOIN subscriptions s ON s.id = p.subscription_id
    WHERE p.user_id = ? ORDER BY p.paid_on, p.id
  `).all(userId);
  const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);

  return {
    app: 'eisenhower-board',
    format_version: FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    tasks: withDetails(tasks).map(exportTask),
    notes,
    subscriptions,
    subscription_payments: payments,
    // ไม่ส่งออก Bot Token และ Chat ID เพื่อไม่ให้ความลับหลุดไปกับไฟล์
    settings: settings
      ? {
        notify_before_minutes: settings.notify_before_minutes,
        subscription_notify_enabled: Boolean(settings.subscription_notify_enabled),
        daily_summary_enabled: Boolean(settings.daily_summary_enabled),
        daily_summary_time: settings.daily_summary_time,
      }
      : null,
  };
}

// เก็บไฟล์ล่าสุดไว้ตามจำนวนที่กำหนด แล้วลบไฟล์เก่ากว่านั้นทิ้ง เพื่อไม่ให้ดิสก์เต็ม
function pruneBackups(directory, keep) {
  const files = fs.readdirSync(directory)
    .filter((name) => /^eisenhower-board-user\d+-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();
  const grouped = new Map();
  for (const name of files) {
    const user = name.match(/user(\d+)-/)[1];
    if (!grouped.has(user)) grouped.set(user, []);
    grouped.get(user).push(name);
  }
  const removed = [];
  for (const names of grouped.values()) {
    while (names.length > keep) {
      const oldest = names.shift();
      fs.rmSync(path.join(directory, oldest), { force: true });
      removed.push(oldest);
    }
  }
  return removed;
}

function writeBackups(options) {
  const { directory, keep, date } = options;
  fs.mkdirSync(directory, { recursive: true });
  const users = db.prepare('SELECT id FROM users ORDER BY id').all();
  const written = [];
  for (const user of users) {
    const fileName = `eisenhower-board-user${user.id}-${date}.json`;
    const target = path.join(directory, fileName);
    fs.writeFileSync(target, JSON.stringify(buildExport(user.id)), 'utf8');
    written.push(fileName);
  }
  const removed = pruneBackups(directory, keep);
  return { written, removed };
}

module.exports = { buildExport, writeBackups, pruneBackups, FORMAT_VERSION };
