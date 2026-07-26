const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');

const dataDir = config.dataDir;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT,
    google_sub TEXT,
    display_name TEXT,
    avatar_url TEXT,
    session_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    quadrant INTEGER NOT NULL CHECK (quadrant IN (1,2,3,4)),
    due_date TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    notified INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    notification_claimed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    plan_name TEXT NOT NULL DEFAULT '',
    price TEXT NOT NULL DEFAULT '',
    renewal_date TEXT NOT NULL,
    reminder_days INTEGER NOT NULL DEFAULT 7,
    notes TEXT NOT NULL DEFAULT '',
    notified INTEGER NOT NULL DEFAULT 0,
    notification_claimed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    telegram_bot_token TEXT DEFAULT '',
    telegram_chat_id TEXT DEFAULT '',
    notify_before_minutes INTEGER DEFAULT 60,
    subscription_notify_enabled INTEGER DEFAULT 1,
    daily_summary_enabled INTEGER DEFAULT 0,
    daily_summary_time TEXT DEFAULT '08:00',
    daily_summary_last_sent TEXT DEFAULT '',
    daily_summary_claimed_for TEXT DEFAULT '',
    daily_summary_claimed_at TEXT
  );
`);

// เพิ่มคอลัมน์บัญชี Google ให้ฐานข้อมูลเดิมโดยไม่ลบหรือย้ายข้อมูลผู้ใช้
const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
const userMigrations = [
  ['email', 'ALTER TABLE users ADD COLUMN email TEXT'],
  ['google_sub', 'ALTER TABLE users ADD COLUMN google_sub TEXT'],
  ['display_name', 'ALTER TABLE users ADD COLUMN display_name TEXT'],
  ['avatar_url', 'ALTER TABLE users ADD COLUMN avatar_url TEXT'],
  ['session_version', 'ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0'],
];

for (const [column, sql] of userMigrations) {
  if (!userColumns.has(column)) db.exec(sql);
}

function ensureColumn(table, column, sql) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name));
  if (!columns.has(column)) db.exec(sql);
}

ensureColumn('tasks', 'notification_claimed_at', 'ALTER TABLE tasks ADD COLUMN notification_claimed_at TEXT');
ensureColumn('settings', 'daily_summary_claimed_for', "ALTER TABLE settings ADD COLUMN daily_summary_claimed_for TEXT DEFAULT ''");
ensureColumn('settings', 'daily_summary_claimed_at', 'ALTER TABLE settings ADD COLUMN daily_summary_claimed_at TEXT');
ensureColumn('settings', 'subscription_notify_enabled', 'ALTER TABLE settings ADD COLUMN subscription_notify_enabled INTEGER DEFAULT 1');

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique
  ON users(google_sub)
  WHERE google_sub IS NOT NULL AND google_sub != '';

  CREATE INDEX IF NOT EXISTS tasks_user_quadrant_position
  ON tasks(user_id, quadrant, position, id);

  CREATE INDEX IF NOT EXISTS tasks_due_pending
  ON tasks(user_id, completed, notified, due_date);

  CREATE INDEX IF NOT EXISTS notes_user_id_desc
  ON notes(user_id, id DESC);

  CREATE INDEX IF NOT EXISTS subscriptions_due_pending
  ON subscriptions(user_id, notified, renewal_date);
`);

module.exports = db;
