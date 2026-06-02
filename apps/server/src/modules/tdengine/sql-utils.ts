import { AppError } from "../../utils/errors.js";

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function quoteIdentifier(identifier: string) {
  if (!identifierPattern.test(identifier)) {
    throw new AppError("VALIDATION_FAILED", `非法标识符：${identifier}`, 400);
  }
  return `\`${identifier}\``;
}

export function quoteFullName(database: string, table: string) {
  return `${quoteIdentifier(database)}.${quoteIdentifier(table)}`;
}

export function sqlValue(value: unknown) {
  if (value === null || value === undefined || value === "" || value === "NULL") {
    return "NULL";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AppError("VALIDATION_FAILED", "数值字段无效", 400);
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlColumnValue(column: string, value: unknown) {
  const normalizedColumn = column.toLowerCase();
  if (normalizedColumn === "ts" || normalizedColumn === "time") {
    return sqlTimestampValue(value);
  }
  return sqlValue(value);
}

export function sqlTimestampValue(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return trimmed;
    }
    return sqlValue(normalizeTimestampText(trimmed));
  }
  return sqlValue(value);
}

function normalizeTimestampText(value: string) {
  const trimmed = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(trimmed);
  if (!match) {
    return trimmed;
  }
  return `${match[1]} ${match[2]}`;
}

export function buildInsertSql(database: string, table: string, values: Record<string, unknown>, excludeColumns: string[] = []) {
  const excluded = new Set(excludeColumns.map((column) => column.toLowerCase()));
  const columns = Object.keys(values).filter((column) => !excluded.has(column.toLowerCase()));
  if (!columns.includes("ts")) {
    throw new AppError("VALIDATION_FAILED", "新增或编辑必须包含时间主列 ts", 400);
  }
  const columnSql = columns.map(quoteIdentifier).join(", ");
  const valueSql = columns.map((column) => sqlColumnValue(column, values[column])).join(", ");
  return `INSERT INTO ${quoteFullName(database, table)} (${columnSql}) VALUES (${valueSql})`;
}

export function buildDeleteSql(database: string, table: string, timestamp: string) {
  const timestampValue = sqlTimestampValue(timestamp);
  return `DELETE FROM ${quoteFullName(database, table)} WHERE ${quoteIdentifier("ts")} >= ${timestampValue} AND ${quoteIdentifier("ts")} <= ${timestampValue}`;
}

export function classifySqlRisk(sql: string) {
  const normalized = sql.trim().replace(/\s+/g, " ").toUpperCase();
  if (/^(DROP|ALTER|CREATE|IMPORT|UPDATE)\b/.test(normalized)) {
    return { allowed: false, riskLevel: "high" as const, operation: "sql_execute" as const, reason: "默认禁止执行 DROP/ALTER/CREATE/IMPORT/UPDATE 等危险 SQL" };
  }
  if (/^DELETE\b/.test(normalized)) {
    return { allowed: true, riskLevel: "high" as const, operation: "delete" as const };
  }
  if (/^INSERT\b/.test(normalized)) {
    return { allowed: true, riskLevel: "medium" as const, operation: "create" as const };
  }
  if (/^(SELECT|SHOW|DESCRIBE|DESC)\b/.test(normalized)) {
    return { allowed: true, riskLevel: "low" as const, operation: "sql_execute" as const };
  }
  return { allowed: false, riskLevel: "high" as const, operation: "sql_execute" as const, reason: "无法识别或不允许的 SQL 类型" };
}

export function ensureSelectHasLimit(sql: string) {
  if (/^\s*SELECT\b/i.test(sql) && !/\bLIMIT\b/i.test(sql)) {
    return `${sql.replace(/;\s*$/, "")} LIMIT 100`;
  }
  return sql;
}
