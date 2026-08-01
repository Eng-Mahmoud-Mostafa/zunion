import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { config, databaseConfigured } from "./config.js";

if (!databaseConfigured) {
  console.error("Cannot migrate: DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(here, "db", "001_init.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

await pool.query(sql);
await pool.end();
console.log("Database migrated and seeded.");
