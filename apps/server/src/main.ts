import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { initDatabase } from "./db/database.js";
import { registerAuthPlugin } from "./plugins/auth.js";
import { registerAuditRoutes } from "./modules/audit/audit.routes.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { registerConnectionRoutes } from "./modules/connections/connections.routes.js";
import { registerSqlScriptRoutes } from "./modules/sql-scripts/sql-scripts.routes.js";
import { destroyTdengineConnector } from "./modules/tdengine/tdengine.client.js";
import { registerTdengineRoutes } from "./modules/tdengine/tdengine.routes.js";
import { registerUserRoutes } from "./modules/users/users.routes.js";
import { sendError } from "./utils/errors.js";

initDatabase();

const app = Fastify({
  logger: true,
  genReqId: () => randomUUID()
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  return sendError(reply, error, request.id);
});

await app.register(cors, {
  origin: env.CORS_ORIGIN,
  credentials: true
});

await registerAuthPlugin(app);

await app.register(async (api) => {
  await registerAuthRoutes(api);
  await registerUserRoutes(api);
  await registerConnectionRoutes(api);
  await registerTdengineRoutes(api);
  await registerSqlScriptRoutes(api);
  await registerAuditRoutes(api);
}, { prefix: "/api" });

app.get("/health", async () => ({ ok: true, service: "td-manage-server" }));

app.addHook("onClose", async () => {
  destroyTdengineConnector();
});

await app.listen({ host: env.HOST, port: env.PORT });
