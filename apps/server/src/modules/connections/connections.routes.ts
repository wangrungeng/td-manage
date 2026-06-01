import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/database.js";
import { requirePermission } from "../../plugins/auth.js";
import { AppError, maskSecret } from "../../utils/errors.js";
import { createId } from "../../utils/ids.js";
import { testTdengineConnection } from "../tdengine/tdengine.client.js";
import { writeAuditLog } from "../audit/audit.service.js";
import {
  encryptConnectionPassword,
  getConnection,
  resolveConnectionSecret,
  toSafeConnection,
  type ConnectionRecord
} from "./connection.service.js";

const connectionSchema = z.object({
  name: z.string().trim().min(1).max(64),
  protocol: z.enum(["ws", "wss"]).default("ws"),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535).default(6041),
  username: z.string().trim().min(1).max(64),
  password: z.string().max(256).optional(),
  defaultDatabase: z.string().trim().max(128).optional().nullable(),
  timezone: z.string().trim().max(64).optional().nullable(),
  connectTimeoutMs: z.coerce.number().int().min(1000).max(60000).default(5000),
  remark: z.string().trim().max(500).optional().nullable()
});

export async function registerConnectionRoutes(app: FastifyInstance) {
  app.get("/connections", requirePermission(app, "connection:read"), async () => {
    const rows = db.prepare("SELECT * FROM connections ORDER BY updated_at DESC").all() as ConnectionRecord[];
    return rows.map(toSafeConnection);
  });

  app.get("/connections/:id", requirePermission(app, "connection:read"), async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return toSafeConnection(getConnection(params.id));
  });

  app.post("/connections", requirePermission(app, "connection:write"), async (request) => {
    const body = connectionSchema.parse(request.body);
    const now = new Date().toISOString();
    const id = createId("conn");
    db.prepare(`
      INSERT INTO connections (
        id, name, protocol, host, port, username, password_cipher, default_database, timezone,
        connect_timeout_ms, remark, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.name,
      body.protocol,
      body.host,
      body.port,
      body.username,
      encryptConnectionPassword(body.password),
      body.defaultDatabase || null,
      body.timezone || null,
      body.connectTimeoutMs,
      body.remark || null,
      request.currentUser!.id,
      now,
      now
    );
    return toSafeConnection(getConnection(id));
  });

  app.patch("/connections/:id", requirePermission(app, "connection:write"), async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = connectionSchema.partial().parse(request.body);
    const old = getConnection(params.id);
    const passwordCipher = body.password ? encryptConnectionPassword(body.password) : old.password_cipher;

    db.prepare(`
      UPDATE connections SET
        name = COALESCE(@name, name),
        protocol = COALESCE(@protocol, protocol),
        host = COALESCE(@host, host),
        port = COALESCE(@port, port),
        username = COALESCE(@username, username),
        password_cipher = @password_cipher,
        default_database = @default_database,
        timezone = @timezone,
        connect_timeout_ms = COALESCE(@connect_timeout_ms, connect_timeout_ms),
        remark = @remark,
        updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: params.id,
      name: body.name ?? null,
      protocol: body.protocol ?? null,
      host: body.host ?? null,
      port: body.port ?? null,
      username: body.username ?? null,
      password_cipher: passwordCipher,
      default_database: body.defaultDatabase === undefined ? old.default_database : body.defaultDatabase || null,
      timezone: body.timezone === undefined ? old.timezone : body.timezone || null,
      connect_timeout_ms: body.connectTimeoutMs ?? null,
      remark: body.remark === undefined ? old.remark : body.remark || null,
      updated_at: new Date().toISOString()
    });

    return toSafeConnection(getConnection(params.id));
  });

  app.delete("/connections/:id", requirePermission(app, "connection:write"), async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const result = db.prepare("DELETE FROM connections WHERE id = ?").run(params.id);
    if (!result.changes) {
      throw new AppError("CONNECTION_NOT_FOUND", "连接不存在", 404);
    }
    return { ok: true };
  });

  app.post("/connections/:id/test", requirePermission(app, "connection:read"), async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const row = getConnection(params.id);
    const password = resolveConnectionSecret(row);
    const startedAt = new Date().toISOString();

    try {
      const result = await testTdengineConnection(row, password);
      db.prepare("UPDATE connections SET last_test_at = ?, last_test_status = 'success', last_error = NULL WHERE id = ?").run(
        startedAt,
        params.id
      );
      writeAuditLog({
        userId: request.currentUser!.id,
        username: request.currentUser!.username,
        connectionId: row.id,
        connectionName: row.name,
        operation: "connection_test",
        riskLevel: "low",
        sqlText: "SHOW DATABASES",
        success: true,
        requestId: request.id
      });
      return result;
    } catch (error) {
      const detail = maskSecret(error instanceof Error ? error.message : String(error));
      db.prepare("UPDATE connections SET last_test_at = ?, last_test_status = 'failed', last_error = ? WHERE id = ?").run(
        startedAt,
        detail,
        params.id
      );
      writeAuditLog({
        userId: request.currentUser!.id,
        username: request.currentUser!.username,
        connectionId: row.id,
        connectionName: row.name,
        operation: "connection_test",
        riskLevel: "low",
        sqlText: "SHOW DATABASES",
        success: false,
        errorMessage: detail,
        requestId: request.id
      });
      throw new AppError("TDENGINE_CONNECTION_FAILED", "TDengine 连接失败", 400, detail);
    }
  });
}
