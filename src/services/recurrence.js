// คำนวณกำหนดส่งครั้งถัดไปของงานที่ตั้งเป็นงานประจำ
const APP_TIME_ZONE = 'Asia/Bangkok';

const RECUR_RULES = ['', 'daily', 'weekly', 'monthly', 'yearly'];
const RECUR_LABELS = {
  daily: 'ทุกวัน',
  weekly: 'ทุกสัปดาห์',
  monthly: 'ทุกเดือน',
  yearly: 'ทุกปี',
};
const MAX_ADVANCE_STEPS = 600;

// ระยะห่างระหว่างเวลาท้องถิ่นของแอปกับ UTC ณ เวลาที่กำหนด
function zoneOffsetMs(utcMs) {
  const asUtcParts = new Date(new Date(utcMs).toLocaleString('sv-SE', { timeZone: APP_TIME_ZONE }) + 'Z');
  return asUtcParts.getTime() - Math.floor(utcMs / 1000) * 1000;
}

function zonedParts(date) {
  const [datePart, timePart] = date
    .toLocaleString('sv-SE', { timeZone: APP_TIME_ZONE })
    .split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  return { year, month, day, hour, minute, second, ms: date.getTime() % 1000 };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function zonedToDate(parts) {
  const day = Math.min(parts.day, daysInMonth(parts.year, parts.month));
  const naive = Date.UTC(parts.year, parts.month - 1, day, parts.hour, parts.minute, parts.second, parts.ms);
  const offset = zoneOffsetMs(naive - zoneOffsetMs(naive));
  return new Date(naive - offset);
}

function advanceOnce(parts, rule, interval) {
  const next = { ...parts };
  if (rule === 'daily') next.day += interval;
  else if (rule === 'weekly') next.day += interval * 7;
  else if (rule === 'monthly') {
    const total = (next.year * 12) + (next.month - 1) + interval;
    next.year = Math.floor(total / 12);
    next.month = (total % 12) + 1;
  } else if (rule === 'yearly') next.year += interval;

  if (rule === 'daily' || rule === 'weekly') {
    // ปล่อยให้ Date จัดการวันข้ามเดือน/ข้ามปีเอง แล้วอ่านค่าท้องถิ่นกลับมา
    const shifted = new Date(Date.UTC(next.year, next.month - 1, next.day));
    next.year = shifted.getUTCFullYear();
    next.month = shifted.getUTCMonth() + 1;
    next.day = shifted.getUTCDate();
  }
  return next;
}

// เลื่อนกำหนดส่งไปข้างหน้าจนกว่าจะเลยเวลาปัจจุบัน เพื่อไม่ให้งานประจำที่ทำช้าไปโผล่ในอดีต
function nextDueDate(dueDate, rule, interval = 1, now = new Date()) {
  if (!dueDate || !RECUR_LABELS[rule]) return null;
  const start = new Date(dueDate);
  if (Number.isNaN(start.getTime())) return null;
  const step = Number.isInteger(interval) && interval > 0 ? interval : 1;

  let parts = zonedParts(start);
  let next = start;
  for (let i = 0; i < MAX_ADVANCE_STEPS; i += 1) {
    parts = advanceOnce(parts, rule, step);
    next = zonedToDate(parts);
    if (next.getTime() > now.getTime()) return next.toISOString();
  }
  return next.toISOString();
}

module.exports = { nextDueDate, RECUR_RULES, RECUR_LABELS, APP_TIME_ZONE };
