const session = require('express-session');
const db = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
`);

const getStmt = db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?');
const upsertStmt = db.prepare(`
  INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
  ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires
`);
const deleteStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
const touchStmt = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ? AND expires < ?');
const clearExpiredStmt = db.prepare('DELETE FROM sessions WHERE expires < ?');

class SqliteSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const row = getStmt.get(sid);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) {
        deleteStmt.run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sessionData, cb) {
    try {
      const maxAge = sessionData.cookie && sessionData.cookie.maxAge ? sessionData.cookie.maxAge : 86400000;
      const expires = Date.now() + maxAge;
      upsertStmt.run(sid, JSON.stringify(sessionData), expires);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      deleteStmt.run(sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sessionData, cb) {
    try {
      const maxAge = sessionData.cookie && sessionData.cookie.maxAge ? sessionData.cookie.maxAge : 86400000;
      const nextExpiry = Date.now() + maxAge;
      // ลด synchronous writes: ต่ออายุในฐานข้อมูลไม่เกินหนึ่งครั้งต่อ 15 นาที
      touchStmt.run(nextExpiry, sid, nextExpiry - (15 * 60 * 1000));
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }
}

// เก็บกวาด session ที่หมดอายุทุกชั่วโมง
const cleanupTimer = setInterval(() => {
  try { clearExpiredStmt.run(Date.now()); } catch { /* ignore */ }
}, 60 * 60 * 1000);
cleanupTimer.unref();

module.exports = SqliteSessionStore;
