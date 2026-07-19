const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  assertPlainObject,
  stringValue,
  positiveId,
  ValidationError,
} = require('../validation');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const requestedLimit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
    throw new ValidationError('limit ต้องเป็นจำนวนเต็มระหว่าง 1 ถึง 100');
  }

  let before = null;
  if (req.query.before !== undefined) before = positiveId(req.query.before, 'cursor');
  const rows = before
    ? db.prepare(`
      SELECT * FROM notes WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT ?
    `).all(req.session.userId, before, requestedLimit + 1)
    : db.prepare(`
      SELECT * FROM notes WHERE user_id = ? ORDER BY id DESC LIMIT ?
    `).all(req.session.userId, requestedLimit + 1);

  const hasMore = rows.length > requestedLimit;
  const items = hasMore ? rows.slice(0, requestedLimit) : rows;
  const totalCount = db.prepare('SELECT COUNT(*) AS count FROM notes WHERE user_id = ?')
    .get(req.session.userId).count;
  res.json({
    items,
    nextCursor: hasMore ? items[items.length - 1].id : null,
    totalCount,
  });
});

router.post('/', (req, res) => {
  const body = assertPlainObject(req.body);
  const content = stringValue(body.content, 'ข้อความ', { required: true, min: 1, max: 5000 });
  const info = db.prepare('INSERT INTO notes (user_id, content) VALUES (?, ?)')
    .run(req.session.userId, content);
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(note);
});

router.delete('/:id', (req, res) => {
  const id = positiveId(req.params.id, 'รหัสบันทึก');
  const result = db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(id, req.session.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'ไม่พบบันทึกนี้' });
  return res.json({ ok: true });
});

module.exports = router;
