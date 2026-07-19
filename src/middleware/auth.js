const db = require('../db');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });
  }

  const user = db.prepare('SELECT session_version FROM users WHERE id = ?').get(req.session.userId);
  if (!user || Number(user.session_version) !== Number(req.session.sessionVersion || 0)) {
    return req.session.destroy(() => res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' }));
  }
  return next();
}

module.exports = { requireAuth };
