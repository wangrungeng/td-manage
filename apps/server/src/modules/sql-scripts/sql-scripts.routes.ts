import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/database.js";
import { requirePermission } from "../../plugins/auth.js";
import { AppError } from "../../utils/errors.js";
import { createId } from "../../utils/ids.js";

const folderCreateSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

const folderUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

const scriptCreateSchema = z.object({
  folderId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  sql: z.string().default("")
});

const scriptUpdateSchema = z.object({
  folderId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  sql: z.string().optional()
});

const idParamsSchema = z.object({ id: z.string().trim().min(1) });

export async function registerSqlScriptRoutes(app: FastifyInstance) {
  app.get("/sql-scripts/library", requirePermission(app, "tdengine:sql:execute"), async (request) => {
    ensureDefaultFolder(request.currentUser!.id);
    return loadLibrary(request.currentUser!.id);
  });

  app.post("/sql-scripts/folders", requirePermission(app, "tdengine:sql:execute"), async (request) => {
    const body = folderCreateSchema.parse(request.body);
    const now = new Date().toISOString();
    const id = createId("sql_folder");
    db.prepare(`
      INSERT INTO sql_script_folders (id, user_id, name, sort_order, created_at, updated_at)
      VALUES (@id, @user_id, @name, @sort_order, @created_at, @updated_at)
    `).run({
      id,
      user_id: request.currentUser!.id,
      name: body.name,
      sort_order: Date.now(),
      created_at: now,
      updated_at: now
    });
    return loadFolder(request.currentUser!.id, id);
  });

  app.patch("/sql-scripts/folders/:id", requirePermission(app, "tdengine:sql:execute"), async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = folderUpdateSchema.parse(request.body);
    const result = db.prepare(`
      UPDATE sql_script_folders
      SET name = @name, updated_at = @updated_at
      WHERE id = @id AND user_id = @user_id
    `).run({ id: params.id, user_id: request.currentUser!.id, name: body.name, updated_at: new Date().toISOString() });
    if (!result.changes) {
      throw new AppError("SQL_FOLDER_NOT_FOUND", "SQL 脚本文件夹不存在", 404);
    }
    return loadFolder(request.currentUser!.id, params.id);
  });

  app.post("/sql-scripts/scripts", requirePermission(app, "tdengine:sql:execute"), async (request) => {
    const body = scriptCreateSchema.parse(request.body);
    ensureFolderExists(request.currentUser!.id, body.folderId);
    const now = new Date().toISOString();
    const id = createId("sql_script");
    db.prepare(`
      INSERT INTO sql_scripts (id, user_id, folder_id, name, sql_text, created_at, updated_at)
      VALUES (@id, @user_id, @folder_id, @name, @sql_text, @created_at, @updated_at)
    `).run({
      id,
      user_id: request.currentUser!.id,
      folder_id: body.folderId,
      name: body.name,
      sql_text: body.sql,
      created_at: now,
      updated_at: now
    });
    return loadScript(request.currentUser!.id, id);
  });

  app.patch("/sql-scripts/scripts/:id", requirePermission(app, "tdengine:sql:execute"), async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = scriptUpdateSchema.parse(request.body);
    const current = loadScript(request.currentUser!.id, params.id);
    if (!current) {
      throw new AppError("SQL_SCRIPT_NOT_FOUND", "SQL 脚本不存在", 404);
    }
    const folderId = body.folderId ?? current.folderId;
    ensureFolderExists(request.currentUser!.id, folderId);
    const next = {
      id: params.id,
      user_id: request.currentUser!.id,
      folder_id: folderId,
      name: body.name ?? current.name,
      sql_text: body.sql ?? current.sql,
      updated_at: new Date().toISOString()
    };
    db.prepare(`
      UPDATE sql_scripts
      SET folder_id = @folder_id, name = @name, sql_text = @sql_text, updated_at = @updated_at
      WHERE id = @id AND user_id = @user_id
    `).run(next);
    return loadScript(request.currentUser!.id, params.id);
  });
}

function ensureDefaultFolder(userId: string) {
  const count = db.prepare("SELECT COUNT(*) AS total FROM sql_script_folders WHERE user_id = ?").get(userId) as { total: number };
  if (count.total) return;
  const now = new Date().toISOString();
  const folderId = createId("sql_folder");
  db.prepare(`
    INSERT INTO sql_script_folders (id, user_id, name, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(folderId, userId, "默认文件夹", 0, now, now);
  db.prepare(`
    INSERT INTO sql_scripts (id, user_id, folder_id, name, sql_text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    createId("sql_script"),
    userId,
    folderId,
    "最近 100 条",
    "SELECT * FROM `database`.`table` WHERE `ts` >= '2026-01-01 00:00:00' ORDER BY `ts` DESC LIMIT 100",
    now,
    now
  );
}

function loadLibrary(userId: string) {
  const folders = db
    .prepare("SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM sql_script_folders WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC")
    .all(userId);
  const scripts = db
    .prepare("SELECT id, folder_id AS folderId, name, sql_text AS sql, created_at AS createdAt, updated_at AS updatedAt FROM sql_scripts WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId);
  return { folders, scripts };
}

function loadFolder(userId: string, id: string) {
  return db
    .prepare("SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM sql_script_folders WHERE user_id = ? AND id = ?")
    .get(userId, id);
}

function loadScript(userId: string, id: string) {
  return db
    .prepare("SELECT id, folder_id AS folderId, name, sql_text AS sql, created_at AS createdAt, updated_at AS updatedAt FROM sql_scripts WHERE user_id = ? AND id = ?")
    .get(userId, id) as { id: string; folderId: string; name: string; sql: string; createdAt: string; updatedAt: string } | undefined;
}

function ensureFolderExists(userId: string, folderId: string) {
  const folder = loadFolder(userId, folderId);
  if (!folder) {
    throw new AppError("SQL_FOLDER_NOT_FOUND", "SQL 脚本文件夹不存在", 404);
  }
}
