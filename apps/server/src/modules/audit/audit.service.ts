import { db } from "../../db/database.js";
import { createId } from "../../utils/ids.js";
import { maskSecret } from "../../utils/errors.js";

export interface AuditInput {
  userId: string;
  username: string;
  connectionId?: string | null;
  connectionName?: string | null;
  databaseName?: string | null;
  tableName?: string | null;
  operation: "create" | "update" | "delete" | "sql_execute" | "connection_test";
  riskLevel: "low" | "medium" | "high";
  sqlText: string;
  sqlParams?: unknown;
  before?: unknown;
  after?: unknown;
  affectedRows?: number | null;
  success: boolean;
  errorMessage?: string | null;
  requestId: string;
}

export function writeAuditLog(input: AuditInput) {
  db.prepare(`
    INSERT INTO audit_logs (
      id, user_id, username, connection_id, connection_name, database_name, table_name,
      operation, risk_level, sql_text, sql_params_json, before_json, after_json,
      affected_rows, success, error_message, request_id, created_at
    ) VALUES (
      @id, @user_id, @username, @connection_id, @connection_name, @database_name, @table_name,
      @operation, @risk_level, @sql_text, @sql_params_json, @before_json, @after_json,
      @affected_rows, @success, @error_message, @request_id, @created_at
    )
  `).run({
    id: createId("audit"),
    user_id: input.userId,
    username: input.username,
    connection_id: input.connectionId ?? null,
    connection_name: input.connectionName ?? null,
    database_name: input.databaseName ?? null,
    table_name: input.tableName ?? null,
    operation: input.operation,
    risk_level: input.riskLevel,
    sql_text: maskSecret(input.sqlText),
    sql_params_json: safeJson(input.sqlParams),
    before_json: safeJson(input.before),
    after_json: safeJson(input.after),
    affected_rows: input.affectedRows ?? null,
    success: input.success ? 1 : 0,
    error_message: input.errorMessage ? maskSecret(input.errorMessage) : null,
    request_id: input.requestId,
    created_at: new Date().toISOString()
  });
}

function safeJson(value: unknown) {
  return value === undefined ? null : JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
}
