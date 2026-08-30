// ตรรกะร่วมของงาน: ตรวจข้อมูล แท็ก งานย่อย และการสร้างงานรอบถัดไปของงานประจำ
const db = require('../db');
const { nextDueDate, RECUR_RULES } = require('./recurrence');
const {
  assertPlainObject,
  stringValue,
  booleanValue,
  ValidationError,
} = require('../validation');

const MAX_TAGS = 10;
const MAX_SUBTASKS = 50;

function tagsValue(value, options = {}) {
  if (value === undefined) return options.optional ? undefined : [];
  if (!Array.isArray(value)) throw new ValidationError('แท็กต้องเป็นรายการข้อความ');
  if (value.length > MAX_TAGS) throw new ValidationError('ใส่แท็กได้ไม่เกิน ' + MAX_TAGS + ' รายการ');
  const tags = [];
  for (const item of value) {
    const tag = stringValue(item, 'แท็ก', { max: 30 });
    if (!tag) continue;
    if (!tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) tags.push(tag);
  }
  return tags;
}

function subtasksValue(value, options = {}) {
  if (value === undefined) return options.optional ? undefined : [];
  if (!Array.isArray(value)) throw new ValidationError('งานย่อยต้องเป็นรายการ');
  if (value.length > MAX_SUBTASKS) throw new ValidationError('ใส่งานย่อยได้ไม่เกิน ' + MAX_SUBTASKS + ' รายการ');
  return value.map((item) => {
    const entry = assertPlainObject(item, 'รูปแบบงานย่อยไม่ถูกต้อง');
    return {
      title: stringValue(entry.title, 'ชื่องานย่อย', { required: true, min: 1, max: 200 }),
      completed: booleanValue(entry.completed ?? false, 'สถานะงานย่อย') ? 1 : 0,
    };
  });
}

function recurRuleValue(value, options = {}) {
  if (value === undefined) return options.optional ? undefined : '';
  if (value === null) return '';
  if (typeof value !== 'string' || !RECUR_RULES.includes(value)) {
    throw new ValidationError('รูปแบบงานประจำไม่ถูกต้อง');
  }
  return value;
}

function parseTags(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

function readSubtasks(taskIds) {
  if (taskIds.length === 0) return new Map();
  const placeholders = taskIds.map(() => '?').join(',');
  const rows = db.prepare(
    'SELECT * FROM subtasks WHERE task_id IN (' + placeholders + ') ORDER BY position, id',
  ).all(...taskIds);
  const grouped = new Map(taskIds.map((id) => [id, []]));
  for (const row of rows) {
    const bucket = grouped.get(row.task_id);
    if (bucket) bucket.push({ id: row.id, title: row.title, completed: Boolean(row.completed) });
  }
  return grouped;
}

// แนบแท็กที่แปลงเป็น array และงานย่อยของแต่ละงานก่อนส่งกลับให้ client
function withDetails(tasks) {
  const list = Array.isArray(tasks) ? tasks : [tasks];
  const subtasks = readSubtasks(list.map((task) => task.id));
  const detailed = list.map((task) => ({
    ...task,
    tags: parseTags(task.tags),
    subtasks: subtasks.get(task.id) || [],
  }));
  return Array.isArray(tasks) ? detailed : detailed[0];
}

function replaceSubtasks(taskId, userId, subtasks) {
  db.prepare('DELETE FROM subtasks WHERE task_id = ? AND user_id = ?').run(taskId, userId);
  const insert = db.prepare(
    'INSERT INTO subtasks (task_id, user_id, title, completed, position) VALUES (?, ?, ?, ?, ?)',
  );
  subtasks.forEach((subtask, index) => {
    insert.run(taskId, userId, subtask.title, subtask.completed, index);
  });
}

function nextPosition(userId, quadrant) {
  return db.prepare(
    'SELECT COALESCE(MAX(position), 0) AS max_position FROM tasks WHERE user_id = ? AND quadrant = ?',
  ).get(userId, quadrant).max_position + 1;
}

function insertTaskRow(values) {
  return db.prepare(`
    INSERT INTO tasks (user_id, title, description, quadrant, due_date, due_has_time, recur_rule, recur_interval, tags, position, completed, archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    values.userId,
    values.title,
    values.description,
    values.quadrant,
    values.dueDate,
    values.dueHasTime,
    values.recurRule,
    values.recurInterval,
    values.tags,
    values.position,
    values.completed ?? 0,
    values.archived ?? 0,
  );
}

// สร้างงานรอบถัดไปของงานประจำ โดยรีเซ็ตงานย่อยและสถานะแจ้งเตือนให้เริ่มใหม่
function spawnNextOccurrence(task, userId, now = new Date()) {
  const upcoming = nextDueDate(task.due_date, task.recur_rule, task.recur_interval, now);
  if (!upcoming) return null;

  // เปิดงานเดิมกลับมาแล้วกดเสร็จซ้ำต้องไม่ได้งานรอบเดียวกันเพิ่มอีกใบ
  const duplicate = db.prepare(`
    SELECT id FROM tasks
    WHERE user_id = ? AND archived = 0 AND title = ? AND recur_rule = ? AND due_date = ? AND id != ?
  `).get(userId, task.title, task.recur_rule, upcoming, task.id);
  if (duplicate) return null;

  const create = db.transaction(() => {
    const info = insertTaskRow({
      userId,
      title: task.title,
      description: task.description,
      quadrant: task.quadrant,
      dueDate: upcoming,
      dueHasTime: task.due_has_time,
      recurRule: task.recur_rule,
      recurInterval: task.recur_interval,
      tags: task.tags,
      position: nextPosition(userId, task.quadrant),
    });
    const previousSubtasks = db.prepare(
      'SELECT title FROM subtasks WHERE task_id = ? ORDER BY position, id',
    ).all(task.id);
    replaceSubtasks(
      info.lastInsertRowid,
      userId,
      previousSubtasks.map((subtask) => ({ title: subtask.title, completed: 0 })),
    );
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  });

  return withDetails(create.immediate());
}

module.exports = {
  MAX_TAGS,
  MAX_SUBTASKS,
  tagsValue,
  subtasksValue,
  recurRuleValue,
  parseTags,
  withDetails,
  replaceSubtasks,
  nextPosition,
  insertTaskRow,
  spawnNextOccurrence,
};
