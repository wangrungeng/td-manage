import { AppError, maskSecret } from "../../utils/errors.js";
import type { ConnectionRecord } from "../connections/connection.service.js";

type TdengineClient = {
  query: (sql: string) => Promise<unknown>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

type RawRows = {
  getMeta: () => Array<{ name: string; type: string; length: number }> | null;
  next: () => Promise<boolean>;
  getData: () => unknown[];
  close: () => Promise<void>;
};

type RawSqlClient = {
  query: (sql: string) => Promise<RawRows>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

type TdengineConnector = {
  WSConfig: new (url: string) => {
    setUser: (user: string) => void;
    setPwd: (password: string) => void;
    setDb: (database: string) => void;
    setTimeOut: (timeout: number) => void;
    setUserApp?: (name: string) => void;
    setTimezone?: (timezone: string) => void;
  };
  sqlConnect: (config: unknown) => Promise<RawSqlClient>;
  connectorDestroy?: () => void;
};

let cachedConnector: TdengineConnector | null = null;

async function loadConnector(): Promise<TdengineConnector> {
  if (cachedConnector) {
    return cachedConnector;
  }

  try {
    const mod = await import("@tdengine/websocket");
    const connector = (mod.default ?? mod) as TdengineConnector;
    if (!connector?.WSConfig || !connector?.sqlConnect) {
      throw new Error("TDengine WebSocket 客户端缺少 WSConfig 或 sqlConnect 方法");
    }
    cachedConnector = connector;
    return connector;
  } catch (error) {
    throw new AppError(
      "TDENGINE_CLIENT_UNAVAILABLE",
      "TDengine 客户端依赖不可用，请先安装依赖",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export function destroyTdengineConnector() {
  cachedConnector?.connectorDestroy?.();
  cachedConnector = null;
}

export async function withTdengineConnection<T>(
  connection: ConnectionRecord,
  password: string,
  handler: (client: TdengineClient) => Promise<T>
) {
  const connector = await loadConnector();
  const config = new connector.WSConfig(`${connection.protocol}://${connection.host}:${connection.port}`);
  config.setUser(connection.username);
  config.setPwd(password);
  config.setTimeOut(connection.connect_timeout_ms);
  config.setUserApp?.("td-manage");
  if (connection.timezone) {
    config.setTimezone?.(connection.timezone);
  }
  if (connection.default_database) {
    config.setDb(connection.default_database);
  }
  const rawClient = await connector.sqlConnect(config);
  const client: TdengineClient = {
    query: async (sql: string) => rowsToObjects(await rawClient.query(sql)),
    exec: async (sql: string) => rawClient.exec(sql),
    close: async () => rawClient.close()
  };

  try {
    return await handler(client);
  } catch (error) {
    throw new AppError(
      "TDENGINE_QUERY_FAILED",
      "TDengine 执行失败",
      400,
      maskSecret(error instanceof Error ? error.message : String(error))
    );
  } finally {
    await client.close();
  }
}

export async function testTdengineConnection(connection: ConnectionRecord, password: string) {
  return withTdengineConnection({ ...connection, default_database: null }, password, async (client) => {
    const result = await client.query("SHOW DATABASES");
    return { ok: true, result };
  });
}

export function normalizeQueryResult(result: unknown) {
  if (Array.isArray(result)) {
    return result;
  }
  if (result && typeof result === "object") {
    const objectResult = result as { data?: unknown[]; rows?: unknown[] };
    if (Array.isArray(objectResult.data)) {
      return objectResult.data;
    }
    if (Array.isArray(objectResult.rows)) {
      return objectResult.rows;
    }
  }
  return [];
}

async function rowsToObjects(rows: RawRows) {
  const meta = rows.getMeta() ?? [];
  const items: Record<string, unknown>[] = [];
  try {
    while (await rows.next()) {
      const data = rows.getData();
      const item: Record<string, unknown> = {};
      data.forEach((value, index) => {
        item[meta[index]?.name ?? `column_${index + 1}`] = typeof value === "bigint" ? value.toString() : value;
      });
      items.push(item);
    }
  } finally {
    await rows.close();
  }
  return items;
}
