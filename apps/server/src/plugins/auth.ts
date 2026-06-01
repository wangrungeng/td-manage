import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { env } from "../config/env.js";
import { db } from "../db/database.js";
import { AppError } from "../utils/errors.js";
import { collectPermissions, type Permission } from "../modules/users/permissions.js";

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: CurrentUser;
  }
}

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  roles: string[];
  permissions: Permission[];
}

export async function registerAuthPlugin(app: FastifyInstance) {
  await app.register(fastifyJwt, { secret: env.JWT_SECRET });

  app.decorate("authenticate", async (request: FastifyRequest, _reply: FastifyReply) => {
    const payload = await request.jwtVerify<{ sub: string }>();
    const userId = payload.sub;
    request.currentUser = loadCurrentUser(userId);
  });
}

export function loadCurrentUser(userId: string): CurrentUser {
  const user = db.prepare("SELECT id, username, display_name, status FROM users WHERE id = ?").get(userId) as
    | { id: string; username: string; display_name: string; status: string }
    | undefined;

  if (!user || user.status !== "active") {
    throw new AppError("AUTH_FORBIDDEN", "用户不存在或已禁用", 403);
  }

  const roles = db
    .prepare(
      `SELECT r.code FROM roles r INNER JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.code`
    )
    .all(userId) as Array<{ code: string }>;

  const roleCodes = roles.map((role) => role.code);
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    roles: roleCodes,
    permissions: collectPermissions(roleCodes)
  };
}

export function requireAuth(app: FastifyInstance) {
  return { preHandler: [app.authenticate] };
}

export function requirePermission(app: FastifyInstance, permission: Permission) {
  return {
    preHandler: [
      app.authenticate,
      async (request: FastifyRequest, _reply: FastifyReply) => {
        if (!request.currentUser?.permissions.includes(permission)) {
          throw new AppError("AUTH_FORBIDDEN", "没有执行该操作的权限", 403);
        }
      }
    ]
  };
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
