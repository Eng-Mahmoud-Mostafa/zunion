import { query, databaseAvailable } from "./db.js";
import { schemaSql } from "./schema.js";

/**
 * Applies the idempotent schema (001_init.sql) when the backend database is
 * missing it. Safe to run on every boot: it short-circuits with a single
 * cheap catalog check once the schema exists, and the SQL itself is written
 * with IF NOT EXISTS / add column if not exists so it never destroys data.
 */
export async function ensureSchema(log: (msg: string) => void = console.log) {
  if (!databaseAvailable()) {
    log("[schema] DATABASE_URL not set; skipping schema bootstrap.");
    return;
  }
  try {
    const { rows } = await query<{ t: unknown }>(`select to_regclass('public.users') as t`);
    if (rows[0]?.t) return;
    log("[schema] public.users missing — applying 001_init.sql...");
    await query(schemaSql);
    log("[schema] 001_init.sql applied.");
  } catch (error) {
    log(`[schema] bootstrap failed: ${error instanceof Error ? error.message : error}`);
  }
}
