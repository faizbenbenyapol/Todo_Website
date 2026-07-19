const TELEGRAM_TIMEOUT_MS = 10000;

async function sendTelegramMessage(botToken, chatId, text) {
  const token = String(botToken || '').trim();
  const destination = String(chatId || '').trim();
  if (!token || !destination) {
    return { ok: false, error: 'ยังไม่ได้ตั้งค่า Telegram Bot Token หรือ Chat ID' };
  }
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
    return { ok: false, error: 'รูปแบบ Telegram Bot Token ไม่ถูกต้อง' };
  }
  if (!/^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/.test(destination)) {
    return { ok: false, error: 'รูปแบบ Telegram Chat ID ไม่ถูกต้อง' };
  }
  if (typeof text !== 'string' || text.length < 1 || text.length > 4096) {
    return { ok: false, error: 'ข้อความ Telegram ต้องยาวระหว่าง 1 ถึง 4096 ตัวอักษร' };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: destination,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });

    let data = null;
    try { data = await res.json(); } catch { /* Telegram อาจตอบข้อความที่ไม่ใช่ JSON */ }
    if (!res.ok || !data || !data.ok) {
      return { ok: false, error: (data && data.description) || `Telegram ตอบกลับ HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (error) {
    if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return { ok: false, error: 'เชื่อมต่อ Telegram หมดเวลา กรุณาลองใหม่' };
    }
    return { ok: false, error: 'เชื่อมต่อ Telegram ไม่ได้' };
  }
}

module.exports = { sendTelegramMessage };
