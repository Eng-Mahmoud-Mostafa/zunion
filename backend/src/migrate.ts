import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(here, "db", "001_init.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

await pool.query(sql);
await pool.end();
console.log("Database migrated and seeded.");
