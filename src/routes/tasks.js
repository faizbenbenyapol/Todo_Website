const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  tagsValue,
  subtasksValue,
  recurRuleValue,
  withDetails,
  replaceSubtasks,
  nextPosition,
  insertTaskRow,
  spawnNextOccurrence,
} = require('../services/tasks');
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
  res.json(withDetails(tasks));
});

router.get('/archived', (req, res) => {
  const tasks = db.prepare(`
    SELECT * FROM tasks WHERE user_id = ? AND archived = 1 ORDER BY updated_at DESC, id DESC
  `).all(req.session.userId);
  res.json(withDetails(tasks));
});

// ลากวางทีเดียวขยับได้หลายงาน จึงบันทึกลำดับใหม่ทั้งชุดในธุรกรรมเดียว แทนที่จะยิงทีละคำขอ
router.put('/reorder', (req, res) => {
  const body = assertPlainObject(req.body);
  if (!Array.isArray(body.items)) throw new ValidationError('รูปแบบลำดับงานไม่ถูกต้อง');
  if (body.items.length > 500) throw new ValidationError('จัดลำดับได้ครั้งละไม่เกิน 500 งาน');

  const items = body.items.map((item) => {
    const entry = assertPlainObject(item, 'รูปแบบลำดับงานไม่ถูกต้อง');
    return {
      id: positiveId(entry.id, 'รหัสงาน'),
      quadrant: integerValue(entry.quadrant, 'หมวดหมู่', { allowed: [1, 2, 3, 4] }),
      position: integerValue(entry.position, 'ลำดับงาน', { min: 0, max: 1000000 }),
    };
  });

  const owned = new Set(
    db.prepare('SELECT id FROM tasks WHERE user_id = ? AND archived = 0').all(req.session.userId)
      .map((row) => row.id),
  );
  const missing = items.find((item) => !owned.has(item.id));
  if (missing) return res.status(404).json({ error: 'ไม่พบงานบางรายการที่ต้องการจัดลำดับ' });

  const update = db.prepare(`
    UPDATE tasks SET quadrant = ?, position = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `);
  const reorder = db.transaction(() => {
    for (const item of items) update.run(item.quadrant, item.position, item.id, req.session.userId);
  });
  reorder.immediate();

  const tasks = db.prepare(`
    SELECT * FROM tasks WHERE user_id = ? AND archived = 0 ORDER BY quadrant, position, id
  `).all(req.session.userId);
  return res.json(withDetails(tasks));
});

router.post('/', (req, res) => {
  const body = assertPlainObject(req.body);
  const title = stringValue(body.title, 'ชื่องาน', { required: true, min: 1, max: 200 });
  const description = stringValue(body.description, 'รายละเอียด', { max: 5000 }) ?? '';
  const quadrant = integerValue(body.quadrant, 'หมวดหมู่', { allowed: [1, 2, 3, 4] });
  const dueDate = isoDateValue(body.due_date, 'กำหนดวันที่', { optional: true }) ?? null;
  const dueHasTime = booleanValue(body.due_has_time ?? false, 'การระบุเวลา') ? 1 : 0;
  const recurRule = recurRuleValue(body.recur_rule);
  const recurInterval = integerValue(body.recur_interval ?? 1, 'ความถี่งานประจำ', { min: 1, max: 365 });
  const tags = tagsValue(body.tags);
  const subtasks = subtasksValue(body.subtasks);

  if (recurRule && !dueDate) throw new ValidationError('งานประจำต้องระบุกำหนดวันที่ด้วย');

  const create = db.transaction(() => {
    const info = insertTaskRow({
      userId: req.session.userId,
      title,
      description,
      quadrant,
      dueDate,
      dueHasTime: dueDate ? dueHasTime : 0,
      recurRule,
      recurInterval,
      tags: JSON.stringify(tags),
      position: nextPosition(req.session.userId, quadrant),
    });
    replaceSubtasks(info.lastInsertRowid, req.session.userId, subtasks);
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  });

  res.status(201).json(withDetails(create.immediate()));
});

router.put('/:id', (req, res) => {
  const id = positiveId(req.params.id, 'รหัสงาน');
  const body = assertPlainObject(req.body);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, req.session.userId);
  if (!task) return res.status(404).json({ error: 'ไม่พบงานนี้' });

  const allowedFields = [
    'title', 'description', 'quadrant', 'due_date', 'due_has_time', 'completed',
    'position', 'archived', 'recur_rule', 'recur_interval', 'tags', 'subtasks',
  ];
  if (!allowedFields.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
    throw new ValidationError('ไม่มีข้อมูลที่ต้องการแก้ไข');
  }

  const title = body.title === undefined
    ? undefined
    : stringValue(body.title, 'ชื่องาน', { required: true, min: 1, max: 200 });
  const description = stringValue(body.description, 'รายละเอียด', { max: 5000 });
  const quadrant = integerValue(body.quadrant, 'หมวดหมู่', { optional: true, allowed: [1, 2, 3, 4] });
  const dueDate = isoDateValue(body.due_date, 'กำหนดวันที่', { optional: true });
  const dueHasTime = booleanValue(body.due_has_time, 'การระบุเวลา', { optional: true });
  const completed = booleanValue(body.completed, 'สถานะเสร็จสิ้น', { optional: true });
  const position = integerValue(body.position, 'ลำดับงาน', { optional: true, min: 0, max: 1000000 });
  const archived = booleanValue(body.archived, 'สถานะเก็บถาวร', { optional: true });
  const recurRule = recurRuleValue(body.recur_rule, { optional: true });
  const recurInterval = integerValue(body.recur_interval, 'ความถี่งานประจำ', { optional: true, min: 1, max: 365 });
  const tags = tagsValue(body.tags, { optional: true });
  const subtasks = subtasksValue(body.subtasks, { optional: true });

  const newTitle = title ?? task.title;
  const newDescription = description ?? task.description;
  const newQuadrant = quadrant ?? task.quadrant;
  const newDueDate = dueDate === undefined ? task.due_date : dueDate;
  const newCompleted = completed === undefined ? task.completed : (completed ? 1 : 0);
  const newPosition = position ?? task.position;
  const newArchived = archived === undefined ? task.archived : (archived ? 1 : 0);
  const newRecurRule = recurRule ?? task.recur_rule;
  const newRecurInterval = recurInterval ?? task.recur_interval;
  const newTags = tags === undefined ? task.tags : JSON.stringify(tags);
  const newDueHasTime = newDueDate
    ? (dueHasTime === undefined ? task.due_has_time : (dueHasTime ? 1 : 0))
    : 0;
  const dueChanged = dueDate !== undefined && newDueDate !== task.due_date;
  const taskReopened = task.completed === 1 && newCompleted === 0;
  const resetNotification = dueChanged || taskReopened;
  // เวลาที่ปิดงานต้องคงค่าเดิมไว้เมื่อแก้ไขเรื่องอื่น เพื่อให้สถิติย้อนหลังไม่ขยับตาม
  const newCompletedAt = newCompleted === 1
    ? (task.completed === 1 ? task.completed_at : new Date().toISOString())
    : null;

  if (newRecurRule && !newDueDate) throw new ValidationError('งานประจำต้องระบุกำหนดวันที่ด้วย');

  const update = db.transaction(() => {
    db.prepare(`
      UPDATE tasks SET
        title = ?, description = ?, quadrant = ?, due_date = ?, due_has_time = ?, completed = ?,
        completed_at = ?, position = ?, archived = ?, recur_rule = ?, recur_interval = ?, tags = ?,
        notified = ?, notification_claimed_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(
      newTitle,
      newDescription,
      newQuadrant,
      newDueDate,
      newDueHasTime,
      newCompleted,
      newCompletedAt,
      newPosition,
      newArchived,
      newRecurRule,
      newRecurInterval,
      newTags,
      resetNotification ? 0 : task.notified,
      id,
      req.session.userId,
    );
    if (subtasks !== undefined) replaceSubtasks(id, req.session.userId, subtasks);
  });
  update.immediate();

  const stored = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  const updated = withDetails(stored);
  const justCompleted = task.completed === 0 && newCompleted === 1;
  if (justCompleted && newRecurRule) {
    const next = spawnNextOccurrence(stored, req.session.userId);
    if (next) updated.next_task = next;
  }

  return res.json(updated);
});

router.delete('/:id', (req, res) => {
  const id = positiveId(req.params.id, 'รหัสงาน');
  const result = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(id, req.session.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'ไม่พบงานนี้' });
  return res.json({ ok: true });
});

module.exports = router;
