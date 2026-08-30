// สรุปภาพรวมงานและค่าใช้จ่าย สำหรับหน้าสถิติ
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { APP_TIME_ZONE } = require('../services/recurrence');
const { summarize, monthlyAmount, hasAmount } = require('../services/subscriptions');

const router = express.Router();
router.use(requireAuth);

const QUADRANTS = [1, 2, 3, 4];

function bangkokDate(now = new Date()) {
  return now.toLocaleDateString('sv-SE', { timeZone: APP_TIME_ZONE });
}

function shiftDate(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

router.get('/', (req, res) => {
  const userId = req.session.userId;
  const today = bangkokDate();
  const weekAgo = shiftDate(today, -6);
  const monthAgo = shiftDate(today, -29);

  const tasks = db.prepare('SELECT * FROM tasks WHERE user_id = ?').all(userId);
  const active = tasks.filter((task) => !task.archived);

  // completed_at เก็บเป็น UTC จึงตัดเป็นวันตามเวลาไทยก่อนนับ ไม่งั้นงานที่ปิดตอนดึกจะไปโผล่คนละวัน
  function completedDay(task) {
    if (!task.completed || !task.completed_at) return null;
    const date = new Date(task.completed_at);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('sv-SE', { timeZone: APP_TIME_ZONE });
  }

  const completedByDay = new Map();
  for (const task of tasks) {
    const day = completedDay(task);
    if (!day) continue;
    completedByDay.set(day, (completedByDay.get(day) || 0) + 1);
  }

  const dailyCompleted = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const day = shiftDate(today, -offset);
    dailyCompleted.push({ date: day, count: completedByDay.get(day) || 0 });
  }

  const countCompletedSince = (from) => [...completedByDay.entries()]
    .filter(([day]) => day >= from)
    .reduce((sum, [, count]) => sum + count, 0);

  const quadrants = QUADRANTS.map((quadrant) => {
    const inQuadrant = active.filter((task) => task.quadrant === quadrant);
    const completedInQuadrant = tasks.filter((task) => {
      if (task.quadrant !== quadrant) return false;
      const day = completedDay(task);
      return day !== null && day >= monthAgo;
    });
    return {
      quadrant,
      pending: inQuadrant.filter((task) => !task.completed).length,
      completed: inQuadrant.filter((task) => task.completed).length,
      completed_last_30_days: completedInQuadrant.length,
    };
  });

  const overdue = active.filter((task) => (
    !task.completed && task.due_date && new Date(task.due_date).getTime() < Date.now()
  )).length;

  const subscriptions = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').all(userId);
  const byCategory = new Map();
  for (const subscription of subscriptions) {
    if (!hasAmount(subscription)) continue;
    const currency = subscription.currency || 'THB';
    const key = `${(subscription.category || '').trim() || 'ไม่ระบุกลุ่ม'}|${currency}`;
    if (!byCategory.has(key)) {
      byCategory.set(key, {
        category: (subscription.category || '').trim() || 'ไม่ระบุกลุ่ม',
        currency,
        monthly: 0,
        count: 0,
      });
    }
    const entry = byCategory.get(key);
    entry.monthly += monthlyAmount(subscription);
    entry.count += 1;
  }

  const upcoming = subscriptions
    .filter((subscription) => subscription.renewal_date >= today && subscription.renewal_date <= shiftDate(today, 30))
    .sort((a, b) => a.renewal_date.localeCompare(b.renewal_date))
    .map((subscription) => ({
      id: subscription.id,
      name: subscription.name,
      renewal_date: subscription.renewal_date,
      amount: subscription.amount,
      currency: subscription.currency,
      billing_cycle: subscription.billing_cycle,
      category: subscription.category,
    }));

  const paymentsThisYear = db.prepare(`
    SELECT currency, SUM(amount) AS total, COUNT(*) AS count
    FROM subscription_payments
    WHERE user_id = ? AND paid_on >= ? AND amount IS NOT NULL
    GROUP BY currency
  `).all(userId, `${today.slice(0, 4)}-01-01`);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    generated_at: new Date().toISOString(),
    today,
    tasks: {
      total: active.length,
      pending: active.filter((task) => !task.completed).length,
      completed: active.filter((task) => task.completed).length,
      archived: tasks.filter((task) => task.archived).length,
      overdue,
      completed_last_7_days: countCompletedSince(weekAgo),
      completed_last_30_days: countCompletedSince(monthAgo),
      daily_completed: dailyCompleted,
      quadrants,
    },
    subscriptions: {
      total: subscriptions.length,
      totals: summarize(subscriptions),
      by_category: [...byCategory.values()].sort((a, b) => b.monthly - a.monthly),
      upcoming_30_days: upcoming,
      paid_this_year: paymentsThisYear,
    },
  });
});

module.exports = router;
