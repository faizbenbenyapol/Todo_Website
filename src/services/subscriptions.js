// ตรรกะร่วมของ Subscription: รอบบิล การรวมยอด และการอ่านราคาแบบข้อความเดิม
const BILLING_CYCLES = ['monthly', 'quarterly', 'yearly', 'weekly', 'one_time'];

const CYCLE_LABELS = {
  weekly: 'ต่อสัปดาห์',
  monthly: 'ต่อเดือน',
  quarterly: 'ต่อไตรมาส',
  yearly: 'ต่อปี',
  one_time: 'จ่ายครั้งเดียว',
};

// ตัวคูณสำหรับเทียบทุกอย่างให้เป็นยอดต่อเดือนและต่อปี — จ่ายครั้งเดียวไม่นับเป็นค่าใช้จ่ายประจำ
const MONTHLY_FACTOR = {
  weekly: 52 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
  one_time: 0,
};

const YEARLY_FACTOR = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
  one_time: 0,
};

const CURRENCY_SIGNS = [
  [/฿|บาท|THB/i, 'THB'],
  [/\$|USD|ดอลลาร์/i, 'USD'],
  [/€|EUR|ยูโร/i, 'EUR'],
  [/£|GBP|ปอนด์/i, 'GBP'],
  [/¥|JPY|เยน/i, 'JPY'],
  [/SGD/i, 'SGD'],
  [/CNY|หยวน/i, 'CNY'],
];

const CYCLE_PATTERNS = [
  [/ไตรมาส|quarter|ราย\s*3\s*เดือน|ทุก\s*3\s*เดือน/i, 'quarterly'],
  [/ปี|year|yr|annual/i, 'yearly'],
  [/สัปดาห์|อาทิตย์|week|wk/i, 'weekly'],
  [/เดือน|month|\bmo\b/i, 'monthly'],
];

// อ่านราคาที่เคยเก็บเป็นข้อความอิสระ เช่น "419 บาท/เดือน" ให้กลายเป็นตัวเลขที่รวมยอดได้
function parseLegacyPrice(text) {
  const source = String(text || '').trim();
  if (!source) return null;

  const numberMatch = source.replace(/\s/g, '').match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!numberMatch) return null;
  const amount = Number(numberMatch[1].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount < 0) return null;

  let currency = 'THB';
  for (const [pattern, code] of CURRENCY_SIGNS) {
    if (pattern.test(source)) {
      currency = code;
      break;
    }
  }

  let billingCycle = 'monthly';
  for (const [pattern, cycle] of CYCLE_PATTERNS) {
    if (pattern.test(source)) {
      billingCycle = cycle;
      break;
    }
  }

  return { amount, currency, billingCycle };
}

const CYCLE_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toDateText(year, month, day) {
  const safeDay = Math.min(day, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

// เลื่อนวันต่ออายุไปรอบถัดไป และข้ามรอบที่เลยมาแล้วให้หมด เผื่อกดยืนยันย้อนหลังหลายรอบ
function nextRenewalDate(renewalDate, billingCycle, today) {
  if (billingCycle === 'one_time') return null;
  const match = String(renewalDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  // ยึดวันที่ของรอบแรกไว้ เพื่อให้เดือนที่สั้นกว่าไม่ทำให้วันต่ออายุร่นถาวร (31 ม.ค. → 28 ก.พ. → 31 มี.ค.)
  const anchorDay = Number(match[3]);
  let year = Number(match[1]);
  let month = Number(match[2]);
  let current = renewalDate;

  for (let step = 0; step < 600; step += 1) {
    if (billingCycle === 'weekly') {
      const [currentYear, currentMonth, currentDay] = current.split('-').map(Number);
      const base = new Date(Date.UTC(currentYear, currentMonth - 1, currentDay));
      base.setUTCDate(base.getUTCDate() + 7);
      current = base.toISOString().slice(0, 10);
    } else {
      const months = CYCLE_MONTHS[billingCycle] ?? 1;
      const total = (year * 12) + (month - 1) + months;
      year = Math.floor(total / 12);
      month = (total % 12) + 1;
      current = toDateText(year, month, anchorDay);
    }
    if (current > today) return current;
  }
  return current;
}

// null/undefined/'' แปลงเป็น 0 ได้ด้วย Number() จึงต้องคัดออกก่อน ไม่งั้นรายการที่ไม่ได้ใส่ราคาจะถูกนับเป็นศูนย์บาท
function hasAmount(subscription) {
  const amount = subscription.amount;
  if (amount === null || amount === undefined || amount === '') return false;
  return Number.isFinite(Number(amount));
}

function monthlyAmount(subscription) {
  if (!hasAmount(subscription)) return 0;
  return Number(subscription.amount) * (MONTHLY_FACTOR[subscription.billing_cycle] ?? 0);
}

function yearlyAmount(subscription) {
  if (!hasAmount(subscription)) return 0;
  return Number(subscription.amount) * (YEARLY_FACTOR[subscription.billing_cycle] ?? 0);
}

// รวมยอดแยกตามสกุลเงิน เพราะระบบไม่แปลงค่าเงินให้เอง
function summarize(subscriptions) {
  const totals = new Map();
  for (const subscription of subscriptions) {
    if (!hasAmount(subscription)) continue;
    const currency = subscription.currency || 'THB';
    if (!totals.has(currency)) totals.set(currency, { currency, monthly: 0, yearly: 0, count: 0 });
    const entry = totals.get(currency);
    entry.monthly += monthlyAmount(subscription);
    entry.yearly += yearlyAmount(subscription);
    entry.count += 1;
  }
  return [...totals.values()].sort((a, b) => b.yearly - a.yearly);
}

function formatMoney(amount, currency = 'THB', locale = 'th-TH') {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString(locale)} ${currency}`;
  }
}

// ข้อความราคาสำหรับแสดงผล โดยยังรองรับรายการเก่าที่มีแต่ข้อความราคาอิสระ
function priceLabel(subscription) {
  if (hasAmount(subscription)) {
    const money = formatMoney(subscription.amount, subscription.currency || 'THB');
    const cycle = CYCLE_LABELS[subscription.billing_cycle] || '';
    return cycle ? `${money} ${cycle}` : money;
  }
  return subscription.price || '';
}

module.exports = {
  BILLING_CYCLES,
  CYCLE_LABELS,
  MONTHLY_FACTOR,
  YEARLY_FACTOR,
  parseLegacyPrice,
  nextRenewalDate,
  hasAmount,
  monthlyAmount,
  yearlyAmount,
  summarize,
  formatMoney,
  priceLabel,
};
