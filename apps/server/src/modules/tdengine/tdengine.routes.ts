import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requirePermission } from "../../plugins/auth.js";
import { AppError } from "../../utils/errors.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { getConnection, resolveConnectionSecret } from "../connections/connection.service.js";
import { normalizeQueryResult, withTdengineConnection } from "./tdengine.client.js";
import {
  buildDeleteSql,
  buildInsertSql,
  classifySqlRisk,
  ensureSelectHasLimit,
  quoteFullName,
  quoteIdentifier,
  sqlTimestampValue,
  sqlValue
} from "./sql-utils.js";

const connectionParamsSchema = z.object({ connectionId: z.string() });

const querySchema = z.object({
  database: z.string().trim().min(1),
  table: z.string().trim().min(1),
  startTime: z.string().trim().min(1),
  endTime: z.string().trim().min(1),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100),
  fields: z.array(z.string()).optional(),
  filters: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
});

const createSchema = z.object({
  database: z.string().trim().min(1),
  table: z.string().trim().min(1),
  targetTable: z.string().trim().min(1).optional(),
  values: z.record(z.any())
});

const updateSchema = z.object({
  database: z.string().trim().min(1),
  table: z.string().trim().min(1),
  targetTable: z.string().trim().min(1).optional(),
  original: z.record(z.any()),
  values: z.record(z.any())
});

const deleteSchema = z.object({
  database: z.string().trim().min(1),
  table: z.string().trim().min(1),
  timestamp: z.string().trim().min(1),
  confirmText: z.string().optional()
});

const sqlSchema = z.object({
  database: z.string().trim().optional(),
  sql: z.string().trim().min(1),
  confirmText: z.string().optional()
});

export async function registerTdengineRoutes(app: FastifyInstance) {
  app.get("/tdengine/:connectionId/databases", requirePermission(app, "tdengine:metadata:read"), async (request) => {
    const params = connectionParamsSchema.parse(request.params);
    const connection = getConnection(params.connectionId);
    const password = resolveConnectionSecret(connection);
    return withTdengineConnection(connection, password, async (client) => normalizeQueryResult(await client.query("SHOW DATABASES")));
  });

  app.get("/tdengine/:connectionId/databases/:database/tables", requirePermission(app, "tdengine:metadata:read"), async (request) => {
    const params = z.object({ connectionId: z.string(), database: z.string() }).parse(request.params);
    const connection = getConnection(params.connectionId);
    const password = resolveConnectionSecret(connection);
    return withTdengineConnection(connection, password, async (client) => {
      await client.exec(`USE ${quoteIdentifier(params.database)}`);
      const tables = normalizeQueryResult(await client.query("SHOW TABLES"));
      const stables = normalizeQueryResult(await client.query("SHOW STABLES"));
      return { tables, stables };
    });
  });

  app.get("/tdengine/:connectionId/databases/:database/tables/:table/schema", requirePermission(app, "tdengine:metadata:read"), async (request) => {
    const params = z.object({ connectionId: z.string(), database: z.string(), table: z.string() }).parse(request.params);
    const connection = getConnection(params.connectionId);
    const password = resolveConnectionSecret(connection);
    return withTdengineConnection(connection, password, async (client) =>
      normalizeQueryResult(await client.query(`DESCRIBE ${quoteFullName(params.database, params.table)}`))
    );
  });

  app.post("/tdengine/:connectionId/data/query", requirePermission(app, "tdengine:data:read"), async (request) => {
    const params = connectionParamsSchema.parse(request.params);
    const body = querySchema.parse(request.body);
    const connection = getConnection(params.connectionId);
    const password = resolveConnectionSecret(connection);
    const fields = buildSelectFields(body.fields);
    const clauses = [`${quoteIdentifier("ts")} >= ${sqlValue(body.startTime)}`, `${quoteIdentifier("ts")} <= ${sqlValue(body.endTime)}`];

    for (const [field, value] of Object.entries(body.filters ?? {})) {
      clauses.push(`${quoteIdentifier(field)} = ${sqlValue(value)}`);
    }

    const sql = `SELECT ${fields} FROM ${quoteFullName(body.database, body.table)} WHERE ${clauses.join(" AND ")} ORDER BY ${quoteIdentifier("ts")} DESC LIMIT ${body.pageSize} OFFSET ${(body.page - 1) * body.pageSize}`;
    return withTdengineConnection(connection, password, async (client) => ({ sql, items: normalizeQueryResult(await client.query(sql)) }));
  });

  app.post("/tdengine/:connectionId/data/create/preview", requirePermission(app, "tdengine:data:create"), async (request) => {
    const body = createSchema.parse(request.body);
    const sql = buildInsertSql(body.database, resolveWriteTable(body), body.values, resolveInsertExcludeColumns(body));
    return { sql, riskLevel: "medium", operation: "create", values: body.values };
  });

  app.post("/tdengine/:connectionId/data/create/execute", requirePermission(app, "tdengine:data:create"), async (request) => {
    const params = connectionParamsSchema.parse(request.params);
    const body = createSchema.parse(request.body);
    const connection = getConnection(params.connectionId);
    const password = resolveConnectionSecret(connection);
    const sql = buildInsertSql(body.database, resolveWriteTable(body), body.values, resolveInsertExcludeColumns(body));
    try {
      const result = await withTdengineConnection(connection, password, async (client) => client.exec(sql));
      writeAuditLog({
        userId: request.currentUser!.id,
        username: request.currentUser!.username,
        connectionId: connection.id,
        connectionName: connection.name,
        databaseName: body.database,
        tableName: body.table,
        operation: "create",
        riskLevel: "medium",
        sqlText: sql,
        after: body.values,
        success: true,
        requestId: request.id
      });
      return { sql, result };
    } catch (error) {
      writeFailureAudit(request, connection, body.database, body.table, "create", "medium", sql, error, undefined, body.values);
      throw error;
    }
  });

  app.post("/tdengine/:connectionId/data/update/preview", requirePermission(app, "tdengine:data:update"), async (request) => {
    const body = updateSchema.parse(request.body);
    if (!body.original.ts || !body.values.ts || body.original.ts !== body.values.ts) {
      throw new AppError("VALIDATION_FAILED", "编辑必须保持原时间戳不变", 400);
    }
    const sql = buildInsertSql(body.database, resolveWriteTable(body), body.values, resolveInsertExcludeColumns(body));
    return {
      sql,
      riskLevel: "medium",
      operation: "update",
      before: body.original,
      after: body.values,
      changedFields: Object.keys(body.values).filter((key) => body.values[key] !== body.original[key])
    };
  });

  app.post("/tdengine/:connectionId/data/update/execute", requirePermission(app, "tdengine:data:update"), async (request) => {
    const params = connectionParamsSchema.parse(request.params);
    const body = updateSchema.parse(request.body);
    if (!body.original.ts || !body.values.ts || body.original.ts !== body.values.ts) {
      throw new AppError("VALIDATION_FAILED", "编辑必须保持原时间戳不变", 400);
    }
    const connection = getConnection(params.connectionId);
    const password = resolveConnectionSecret(connection);
    const sql = buildInsertSql(body.database, resolveWriteTable(body), body.values, resolveInsertExcludeColumns(body));
    try {
      const result = await withTdengineConnection(connection, password, async (client) => {
        const current = await selectUniqueRow(client, body.database, body.table, String(body.original.ts));
        if (!current) {
          throw new AppError("TDENGINE_ROW_NOT_FOUND", "待编辑数据不存在", 404);
        }
        return client.exec(sql);
      });
      writeAuditLog({
        userId: request.currentUser!.id,
        username: request.currentUser!.username,
        connectionId: connection.id,
        connectionName: connection.name,
        databaseName: body.database,
        tableName: body.table,
        operation: "update",
        riskLevel: "medium",
        sqlText: sql,
        before: body.original,
        after: body.values,
        success: true,
        requestId: request.id
      });
      return { sql, result };
    } catch (error) {
      writeFailureAudit(request, connection, body.database, body.table, "update", "medium", sql, error, body.original, body.values);
      throw error;
    }
  });

  app.post("/tdengine/:connectionId/data/delete/preview", requirePermission(app, "tdengine:data:delete"), async (request) => {
    const params = connectionParamsSchema.parse(request.params);
    const body = deleteSchema.parse(request.body);
    const connection = getConnection(params.connectionId);
    const password = resolveConnectionSecret(connection);
    const confirmSql = `SELECT * FROM ${quoteFullName(body.database, body.table)} WHERE ${quoteIdentifier("ts")} = ${sqlTimestampValue(body.timestamp)} LIMIT 2`;
    const rows = await withTdengineConnection(connection, password, async (client) => normalizeQueryResult(await client.query(confirmSql)));
    if (!rows.length) {
      throw new AppError("TDENGINE_ROW_NOT_FOUND", "未找到待删除数据", 404);
    }
    if (rows.length > 1) {
      throw new AppError("TDENGINE_ROW_NOT_UNIQUE", "待删除数据无法唯一定位", 409);
    }
    return { sql: buildDeleteSql(body.database, body.table, body.timestamp), riskLevel: "high", operation: "delete", row: rows[0] };
  });

  app.post("/tdengine/:connectionId/data/delete/execute", requirePermission(app, "tdengine:data:delete"), async (request) => {
    const params = connectionParamsSchema.parse(request.params);
    const body = deleteSchema.parse(request.body);
    if (body.confirmText !== "DELETE") {
      throw new AppError("VALIDATION_FAILED", "删除操作必须输入 DELETE 确认", 400);
    }
    const connection = getConnection(params.connectionId);
    const password = resolveConnectionSecret(connection);
    const sql = buildDeleteSql(body.database, body.table, body.timestamp);
    let before: unknown;
    try {
      const result = await withTdengineConnection(connection, password, async (client) => {
        before = await selectUniqueRow(client, body.database, body.table, body.timestamp);
        if (!before) {
          throw new AppError("TDENGINE_ROW_NOT_FOUND", "待删除数据不存在", 404);
        }
        return client.exec(sql);
      });
      writeAuditLog({
        userId: request.currentUser!.id,
        username: request.currentUser!.username,
        connectionId: connection.id,
        connectionName: connection.name,
        databaseName: body.database,
        tableName: body.table,
        operation: "delete",
        riskLevel: "high",
        sqlText: sql,
        before,
        success: true,
        requestId: request.id
      });
      return { sql, result };
    } catch (error) {
      writeFailureAudit(request, connection, body.database, body.table, "delete", "high", sql, error, before);
      throw error;
    }
  });

  app.post("/tdengine/:connectionId/sql/preview", requirePermission(app, "tdengine:sql:execute"), async (request) => {
    const body = sqlSchema.parse(request.body);
    const risk = classifySqlRisk(body.sql);
    if (!risk.allowed) {
      throw new AppError("TDENGINE_UNSAFE_SQL", risk.reason ?? "SQL 不允许执行", 400);
    }
    return { sql: ensureSelectHasLimit(body.sql), ...risk };
  });

  app.post("/tdengine/:connectionId/sql/execute", requirePermission(app, "tdengine:sql:execute"), async (request) => {
    const params = connectionParamsSchema.parse(request.params);
    const body = sqlSchema.parse(request.body);
    const risk = classifySqlRisk(body.sql);
    if (!risk.allowed) {
      throw new AppError("TDENGINE_UNSAFE_SQL", risk.reason ?? "SQL 不允许执行", 400);
    }
    if (risk.riskLevel !== "low" && body.confirmText !== "CONFIRM") {
      throw new AppError("VALIDATION_FAILED", "写 SQL 必须输入 CONFIRM 确认", 400);
    }

    const connection = getConnection(params.connectionId);
    const password = resolveConnectionSecret(connection);
    const finalSql = ensureSelectHasLimit(body.sql);
    try {
      const result = await withTdengineConnection(connection, password, async (client) =>
        risk.riskLevel === "low" ? client.query(finalSql) : client.exec(finalSql)
      );
      writeAuditLog({
        userId: request.currentUser!.id,
        username: request.currentUser!.username,
        connectionId: connection.id,
        connectionName: connection.name,
        databaseName: body.database ?? connection.default_database,
        operation: risk.operation,
        riskLevel: risk.riskLevel,
        sqlText: finalSql,
        success: true,
        requestId: request.id
      });
      return { sql: finalSql, rows: risk.riskLevel === "low" ? normalizeQueryResult(result) : [], result };
    } catch (error) {
      writeFailureAudit(request, connection, body.database ?? connection.default_database, null, risk.operation, risk.riskLevel, finalSql, error);
      throw error;
    }
  });
}

type QueryClient = {
  query: (sql: string) => Promise<unknown>;
};

function resolveWriteTable(body: { table: string; targetTable?: string; values: Record<string, unknown> }) {
  const targetTable = body.targetTable || readStringField(body.values, "tbname") || readStringField(body.values, "table_name");
  if (!targetTable && isStableWrite(body)) {
    throw new AppError("VALIDATION_FAILED", "超级表写入必须包含子表名 tbname", 400);
  }
  if (!targetTable) {
    return body.table;
  }
  return targetTable;
}

function resolveInsertExcludeColumns(body: { targetTable?: string; values: Record<string, unknown> }) {
  if (!isStableWrite(body)) {
    return [];
  }
  return ["tbname", "table_name", "stable_name", "device_warn_id", "device_id", "device_code"];
}

function isStableWrite(body: { targetTable?: string; values: Record<string, unknown> }) {
  return Boolean(body.targetTable || readStringField(body.values, "tbname") || readStringField(body.values, "stable_name"));
}

function readStringField(values: Record<string, unknown>, field: string) {
  const entry = Object.entries(values).find(([key]) => key.toLowerCase() === field.toLowerCase());
  const value = entry?.[1];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function buildSelectFields(fields: string[] | undefined) {
  if (!fields?.length) {
    return "*";
  }
  const normalized = fields.map((field) => field.trim()).filter(Boolean);
  if (normalized.some((field) => field.toLowerCase() === "tbname")) {
    return ["tbname", "*"].join(", ");
  }
  return normalized.map(quoteIdentifier).join(", ");
}

async function selectUniqueRow(client: QueryClient, database: string, table: string, timestamp: string) {
  const sql = `SELECT * FROM ${quoteFullName(database, table)} WHERE ${quoteIdentifier("ts")} = ${sqlTimestampValue(timestamp)} LIMIT 2`;
  const rows = normalizeQueryResult(await client.query(sql));
  if (rows.length > 1) {
    throw new AppError("TDENGINE_ROW_NOT_UNIQUE", "目标数据无法唯一定位", 409);
  }
  return rows[0];
}

function writeFailureAudit(
  request: FastifyRequest,
  connection: ReturnType<typeof getConnection>,
  databaseName: string | null | undefined,
  tableName: string | null | undefined,
  operation: "create" | "update" | "delete" | "sql_execute" | "connection_test",
  riskLevel: "low" | "medium" | "high",
  sqlText: string,
  error: unknown,
  before?: unknown,
  after?: unknown
) {
  writeAuditLog({
    userId: request.currentUser!.id,
    username: request.currentUser!.username,
    connectionId: connection.id,
    connectionName: connection.name,
    databaseName: databaseName ?? null,
    tableName: tableName ?? null,
    operation,
    riskLevel,
    sqlText,
    before,
    after,
    success: false,
    errorMessage: error instanceof Error ? error.message : String(error),
    requestId: request.id
  });
}
