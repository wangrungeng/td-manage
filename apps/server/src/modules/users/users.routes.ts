import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/database.js";
import { requirePermission } from "../../plugins/auth.js";
import { AppError } from "../../utils/errors.js";
import { createId } from "../../utils/ids.js";

const createUserSchema = z.object({
  username: z.string().trim().min(3).max(32),
  displayName: z.string().trim().min(1).max(64),
  password: z.string().min(8).max(128),
  roleCodes: z.array(z.enum(["admin", "editor", "viewer"])).min(1)
});

const updateUserSchema = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  roleCodes: z.array(z.enum(["admin", "editor", "viewer"])).min(1).optional()
});

const resetPasswordSchema = z.object({ password: z.string().min(8).max(128) });

export async function registerUserRoutes(app: FastifyInstance) {
  app.get("/roles", requirePermission(app, "system:role:manage"), async () => {
    return db.prepare("SELECT id, code, name, description FROM roles ORDER BY code").all();
  });

  app.get("/users", requirePermission(app, "system:user:manage"), async () => {
    const users = db.prepare("SELECT id, username, display_name, status, created_at, updated_at, last_login_at FROM users ORDER BY created_at DESC").all() as Array<Record<string, unknown> & { id: string }>;
    const roleRows = db.prepare(`
      SELECT ur.user_id, r.code FROM user_roles ur INNER JOIN roles r ON r.id = ur.role_id
    `).all() as Array<{ user_id: string; code: string }>;
    return users.map((user) => ({ ...user, roles: roleRows.filter((role) => role.user_id === user.id).map((role) => role.code) }));
  });

  app.post("/users", requirePermission(app, "system:user:manage"), async (request) => {
    const body = createUserSchema.parse(request.body);
    const now = new Date().toISOString();
    const userId = createId("user");
    const passwordHash = await bcrypt.hash(body.password, 12);

    db.transaction(() => {
      db.prepare(`
        INSERT INTO users (id, username, password_hash, display_name, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
      `).run(userId, body.username, passwordHash, body.displayName, now, now);
      replaceUserRoles(userId, body.roleCodes);
    })();

    return { id: userId };
  });

  app.patch("/users/:id", requirePermission(app, "system:user:manage"), async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = updateUserSchema.parse(request.body);
    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(params.id);
    if (!user) {
      throw new AppError("USER_NOT_FOUND", "用户不存在", 404);
    }

    db.transaction(() => {
      if (body.displayName || body.status) {
        db.prepare(`
          UPDATE users SET
            display_name = COALESCE(?, display_name),
            status = COALESCE(?, status),
            updated_at = ?
          WHERE id = ?
        `).run(body.displayName ?? null, body.status ?? null, new Date().toISOString(), params.id);
      }
      if (body.roleCodes) {
        replaceUserRoles(params.id, body.roleCodes);
      }
    })();

    return { ok: true };
  });

  app.post("/users/:id/reset-password", requirePermission(app, "system:user:manage"), async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = resetPasswordSchema.parse(request.body);
    const passwordHash = await bcrypt.hash(body.password, 12);
    const result = db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
      passwordHash,
      new Date().toISOString(),
      params.id
    );
    if (!result.changes) {
      throw new AppError("USER_NOT_FOUND", "用户不存在", 404);
    }
    return { ok: true };
  });
}

function replaceUserRoles(userId: string, roleCodes: string[]) {
  const roles = db
    .prepare(`SELECT id, code FROM roles WHERE code IN (${roleCodes.map(() => "?").join(",")})`)
    .all(...roleCodes) as Array<{ id: string; code: string }>;
  if (roles.length !== roleCodes.length) {
    throw new AppError("ROLE_NOT_FOUND", "角色不存在", 400);
  }

  db.prepare("DELETE FROM user_roles WHERE user_id = ?").run(userId);
  const stmt = db.prepare("INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)");
  for (const role of roles) {
    stmt.run(userId, role.id, new Date().toISOString());
  }
}
