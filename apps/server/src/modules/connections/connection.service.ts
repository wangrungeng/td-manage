import { db } from "../../db/database.js";
import { decryptText, encryptText } from "../../utils/crypto.js";
import { AppError } from "../../utils/errors.js";

export interface ConnectionRecord {
  id: string;
  name: string;
  protocol: "ws" | "wss";
  host: string;
  port: number;
  username: string;
  password_cipher: string | null;
  default_database: string | null;
  timezone: string | null;
  connect_timeout_ms: number;
  remark: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_test_at: string | null;
  last_test_status: "success" | "failed" | "unknown";
  last_error: string | null;
}

export function getConnection(id: string) {
  const row = db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as ConnectionRecord | undefined;
  if (!row) {
    throw new AppError("CONNECTION_NOT_FOUND", "连接不存在", 404);
  }
  return row;
}

export function toSafeConnection(row: ConnectionRecord) {
  return {
    ...row,
    password_cipher: undefined,
    hasPassword: Boolean(row.password_cipher)
  };
}

export function resolveConnectionSecret(row: ConnectionRecord, overridePassword?: string) {
  if (overridePassword !== undefined && overridePassword !== "") {
    return overridePassword;
  }
  if (!row.password_cipher) {
    throw new AppError("CONNECTION_PASSWORD_REQUIRED", "连接未保存密码，请重新输入", 400);
  }
  return decryptText(row.password_cipher);
}

export function encryptConnectionPassword(password?: string) {
  if (!password) {
    return null;
  }
  return encryptText(password);
}
