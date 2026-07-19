const path = require('path');

function envBoolean(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

const isProduction = process.env.NODE_ENV === 'production';
const port = process.env.PORT === undefined || process.env.PORT === ''
  ? 3000
  : Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT ต้องเป็นจำนวนเต็มระหว่าง 1 ถึง 65535');
}

const sessionSecret = String(process.env.SESSION_SECRET || '');
const weakSessionSecrets = new Set(['dev-secret-change-me', 'please-change-this-secret', 'change-this-to-a-long-random-string']);

if (!sessionSecret) {
  throw new Error('กรุณากำหนด SESSION_SECRET ในไฟล์ .env ก่อนเปิดเซิร์ฟเวอร์');
}
if (Buffer.byteLength(sessionSecret, 'utf8') < 32 || weakSessionSecrets.has(sessionSecret)) {
  throw new Error('SESSION_SECRET ต้องเป็นค่าสุ่มที่คาดเดายากและยาวอย่างน้อย 32 ไบต์');
}

const appEncryptionSecret = String(process.env.APP_ENCRYPTION_KEY || '');
if (isProduction && Buffer.byteLength(appEncryptionSecret, 'utf8') < 32) {
  throw new Error('production ต้องกำหนด APP_ENCRYPTION_KEY เป็นค่าสุ่มอย่างน้อย 32 ไบต์');
}
if (isProduction && appEncryptionSecret === sessionSecret) {
  throw new Error('APP_ENCRYPTION_KEY ต้องเป็นคนละค่ากับ SESSION_SECRET');
}

const setupToken = String(process.env.SETUP_TOKEN || '');
if (isProduction && setupToken && Buffer.byteLength(setupToken, 'utf8') < 32) {
  throw new Error('SETUP_TOKEN ใน production ต้องเป็นค่าสุ่มอย่างน้อย 32 ไบต์ หรือเว้นว่างหลังตั้งค่าระบบแล้ว');
}

const cookieSecure = envBoolean('COOKIE_SECURE', false);
const warnings = [];
if (!appEncryptionSecret) {
  warnings.push('ยังไม่ได้กำหนด APP_ENCRYPTION_KEY: โหมดพัฒนาจะใช้ key ที่แยกจาก SESSION_SECRET ด้วย KDF ชั่วคราว');
}
if (isProduction && !cookieSecure) {
  warnings.push('COOKIE_SECURE=false ใน production: ควรเปิด HTTPS และตั้งค่าเป็น true');
}

module.exports = {
  port,
  isProduction,
  trustProxy: envBoolean('TRUST_PROXY', false),
  cookieSecure,
  sessionSecret,
  sessionCookieName: 'eb.sid',
  appEncryptionSecret: appEncryptionSecret || `${sessionSecret}:telegram-settings:v1`,
  hasAppEncryptionKey: Boolean(appEncryptionSecret),
  setupToken,
  googleClientId: String(process.env.GOOGLE_CLIENT_ID || '').trim(),
  googleAllowedEmails: String(process.env.GOOGLE_ALLOWED_EMAILS || ''),
  googleAllowFirstUser: envBoolean('GOOGLE_ALLOW_FIRST_USER', false),
  dataDir: process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', 'data'),
  warnings,
};
