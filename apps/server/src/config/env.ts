import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const sqlitePath = process.env.SQLITE_PATH ?? "./data/td-manage.sqlite";
const secretDir = path.dirname(path.resolve(process.cwd(), sqlitePath));

function loadLocalSecret(fileName: string, envValue?: string) {
  if (envValue) {
    return envValue;
  }

  fs.mkdirSync(secretDir, { recursive: true });
  const secretPath = path.join(secretDir, fileName);
  if (fs.existsSync(secretPath)) {
    return fs.readFileSync(secretPath, "utf8").trim();
  }

  const secret = randomBytes(32).toString("hex");
  fs.writeFileSync(secretPath, secret, { encoding: "utf8", flag: "wx" });
  return secret;
}

const envSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(8718),
  SQLITE_PATH: z.string().default("./data/td-manage.sqlite"),
  JWT_SECRET: z.string().min(32),
  APP_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().default("http://127.0.0.1:5173")
});

export const env = envSchema.parse({
  ...process.env,
  SQLITE_PATH: sqlitePath,
  JWT_SECRET: loadLocalSecret("jwt.secret", process.env.JWT_SECRET),
  APP_SECRET: loadLocalSecret("app.secret", process.env.APP_SECRET)
});
