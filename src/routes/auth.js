const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const config = require('../config');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  ValidationError,
  assertPlainObject,
  stringValue,
  booleanValue,
  passwordValue,
} = require('../validation');

const router = express.Router();
const REMEMBER_DEVICE_MS = 30 * 24 * 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH = '$2a$10$7EqJtq98hPqEX7fNZaFWoO5nI8UjYr1gJ7mT2QK7QxHq5D3uS7n2K';
const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;
const allowedGoogleEmails = new Set(
  config.googleAllowedEmails
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

function makeLimiter(limit, message, windowMs = 15 * 60 * 1000) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
}

const loginLimiter = makeLimiter(20, 'ลองเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่');
const googleLoginLimiter = makeLimiter(20, 'ลองเข้าสู่ระบบด้วย Google หลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่');
const setupLimiter = makeLimiter(5, 'ลองตั้งค่าระบบหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่', 60 * 60 * 1000);

function wantsRememberDevice(value) {
  return value === true;
}

function sessionUsername(user) {
  return user.display_name || user.username;
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    return req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function establishSession(req, user, rememberDevice) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenerateError) => {
      if (regenerateError) return reject(regenerateError);

      req.session.userId = user.id;
      req.session.username = sessionUsername(user);
      req.session.sessionVersion = Number(user.session_version) || 0;
      req.session.cookie.maxAge = rememberDevice ? REMEMBER_DEVICE_MS : null;
      return req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  });
}

function publicAuthError(res, error, fallbackMessage) {
  if (error && error.statusCode) {
    return res.status(error.statusCode).json({ error: error.publicMessage || fallbackMessage });
  }
  console.error('[auth]', error);
  return res.status(500).json({ error: fallbackMessage });
}

function authError(statusCode, publicMessage) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.publicMessage = publicMessage;
  return error;
}

function safeTokenEqual(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function assertSetupToken(body) {
  if (!config.setupToken) {
    if (config.isProduction) {
      throw authError(503, 'ยังไม่ได้กำหนด SETUP_TOKEN บนเซิร์ฟเวอร์');
    }
    return;
  }
  if (!safeTokenEqual(config.setupToken, body.setup_token)) {
    throw authError(403, 'รหัสตั้งค่าครั้งแรกไม่ถูกต้อง');
  }
}

function assertGoogleCsrf(req) {
  const expected = req.session && req.session.googleCsrfToken;
  const actual = req.body && req.body.csrf_token;
  if (!safeTokenEqual(expected, actual)) {
    throw authError(403, 'คำขอ Google Login หมดอายุหรือไม่ผ่านการตรวจสอบ กรุณาลองใหม่');
  }
}

async function verifyGoogleCredential(credential) {
  if (!googleClient || !config.googleClientId) {
    throw authError(503, 'Google Login ยังไม่ได้ตั้งค่า Client ID');
  }
  if (typeof credential !== 'string' || credential.length < 100 || credential.length > 10000) {
    throw authError(400, 'ข้อมูลยืนยันตัวตนจาก Google ไม่ถูกต้อง');
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: config.googleClientId,
    });
    payload = ticket.getPayload();
  } catch (error) {
    console.warn('[auth] Google ID token verification failed:', error.message);
    throw authError(401, 'Google Login ไม่สำเร็จ กรุณาลองใหม่');
  }

  if (!payload || !payload.sub || !payload.email || payload.email_verified !== true) {
    throw authError(401, 'บัญชี Google นี้ไม่มีอีเมลที่ยืนยันแล้ว');
  }

  const email = payload.email.trim().toLowerCase();
  if (allowedGoogleEmails.size > 0 && !allowedGoogleEmails.has(email)) {
    throw authError(403, 'บัญชี Google นี้ไม่ได้รับอนุญาตให้ใช้ระบบ');
  }

  return {
    sub: String(payload.sub).slice(0, 255),
    email: email.slice(0, 320),
    name: String(payload.name || email.split('@')[0]).trim().slice(0, 120),
    picture: typeof payload.picture === 'string' ? payload.picture.slice(0, 500) : '',
  };
}

function uniqueGoogleUsername(profile) {
  let base = profile.email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  if (base.length < 3) base = `google-${profile.sub.slice(0, 8)}`;

  let candidate = base;
  let suffix = 2;
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?');
  while (exists.get(candidate)) {
    candidate = `${base.slice(0, 20)}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function createGoogleUser(profile) {
  const unusablePasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  const create = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(profile.sub);
    if (existing) return existing;

    const username = uniqueGoogleUsername(profile);
    const info = db.prepare(`
      INSERT INTO users (username, password_hash, email, google_sub, display_name, avatar_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(username, unusablePasswordHash, profile.email, profile.sub, profile.name, profile.picture);
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(info.lastInsertRowid);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  });
  return create.immediate();
}

router.get('/setup-status', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  res.json({
    needsSetup: count === 0,
    requiresSetupToken: count === 0 && Boolean(config.setupToken || config.isProduction),
  });
});

router.post('/setup', setupLimiter, async (req, res) => {
  try {
    const body = assertPlainObject(req.body);
    assertSetupToken(body);
    const username = stringValue(body.username, 'ชื่อผู้ใช้', { required: true, min: 3, max: 64 });
    const password = passwordValue(body.password);
    const hash = await bcrypt.hash(password, 12);

    const create = db.transaction(() => {
      const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
      if (count > 0) throw authError(403, 'ตั้งค่าระบบไปแล้ว กรุณาเข้าสู่ระบบตามปกติ');
      const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
      db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(info.lastInsertRowid);
      return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    });

    const user = create.immediate();
    await establishSession(req, user, false);
    return res.json({ ok: true });
  } catch (error) {
    return publicAuthError(res, error, 'สร้างบัญชีไม่สำเร็จ กรุณาลองใหม่');
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const body = assertPlainObject(req.body);
    const username = stringValue(body.username, 'ชื่อผู้ใช้', { required: true, min: 1, max: 64 });
    const password = passwordValue(body.password, 'รหัสผ่าน', { minChars: 1, minBytes: 1 });
    const rememberDevice = body.remember_device === undefined
      ? false
      : booleanValue(body.remember_device, 'การจดจำอุปกรณ์');

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
    if (!user || !passwordMatches) throw authError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');

    await establishSession(req, user, wantsRememberDevice(rememberDevice));
    return res.json({ ok: true });
  } catch (error) {
    return publicAuthError(res, error, 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
  }
});

router.get('/auth/google/config', (req, res) => {
  const enabled = Boolean(config.googleClientId);
  let linked = false;
  let email = '';

  if (req.session && req.session.userId) {
    const user = db.prepare('SELECT google_sub, email FROM users WHERE id = ?').get(req.session.userId);
    linked = Boolean(user && user.google_sub);
    email = user && user.email ? user.email : '';
  }

  if (enabled) req.session.googleCsrfToken = crypto.randomBytes(32).toString('base64url');
  res.json({
    enabled,
    clientId: enabled ? config.googleClientId : null,
    csrfToken: enabled ? req.session.googleCsrfToken : null,
    linked,
    email,
  });
});

router.post('/auth/google', googleLoginLimiter, async (req, res) => {
  try {
    const body = assertPlainObject(req.body);
    assertGoogleCsrf(req);
    const profile = await verifyGoogleCredential(body.credential);
    let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(profile.sub);

    if (!user) {
      const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
      if (userCount === 0 && allowedGoogleEmails.size === 0 && !config.googleAllowFirstUser) {
        throw authError(403, 'ยังไม่อนุญาตให้ Google สร้างผู้ใช้คนแรก กรุณาตั้งค่าบัญชีหลักก่อน');
      }
      if (userCount > 0 && allowedGoogleEmails.size === 0) {
        throw authError(403, 'บัญชี Google นี้ยังไม่ได้เชื่อม กรุณาเข้าสู่ระบบด้วยรหัสผ่านแล้วเชื่อมในหน้าตั้งค่า');
      }
      user = await createGoogleUser(profile);
    } else {
      db.prepare(`
        UPDATE users SET email = ?, display_name = ?, avatar_url = ? WHERE id = ?
      `).run(profile.email, profile.name, profile.picture, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }

    const rememberDevice = body.remember_device === undefined
      ? false
      : booleanValue(body.remember_device, 'การจดจำอุปกรณ์');
    await establishSession(req, user, wantsRememberDevice(rememberDevice));
    return res.json({ ok: true, username: sessionUsername(user) });
  } catch (error) {
    return publicAuthError(res, error, 'Google Login ไม่สำเร็จ กรุณาลองใหม่');
  }
});

router.post('/auth/google/link', googleLoginLimiter, requireAuth, async (req, res) => {
  try {
    const body = assertPlainObject(req.body);
    assertGoogleCsrf(req);
    const profile = await verifyGoogleCredential(body.credential);
    const linkedUser = db.prepare('SELECT id FROM users WHERE google_sub = ?').get(profile.sub);
    if (linkedUser && linkedUser.id !== req.session.userId) {
      throw authError(409, 'บัญชี Google นี้เชื่อมกับผู้ใช้อื่นอยู่แล้ว');
    }

    db.prepare(`
      UPDATE users SET google_sub = ?, email = ?, display_name = ?, avatar_url = ? WHERE id = ?
    `).run(profile.sub, profile.email, profile.name, profile.picture, req.session.userId);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    req.session.username = sessionUsername(user);
    delete req.session.googleCsrfToken;
    await saveSession(req);
    return res.json({ ok: true, username: sessionUsername(user), email: profile.email });
  } catch (error) {
    return publicAuthError(res, error, 'เชื่อมบัญชี Google ไม่สำเร็จ กรุณาลองใหม่');
  }
});

router.post('/logout', async (req, res) => {
  try {
    await destroySession(req);
    res.clearCookie(config.sessionCookieName, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      path: '/',
    });
    return res.json({ ok: true });
  } catch (error) {
    return publicAuthError(res, error, 'ออกจากระบบไม่สำเร็จ กรุณาลองใหม่');
  }
});

router.get('/session', async (req, res) => {
  if (!req.session || !req.session.userId) return res.json({ authenticated: false });
  const user = db.prepare(`
    SELECT username, display_name, email, google_sub, session_version FROM users WHERE id = ?
  `).get(req.session.userId);

  if (!user || Number(user.session_version) !== Number(req.session.sessionVersion || 0)) {
    try { await destroySession(req); } catch { /* session หมดอายุอยู่แล้ว */ }
    return res.json({ authenticated: false });
  }

  return res.json({
    authenticated: true,
    username: sessionUsername(user),
    email: user.email || '',
    googleLinked: Boolean(user.google_sub),
  });
});

module.exports = router;
