import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, getRoleId, getSetting, setSetting } from "../../db/database.js";
import { loadCurrentUser, requireAuth } from "../../plugins/auth.js";
import { AppError } from "../../utils/errors.js";
import { createId } from "../../utils/ids.js";

const initSchema = z.object({
  username: z.string().trim().min(3).max(32),
  displayName: z.string().trim().min(1).max(64),
  password: z.string().min(8).max(128)
});

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});

const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(64)
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128)
});

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/auth/status", async () => ({ initialized: getSetting("initialized") === "true" }));

  app.post("/auth/init", async (request) => {
    if (getSetting("initialized") === "true") {
      throw new AppError("AUTH_ALREADY_INITIALIZED", "系统已经初始化", 409);
    }

    const body = initSchema.parse(request.body);
    const now = new Date().toISOString();
    const userId = createId("user");
    const passwordHash = await bcrypt.hash(body.password, 12);
    const adminRoleId = getRoleId("admin");

    const insertUser = db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `);
    const insertRole = db.prepare("INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)");

    db.transaction(() => {
      insertUser.run(userId, body.username, passwordHash, body.displayName, now, now);
      insertRole.run(userId, adminRoleId, now);
      setSetting("initialized", "true");
    })();

    return { id: userId, username: body.username, displayName: body.displayName };
  });

  app.post("/auth/login", async (request) => {
    const body = loginSchema.parse(request.body);
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(body.username) as
      | { id: string; username: string; password_hash: string; display_name: string; status: string }
      | undefined;

    if (!user || user.status !== "active") {
      throw new AppError("AUTH_INVALID_CREDENTIALS", "用户名或密码错误", 401);
    }

    const ok = await bcrypt.compare(body.password, user.password_hash);
    if (!ok) {
      throw new AppError("AUTH_INVALID_CREDENTIALS", "用户名或密码错误", 401);
    }

    db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      new Date().toISOString(),
      user.id
    );

    const token = app.jwt.sign({ sub: user.id }, { expiresIn: "12h" });
    return { token };
  });

  app.post("/auth/logout", requireAuth(app), async () => ({ ok: true }));

  app.get("/auth/me", requireAuth(app), async (request) => ({ user: request.currentUser }));

  app.patch("/auth/me", requireAuth(app), async (request) => {
    const body = updateMeSchema.parse(request.body);
    const userId = request.currentUser!.id;
    const result = db.prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?").run(
      body.displayName,
      new Date().toISOString(),
      userId
    );
    if (!result.changes) {
      throw new AppError("AUTH_FORBIDDEN", "用户不存在或已禁用", 403);
    }
    return { user: loadCurrentUser(userId) };
  });

  app.post("/auth/me/change-password", requireAuth(app), async (request) => {
    const body = changePasswordSchema.parse(request.body);
    const userId = request.currentUser!.id;
    const user = db.prepare("SELECT id, password_hash FROM users WHERE id = ?").get(userId) as
      | { id: string; password_hash: string }
      | undefined;
    if (!user) {
      throw new AppError("AUTH_FORBIDDEN", "用户不存在或已禁用", 403);
    }

    const ok = await bcrypt.compare(body.oldPassword, user.password_hash);
    if (!ok) {
      throw new AppError("AUTH_INVALID_PASSWORD", "原密码错误", 400);
    }

    const passwordHash = await bcrypt.hash(body.newPassword, 12);
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
      passwordHash,
      new Date().toISOString(),
      userId
    );
    return { ok: true };
  });
}
