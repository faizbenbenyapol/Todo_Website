const crypto = require('crypto');
const config = require('../config');

const CURRENT_VERSION = config.hasAppEncryptionKey ? 'v2' : 'v1';
const CURRENT_PREFIX = `enc:${CURRENT_VERSION}:`;
const legacyKey = crypto.scryptSync(`${config.sessionSecret}:telegram-settings:v1`, 'eisenhower-board:telegram:v1', 32);
const currentKey = config.hasAppEncryptionKey
  ? crypto.scryptSync(config.appEncryptionSecret, 'eisenhower-board:telegram:v2', 32)
  : legacyKey;

function encryptSecret(value) {
  const plainText = String(value || '');
  if (!plainText) return '';
  if (plainText.startsWith(CURRENT_PREFIX)) return plainText;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', currentKey, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${CURRENT_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decryptSecret(value) {
  const stored = String(value || '');
  if (!stored || !stored.startsWith('enc:')) return stored;

  const match = stored.match(/^enc:(v[12]):([^:]+):([^:]+):([^:]+)$/);
  if (!match) throw new Error('รูปแบบข้อมูลลับที่เข้ารหัสไม่ถูกต้อง');
  const [, version, ivText, tagText, cipherText] = match;
  const decryptionKey = version === 'v1' ? legacyKey : currentKey;
  const decipher = crypto.createDecipheriv('aes-256-gcm', decryptionKey, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function isEncryptedSecret(value) {
  return /^enc:v[12]:/.test(String(value || ''));
}

function needsSecretReencryption(value) {
  const stored = String(value || '');
  return Boolean(stored) && !stored.startsWith(CURRENT_PREFIX);
}

module.exports = {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
  needsSecretReencryption,
};
