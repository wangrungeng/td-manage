import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/database.js";
import { requirePermission } from "../../plugins/auth.js";

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  operation: z.string().optional(),
  success: z.coerce.number().int().min(0).max(1).optional(),
  keyword: z.string().trim().optional()
});

export async function registerAuditRoutes(app: FastifyInstance) {
  app.get("/audit-logs", requirePermission(app, "audit:read"), async (request) => {
    const query = querySchema.parse(request.query);
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.operation) {
      clauses.push("operation = @operation");
      params.operation = query.operation;
    }
    if (query.success !== undefined) {
      clauses.push("success = @success");
      params.success = query.success;
    }
    if (query.keyword) {
      clauses.push("(username LIKE @keyword OR connection_name LIKE @keyword OR table_name LIKE @keyword OR sql_text LIKE @keyword)");
      params.keyword = `%${query.keyword}%`;
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = db.prepare(`SELECT COUNT(*) AS total FROM audit_logs ${where}`).get(params) as { total: number };
    const rows = db
      .prepare(
        `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: query.pageSize, offset: (query.page - 1) * query.pageSize });

    return { total: total.total, items: rows };
  });

  app.get("/audit-logs/:id", requirePermission(app, "audit:read"), async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return db.prepare("SELECT * FROM audit_logs WHERE id = ?").get(params.id) ?? null;
  });
}
