const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendTelegramMessage } = require('../services/telegram');
const {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
  needsSecretReencryption,
} = require('../services/secrets');
const {
  assertPlainObject,
  stringValue,
  booleanValue,
  integerValue,
  timeValue,
  passwordValue,
} = require('../validation');

const router = express.Router();
router.use(requireAuth);

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'ลองเปลี่ยนรหัสผ่านหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่' },
});

function ensureSettings(userId) {
  db.prepare('INSERT OR IGNORE INTO settings (user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
}

function readTelegramToken(settings) {
  const token = decryptSecret(settings.telegram_bot_token);
  if (token && needsSecretReencryption(settings.telegram_bot_token)) {
    db.prepare('UPDATE settings SET telegram_bot_token = ? WHERE user_id = ?')
      .run(encryptSecret(token), settings.user_id);
  }
  return token;
}

function publicSettings(settings) {
  const token = readTelegramToken(settings);
  return {
    ...settings,
    telegram_bot_token: '',
    telegram_bot_configured: Boolean(token),
    daily_summary_enabled: Boolean(settings.daily_summary_enabled),
  };
}

router.get('/', (req, res) => {
  res.json(publicSettings(ensureSettings(req.session.userId)));
});

router.put('/', (req, res) => {
  const body = assertPlainObject(req.body);
  const current = ensureSettings(req.session.userId);
  const clearToken = body.clear_telegram_bot_token === undefined
    ? false
    : booleanValue(body.clear_telegram_bot_token, 'การลบ Telegram token');
  const newToken = stringValue(body.telegram_bot_token, 'Telegram Bot Token', { max: 500 });
  if (clearToken && newToken) {
    return res.status(400).json({ error: 'ไม่สามารถเพิ่มและลบ Telegram token ในคำขอเดียวกันได้' });
  }

  let storedToken = current.telegram_bot_token || '';
  if (clearToken) storedToken = '';
  else if (newToken) storedToken = encryptSecret(newToken);
  else if (storedToken && !isEncryptedSecret(storedToken)) storedToken = encryptSecret(storedToken);

  const chatId = stringValue(body.telegram_chat_id, 'Telegram Chat ID', { max: 100 });
  const notifyMinutes = integerValue(body.notify_before_minutes, 'เวลาแจ้งเตือนล่วงหน้า', {
    optional: true,
    allowed: [15, 30, 60, 180, 1440],
  });
  const dailyEnabled = booleanValue(body.daily_summary_enabled, 'สรุปงานประจำวัน', { optional: true });
  const dailyTime = body.daily_summary_time === undefined
    ? undefined
    : timeValue(body.daily_summary_time, 'เวลาส่งสรุป');

  db.prepare(`
    INSERT INTO settings (
      user_id, telegram_bot_token, telegram_chat_id,
      notify_before_minutes, daily_summary_enabled, daily_summary_time
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      telegram_bot_token = excluded.telegram_bot_token,
      telegram_chat_id = excluded.telegram_chat_id,
      notify_before_minutes = excluded.notify_before_minutes,
      daily_summary_enabled = excluded.daily_summary_enabled,
      daily_summary_time = excluded.daily_summary_time
  `).run(
    req.session.userId,
    storedToken,
    chatId === undefined ? current.telegram_chat_id : chatId,
    notifyMinutes === undefined ? current.notify_before_minutes : notifyMinutes,
    dailyEnabled === undefined ? current.daily_summary_enabled : (dailyEnabled ? 1 : 0),
    dailyTime === undefined ? current.daily_summary_time : dailyTime,
  );

  return res.json(publicSettings(ensureSettings(req.session.userId)));
});

router.post('/test-telegram', async (req, res) => {
  try {
    const settings = ensureSettings(req.session.userId);
    const result = await sendTelegramMessage(
      readTelegramToken(settings),
      settings.telegram_chat_id,
      '✅ ทดสอบการเชื่อมต่อสำเร็จ! บอทของคุณพร้อมส่งแจ้งเตือนแล้ว',
    );
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[settings] Telegram test failed:', error);
    return res.status(500).json({ error: 'ทดสอบ Telegram ไม่สำเร็จ' });
  }
});

router.put('/password', passwordLimiter, async (req, res) => {
  try {
    const body = assertPlainObject(req.body);
    const currentPassword = passwordValue(body.current_password, 'รหัสผ่านปัจจุบัน', { minChars: 1, minBytes: 1 });
    const newPassword = passwordValue(body.new_password, 'รหัสผ่านใหม่');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) return res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });

    if (!await bcrypt.compare(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    }
    if (await bcrypt.compare(newPassword, user.password_hash)) {
      return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน' });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    db.prepare(`
      UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?
    `).run(hash, user.id);
    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    const rememberDevice = Boolean(req.session.cookie && req.session.cookie.originalMaxAge);

    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => {
        if (error) return reject(error);
        req.session.userId = updatedUser.id;
        req.session.username = updatedUser.display_name || updatedUser.username;
        req.session.sessionVersion = updatedUser.session_version;
        req.session.cookie.maxAge = rememberDevice ? 30 * 24 * 60 * 60 * 1000 : null;
        return req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
      });
    });
    return res.json({ ok: true });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.publicMessage });
    console.error('[settings] password change failed:', error);
    return res.status(500).json({ error: 'เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่' });
  }
});

module.exports = router;
