const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  assertPlainObject,
  stringValue,
  booleanValue,
  integerValue,
  positiveId,
  isoDateValue,
  ValidationError,
} = require('../validation');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const tasks = db.prepare(`
    SELECT * FROM tasks WHERE user_id = ? AND archived = 0 ORDER BY quadrant, position, id
  `).all(req.session.userId);
  res.json(tasks);
});

router.get('/archived', (req, res) => {
  const tasks = db.prepare(`
    SELECT * FROM tasks WHERE user_id = ? AND archived = 1 ORDER BY updated_at DESC, id DESC
  `).all(req.session.userId);
  res.json(tasks);
});

router.post('/', (req, res) => {
  const body = assertPlainObject(req.body);
  const title = stringValue(body.title, 'ชื่องาน', { required: true, min: 1, max: 200 });
  const description = stringValue(body.description, 'รายละเอียด', { max: 5000 }) ?? '';
  const quadrant = integerValue(body.quadrant, 'หมวดหมู่', { allowed: [1, 2, 3, 4] });
  const dueDate = isoDateValue(body.due_date, 'กำหนดวันที่', { optional: true }) ?? null;

  const create = db.transaction(() => {
    const maxPos = db.prepare(`
      SELECT COALESCE(MAX(position), 0) AS max_position
      FROM tasks WHERE user_id = ? AND quadrant = ?
    `).get(req.session.userId, quadrant).max_position;
    const info = db.prepare(`
      INSERT INTO tasks (user_id, title, description, quadrant, due_date, position)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.session.userId, title, description, quadrant, dueDate, maxPos + 1);
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  });

  res.status(201).json(create.immediate());
});

router.put('/:id', (req, res) => {
  const id = positiveId(req.params.id, 'รหัสงาน');
  const body = assertPlainObject(req.body);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, req.session.userId);
  if (!task) return res.status(404).json({ error: 'ไม่พบงานนี้' });

  const allowedFields = ['title', 'description', 'quadrant', 'due_date', 'completed', 'position', 'archived'];
  if (!allowedFields.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
    throw new ValidationError('ไม่มีข้อมูลที่ต้องการแก้ไข');
  }

  const title = body.title === undefined
    ? undefined
    : stringValue(body.title, 'ชื่องาน', { required: true, min: 1, max: 200 });
  const description = stringValue(body.description, 'รายละเอียด', { max: 5000 });
  const quadrant = integerValue(body.quadrant, 'หมวดหมู่', { optional: true, allowed: [1, 2, 3, 4] });
  const dueDate = isoDateValue(body.due_date, 'กำหนดวันที่', { optional: true });
  const completed = booleanValue(body.completed, 'สถานะเสร็จสิ้น', { optional: true });
  const position = integerValue(body.position, 'ลำดับงาน', { optional: true, min: 0, max: 1000000 });
  const archived = booleanValue(body.archived, 'สถานะเก็บถาวร', { optional: true });

  const newTitle = title ?? task.title;
  const newDescription = description ?? task.description;
  const newQuadrant = quadrant ?? task.quadrant;
  const newDueDate = dueDate === undefined ? task.due_date : dueDate;
  const newCompleted = completed === undefined ? task.completed : (completed ? 1 : 0);
  const newPosition = position ?? task.position;
  const newArchived = archived === undefined ? task.archived : (archived ? 1 : 0);
  const dueChanged = dueDate !== undefined && newDueDate !== task.due_date;
  const taskReopened = task.completed === 1 && newCompleted === 0;
  const resetNotification = dueChanged || taskReopened;

  db.prepare(`
    UPDATE tasks SET
      title = ?, description = ?, quadrant = ?, due_date = ?, completed = ?, position = ?, archived = ?,
      notified = ?, notification_claimed_at = NULL, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(
    newTitle,
    newDescription,
    newQuadrant,
    newDueDate,
    newCompleted,
    newPosition,
    newArchived,
    resetNotification ? 0 : task.notified,
    id,
    req.session.userId,
  );

  return res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
});

router.delete('/:id', (req, res) => {
  const id = positiveId(req.params.id, 'รหัสงาน');
  const result = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(id, req.session.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'ไม่พบงานนี้' });
  return res.json({ ok: true });
});

module.exports = router;
