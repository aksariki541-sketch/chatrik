import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'rikichat.sqlite');

let sqlDb = null;
let saveTimer = null;
let dirty = false;

function persist() {
  if (!sqlDb) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const data = sqlDb.export();
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, DB_PATH);
    dirty = false;
  } catch (err) {
    console.error('DB persist failed:', err.message);
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist();
  }, 80);
}

function rowsFrom(stmt) {
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

export const db = {
  exec(sql) {
    sqlDb.exec(sql);
    scheduleSave();
  },
  run(sql, params = []) {
    sqlDb.run(sql, params);
    scheduleSave();
    const res = sqlDb.exec('SELECT last_insert_rowid() AS id, changes() AS changes');
    const row = res[0]?.values?.[0];
    return { lastInsertRowid: row?.[0] ?? 0, changes: row?.[1] ?? 0 };
  },
  get(sql, params = []) {
    const stmt = sqlDb.prepare(sql);
    stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  },
  all(sql, params = []) {
    const stmt = sqlDb.prepare(sql);
    stmt.bind(params);
    return rowsFrom(stmt);
  },
  transaction(fn) {
    sqlDb.run('BEGIN');
    try {
      const result = fn();
      sqlDb.run('COMMIT');
      scheduleSave();
      return result;
    } catch (e) {
      sqlDb.run('ROLLBACK');
      throw e;
    }
  },
  flush: persist,
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  bio TEXT DEFAULT '',
  status TEXT DEFAULT 'offline',
  last_seen INTEGER,
  created_at INTEGER NOT NULL,
  username_changed_at INTEGER
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('dm','group')),
  name TEXT,
  avatar TEXT,
  description TEXT,
  owner_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  last_read_at INTEGER DEFAULT 0,
  last_read_message_id TEXT,
  muted INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  cleared_at INTEGER DEFAULT 0,
  hidden INTEGER DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text',
  reply_to TEXT,
  edited INTEGER DEFAULT 0,
  edited_at INTEGER,
  deleted INTEGER DEFAULT 0,
  deleted_for TEXT DEFAULT '[]',
  forwarded_from TEXT,
  client_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS message_status (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS reactions (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  mime TEXT,
  file_size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  duration REAL
);

CREATE TABLE IF NOT EXISTS pins (
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  pinned_by TEXT NOT NULL,
  pinned_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, message_id)
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  data TEXT DEFAULT '{}',
  read INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at INTEGER,
  revoked INTEGER DEFAULT 0,
  uses INTEGER DEFAULT 0,
  max_uses INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_conv ON conversation_members(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv_time ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_client ON messages(client_id);
CREATE INDEX IF NOT EXISTS idx_status_msg ON message_status(message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_msg ON reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_msg ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_content ON messages(content);
`;

export async function initDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const wasmDir = path.dirname(require.resolve('sql.js'));
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(wasmDir, file),
  });
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    sqlDb = new SQL.Database(fileBuffer);
  } else {
    sqlDb = new SQL.Database();
  }
  sqlDb.exec('PRAGMA foreign_keys = ON;');
  sqlDb.exec(SCHEMA);
  persist();

  process.on('exit', () => {
    if (dirty) persist();
  });
  process.on('SIGINT', () => {
    persist();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    persist();
    process.exit(0);
  });

  return db;
}
