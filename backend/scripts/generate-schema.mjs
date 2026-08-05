import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(here, "..", "src", "db", "001_init.sql"), "utf8");
const escaped = sql.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
const out = `// GENERATED FILE — do not edit by hand.
// Regenerate from the canonical migration with:
//   node scripts/generate-schema.mjs
// Source: src/db/001_init.sql
//
// This module exists so the idempotent schema bootstrap (ensureSchema) is
// bundled by esbuild for the Vercel serverless build, where src/db/001_init.sql
// is not shipped on disk. Keep the .sql as the single source of truth.
export const schemaSql = \`${escaped}\`;
`;
writeFileSync(resolve(here, "..", "src", "schema.ts"), out);
console.log("schema.ts generated from 001_init.sql");
