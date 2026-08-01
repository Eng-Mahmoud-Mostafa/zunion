import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "..", "..");

function loadEnv(file: string) {
  const path = resolve(root, file);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

loadEnv(".env");
loadEnv("backend/.env");

const NEW_PASSWORD = "1234";
const dryRun = process.argv.includes("--dry-run");

function hmacHex(secret: string, data: string) {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

function passwordHash(password: string, salt: string, secret: string) {
  return hmacHex(secret, `${salt}:${password}`);
}

async function supabaseRest<T>(url: string, key: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase ${init.method ?? "GET"} ${path} -> ${response.status}: ${details || response.statusText}`);
  }
  return response.status === 204 ? ([] as T) : (response.json() as Promise<T>);
}

type ProfileUser = {
  id: string;
  username?: string;
  email?: string;
  role?: string;
  is_active?: boolean;
  password_hash?: string;
  password_salt?: string;
};

async function resetSupabase(url: string, key: string, secret: string) {
  const users = await supabaseRest<ProfileUser[]>(url, key, "users_profile?select=id,username,email,role,is_active,password_hash,password_salt&order=created_at");
  const tokenVersion = Math.floor(Date.now() / 1000);
  const updated: Array<{ username: string; email: string; role: string }> = [];
  for (const user of users) {
    const salt = crypto.randomBytes(12).toString("base64url");
    const hash = passwordHash(NEW_PASSWORD, salt, secret);
    updated.push({
      username: user.username ?? user.id,
      email: user.email ?? "",
      role: user.role ?? "",
    });
    if (dryRun) {
      console.log(`  [dry-run] would reset ${user.username ?? user.id} (${user.email ?? "no email"})`);
      continue;
    }
    await supabaseRest(url, key, `users_profile?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        password_salt: salt,
        password_hash: hash,
        must_change_password: false,
        token_version: tokenVersion,
      }),
    });
    console.log(`  [ok] reset ${user.username ?? user.id} (${user.email ?? "no email"})`);
  }
  return updated;
}

async function resetLocal(databaseUrl: string, secret: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false });
  try {
    const { rows } = await pool.query<{ id: string; username: string | null; email: string | null; password_hash: string | null }>(
      `select id, username, email, password_hash from users order by created_at`,
    );
    const tokenVersion = Math.floor(Date.now() / 1000);
    for (const row of rows) {
      const salt = crypto.randomBytes(12).toString("base64url");
      const hash = passwordHash(NEW_PASSWORD, salt, secret);
      if (dryRun) {
        console.log(`  [dry-run] would reset local user ${row.username ?? row.email}`);
        continue;
      }
      await pool.query(
        `update users set password_salt=$1, password_hash=$2, must_change_password=false, token_version=$3 where id=$4`,
        [salt, hash, tokenVersion, row.id],
      );
      console.log(`  [ok] reset local user ${row.username ?? row.email}`);
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const cookieSecret = process.env.COOKIE_SECRET ?? "dev-change-me";
  const databaseUrl = process.env.DATABASE_URL;

  if (dryRun) console.log(`Running in DRY-RUN mode — nothing will be written.\n`);
  console.log(`Hashing scheme: HMAC-SHA256(cookieSecret, "<salt>:${NEW_PASSWORD}")`);
  console.log(`cookieSecret source: ${process.env.COOKIE_SECRET ? "environment/backend/.env" : "fallback dev-change-me"}\n`);

  if (supabaseUrl && supabaseKey) {
    console.log(`Supabase: ${supabaseUrl}`);
    const users = await resetSupabase(supabaseUrl, supabaseKey, cookieSecret);
    console.log(`  ${users.length} user(s) in users_profile.\n`);
  } else {
    console.log("Supabase credentials not found (SUPABASE_URL + SERVICE_ROLE/SECRET key). Skipping users_profile.\n");
  }

  if (databaseUrl) {
    console.log(`Local database: ${databaseUrl.replace(/:[^:@/]+@/, ":***@")}`);
    await resetLocal(databaseUrl, cookieSecret);
    console.log("  done.\n");
  } else {
    console.log("DATABASE_URL not found. Skipping local users table.\n");
  }

  if (dryRun) console.log("Dry-run complete. Re-run without --dry-run to apply.");
}

main().catch((error) => {
  console.error("\nReset failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
