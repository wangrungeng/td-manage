import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { env } from "../config/env.js";
import { createId } from "../utils/ids.js";

export const dbPath = path.resolve(process.cwd(), env.SQLITE_PATH);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export type RoleCode = "admin" | "editor" | "viewer";

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'ws',
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 6041,
  username TEXT NOT NULL,
  password_cipher TEXT,
  default_database TEXT,
  timezone TEXT,
  connect_timeout_ms INTEGER NOT NULL DEFAULT 5000,
  remark TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_test_at TEXT,
  last_test_status TEXT NOT NULL DEFAULT 'unknown',
  last_error TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  connection_id TEXT,
  connection_name TEXT,
  database_name TEXT,
  table_name TEXT,
  operation TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  sql_text TEXT NOT NULL,
  sql_params_json TEXT,
  before_json TEXT,
  after_json TEXT,
  affected_rows INTEGER,
  success INTEGER NOT NULL,
  error_message TEXT,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sql_script_folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sql_scripts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sql_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES sql_script_folders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sql_script_folders_user ON sql_script_folders(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_sql_scripts_user_folder ON sql_scripts(user_id, folder_id, updated_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function initDatabase() {
  db.exec(schema);
  seedRoles();
  setSettingIfMissing("initialized", "false");
  setSettingIfMissing("default_page_size", "100");
  setSettingIfMissing("max_page_size", "1000");
}

function seedRoles() {
  const now = new Date().toISOString();
  const roles: Array<{ code: RoleCode; name: string; description: string }> = [
    { code: "admin", name: "系统管理员", description: "拥有全部系统和 TDengine 操作权限" },
    { code: "editor", name: "数据编辑员", description: "可查询和编辑 TDengine 数据，不可管理用户角色" },
    { code: "viewer", name: "只读查看员", description: "仅可查看连接、元数据、数据和审计" }
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO roles (id, code, name, description, created_at, updated_at)
    VALUES (@id, @code, @name, @description, @created_at, @updated_at)
  `);

  for (const role of roles) {
    stmt.run({ id: createId("role"), ...role, created_at: now, updated_at: now });
  }
}

export function getSetting(key: string) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, new Date().toISOString());
}

function setSettingIfMissing(key: string, value: string) {
  db.prepare("INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
    key,
    value,
    new Date().toISOString()
  );
}

export function getRoleId(code: RoleCode) {
  const row = db.prepare("SELECT id FROM roles WHERE code = ?").get(code) as { id: string } | undefined;
  if (!row) {
    throw new Error(`角色不存在：${code}`);
  }
  return row.id;
}
