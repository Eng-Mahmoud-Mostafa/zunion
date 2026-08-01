import { Pool, type QueryResultRow } from "pg";
import { config, databaseConfigured } from "./config.js";

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not set. Database-backed features are unavailable until it is configured.");
    this.name = "DatabaseNotConfiguredError";
  }
}

const pool = databaseConfigured
  ? new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    })
  : null;

export function databaseAvailable() {
  return Boolean(pool);
}

export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
  if (!pool) throw new DatabaseNotConfiguredError();
  return pool.query<T>(sql, params);
}

export async function tx<T>(fn: (client: import("pg").PoolClient) => Promise<T>) {
  if (!pool) throw new DatabaseNotConfiguredError();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
