const cron = require('node-cron');
const db = require('../db');
const { sendTelegramMessage } = require('./telegram');
const { decryptSecret, encryptSecret, needsSecretReencryption } = require('./secrets');

const QUADRANT_LABELS = {
  1: 'ทำทันที (ด่วน+สำคัญ)',
  2: 'วางแผนทำ (สำคัญ ไม่ด่วน)',
  3: 'มอบหมาย (ด่วน ไม่สำคัญ)',
  4: 'ทำทีหลัง (ไม่ด่วน ไม่สำคัญ)',
};
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TELEGRAM_TEXT = 3900;

function escapeTelegramHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatThaiDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'ไม่ระบุวันที่';
  return date.toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeZone: 'Asia/Bangkok',
  });
}

function bangkokClock(now = new Date()) {
  const date = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const time = now.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
  });
  const [hour, minute] = time.split(':').map(Number);
  return { date, time, minutes: (hour * 60) + minute };
}

function parseTimeMinutes(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return (hour * 60) + minute;
}

function settingsToken(settings) {
  const token = decryptSecret(settings.telegram_bot_token);
  if (token && needsSecretReencryption(settings.telegram_bot_token)) {
    db.prepare('UPDATE settings SET telegram_bot_token = ? WHERE user_id = ?')
      .run(encryptSecret(token), settings.user_id);
  }
  return token;
}

async function checkDueReminders(now = new Date()) {
  const users = db.prepare(`
    SELECT * FROM settings WHERE telegram_bot_token != '' AND telegram_chat_id != ''
  `).all();
  const claimTime = now.toISOString();
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS).toISOString();

  for (const settings of users) {
    let token;
    try {
      token = settingsToken(settings);
    } catch (error) {
      console.error(`[scheduler] ถอดรหัส Telegram token ของผู้ใช้ ${settings.user_id} ไม่สำเร็จ:`, error.message);
      continue;
    }
    const notifyMinutes = Number(settings.notify_before_minutes);
    if (!Number.isFinite(notifyMinutes) || notifyMinutes <= 0) continue;
    const windowEnd = new Date(now.getTime() + notifyMinutes * 60000).toISOString();
    const dueTasks = db.prepare(`
      SELECT * FROM tasks
      WHERE user_id = ? AND completed = 0 AND notified = 0
        AND due_date IS NOT NULL AND due_date != ''
        AND datetime(due_date) <= datetime(?)
        AND (notification_claimed_at IS NULL OR notification_claimed_at < ?)
      ORDER BY due_date, id
    `).all(settings.user_id, windowEnd, staleBefore);

    for (const task of dueTasks) {
      const claimed = db.prepare(`
        UPDATE tasks SET notification_claimed_at = ?
        WHERE id = ? AND user_id = ? AND completed = 0 AND notified = 0
          AND (notification_claimed_at IS NULL OR notification_claimed_at < ?)
      `).run(claimTime, task.id, settings.user_id, staleBefore);
      if (claimed.changes !== 1) continue;

      const overdue = new Date(task.due_date).getTime() < now.getTime();
      const heading = overdue ? 'เลยกำหนดแล้ว' : 'ใกล้ถึงกำหนดแล้ว';
      const text = [
        `⏰ <b>${heading}</b>`,
        escapeTelegramHtml(task.title),
        `กำหนด: ${escapeTelegramHtml(formatThaiDate(task.due_date))}`,
        `หมวด: ${escapeTelegramHtml(QUADRANT_LABELS[task.quadrant] || '')}`,
      ].join('\n');
      const result = await sendTelegramMessage(
        token,
        settings.telegram_chat_id,
        text,
      );
      if (result.ok) {
        db.prepare(`
          UPDATE tasks SET notified = 1, notification_claimed_at = NULL WHERE id = ? AND user_id = ?
        `).run(task.id, settings.user_id);
      } else {
        db.prepare('UPDATE tasks SET notification_claimed_at = NULL WHERE id = ? AND user_id = ?')
          .run(task.id, settings.user_id);
        console.warn(`[scheduler] ส่งแจ้งเตือนงาน ${task.id} ไม่สำเร็จ: ${result.error}`);
      }
    }
  }
}

function daysUntilDate(dateValue, now = new Date()) {
  const today = bangkokClock(now).date;
  const targetMs = Date.parse(dateValue + 'T00:00:00Z');
  const todayMs = Date.parse(today + 'T00:00:00Z');
  if (Number.isNaN(targetMs) || Number.isNaN(todayMs)) return null;
  return Math.round((targetMs - todayMs) / 86400000);
}

async function checkSubscriptionReminders(now = new Date()) {
  const users = db.prepare(
    "SELECT * FROM settings WHERE telegram_bot_token != '' AND telegram_chat_id != ''",
  ).all();
  const claimTime = now.toISOString();
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS).toISOString();

  for (const settings of users) {
    let token;
    try {
      token = settingsToken(settings);
    } catch (error) {
      console.error('[scheduler] ถอดรหัส Telegram token ของผู้ใช้ ' + settings.user_id + ' ไม่สำเร็จ:', error.message);
      continue;
    }

    const subscriptions = db.prepare(
      'SELECT * FROM subscriptions WHERE user_id = ? AND notified = 0 AND (notification_claimed_at IS NULL OR notification_claimed_at < ?) ORDER BY renewal_date, id',
    ).all(settings.user_id, staleBefore);

    for (const subscription of subscriptions) {
      const days = daysUntilDate(subscription.renewal_date, now);
      if (days === null || days > subscription.reminder_days) continue;

      const claimed = db.prepare(
        'UPDATE subscriptions SET notification_claimed_at = ? WHERE id = ? AND user_id = ? AND notified = 0 AND (notification_claimed_at IS NULL OR notification_claimed_at < ?)',
      ).run(claimTime, subscription.id, settings.user_id, staleBefore);
      if (claimed.changes !== 1) continue;

      const status = days < 0
        ? 'หมดอายุแล้ว ' + Math.abs(days) + ' วัน'
        : days === 0 ? 'หมดอายุวันนี้' : 'เหลืออีก ' + days + ' วัน';
      const text = [
        '🔔 <b>Subscription ใกล้หมดอายุ</b>',
        escapeTelegramHtml(subscription.name),
        subscription.plan_name ? 'แพ็กเกจ: ' + escapeTelegramHtml(subscription.plan_name) : '',
        '<b>สถานะ: ' + escapeTelegramHtml(status) + '</b>',
        'วันต่ออายุ: ' + escapeTelegramHtml(formatThaiDate(subscription.renewal_date)),
        subscription.price ? 'ราคา: ' + escapeTelegramHtml(subscription.price) : '',
      ].filter(Boolean).join('\n');
      const result = await sendTelegramMessage(
        token,
        settings.telegram_chat_id,
        text,
      );
      if (result.ok) {
        db.prepare(
          'UPDATE subscriptions SET notified = 1, notification_claimed_at = NULL WHERE id = ? AND user_id = ?',
        ).run(subscription.id, settings.user_id);
      } else {
        db.prepare('UPDATE subscriptions SET notification_claimed_at = NULL WHERE id = ? AND user_id = ?')
          .run(subscription.id, settings.user_id);
        console.warn('[scheduler] ส่งแจ้งเตือน Subscription ' + subscription.id + ' ไม่สำเร็จ: ' + result.error);
      }
    }
  }
}

function buildDailySummary(tasks) {
  if (tasks.length === 0) return '🗂 <b>สรุปงานประจำวัน</b>\n\nวันนี้ไม่มีงานค้างเลย 🎉';

  let text = '🗂 <b>สรุปงานประจำวัน</b>\n\n';
  let omitted = 0;
  for (const quadrant of [1, 2, 3, 4]) {
    const items = tasks.filter((task) => task.quadrant === quadrant);
    if (items.length === 0) continue;
    const heading = `<b>${escapeTelegramHtml(QUADRANT_LABELS[quadrant])}</b>\n`;
    if (text.length + heading.length < MAX_TELEGRAM_TEXT - 80) text += heading;
    else {
      omitted += items.length;
      continue;
    }

    for (const task of items) {
      const due = task.due_date ? ` (กำหนด ${escapeTelegramHtml(formatThaiDate(task.due_date))})` : '';
      const line = `• ${escapeTelegramHtml(task.title)}${due}\n`;
      if (text.length + line.length < MAX_TELEGRAM_TEXT - 80) text += line;
      else omitted += 1;
    }
    text += '\n';
  }
  if (omitted > 0) text += `… และอีก ${omitted} งานที่ไม่ได้แสดง`;
  return text.trim();
}

async function checkDailySummaries(now = new Date()) {
  const clock = bangkokClock(now);
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS).toISOString();
  const claimTime = now.toISOString();
  const users = db.prepare(`
    SELECT * FROM settings
    WHERE daily_summary_enabled = 1 AND telegram_bot_token != '' AND telegram_chat_id != ''
  `).all();

  for (const settings of users) {
    const scheduledMinutes = parseTimeMinutes(settings.daily_summary_time);
    if (scheduledMinutes === null || clock.minutes < scheduledMinutes) continue;
    if (settings.daily_summary_last_sent === clock.date) continue;

    let token;
    try {
      token = settingsToken(settings);
    } catch (error) {
      console.error(`[scheduler] ถอดรหัส Telegram token ของผู้ใช้ ${settings.user_id} ไม่สำเร็จ:`, error.message);
      continue;
    }

    const claim = db.prepare(`
      UPDATE settings
      SET daily_summary_claimed_for = ?, daily_summary_claimed_at = ?
      WHERE user_id = ? AND COALESCE(daily_summary_last_sent, '') != ?
        AND (
          COALESCE(daily_summary_claimed_for, '') != ?
          OR daily_summary_claimed_at IS NULL
          OR daily_summary_claimed_at < ?
        )
    `).run(clock.date, claimTime, settings.user_id, clock.date, clock.date, staleBefore);
    if (claim.changes !== 1) continue;

    const tasks = db.prepare(`
      SELECT * FROM tasks WHERE user_id = ? AND completed = 0 ORDER BY quadrant, due_date, id
    `).all(settings.user_id);
    const result = await sendTelegramMessage(
      token,
      settings.telegram_chat_id,
      buildDailySummary(tasks),
    );
    if (result.ok) {
      db.prepare(`
        UPDATE settings
        SET daily_summary_last_sent = ?, daily_summary_claimed_for = '', daily_summary_claimed_at = NULL
        WHERE user_id = ?
      `).run(clock.date, settings.user_id);
    } else {
      db.prepare(`
        UPDATE settings SET daily_summary_claimed_for = '', daily_summary_claimed_at = NULL WHERE user_id = ?
      `).run(settings.user_id);
      console.warn(`[scheduler] ส่งสรุปของผู้ใช้ ${settings.user_id} ไม่สำเร็จ: ${result.error}`);
    }
  }
}

function startScheduler() {
  let running = false;
  const task = cron.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      await checkSubscriptionReminders(now);
      await checkDueReminders(now);
      await checkDailySummaries(now);
    } catch (error) {
      console.error('[scheduler] error:', error);
    } finally {
      running = false;
    }
  });
  console.log('[scheduler] เริ่มตรวจสอบการแจ้งเตือนทุกนาทีแล้ว');
  return () => task.stop();
}

module.exports = {
  startScheduler,
  checkSubscriptionReminders,
  daysUntilDate,
  checkDueReminders,
  checkDailySummaries,
  buildDailySummary,
  escapeTelegramHtml,
  bangkokClock,
};
