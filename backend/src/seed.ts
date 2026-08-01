import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "./config.js";
import { nextTokenVersion } from "./security.js";
import { SEED_USERS, SEED_PASSWORD } from "./seeds.js";

function loadEnv(file: string) {
  const path = resolve(root(), file);
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

function root() {
  return resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
}

loadEnv(".env");
loadEnv("backend/.env");

export type SeedOptions = {
  forcePassword?: boolean;
  dryRun?: boolean;
};

export function seedPasswordHash(password: string, salt: string) {
  return crypto.createHmac("sha256", config.cookieSecret).update(`${salt}:${password}`).digest("hex");
}

const BOOTSTRAP_SECRET = "dev-change-me";

function isBootstrapHash(salt: string | undefined, hash: string | undefined) {
  if (!salt || !hash) return true;
  return hash === crypto.createHmac("sha256", BOOTSTRAP_SECRET).update(`${salt}:${SEED_PASSWORD}`).digest("hex");
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

async function seedSupabase(force: boolean, dryRun: boolean, log: (msg: string) => void) {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    log("  Supabase not configured (SUPABASE_URL + service role key). Skipping users_profile.");
    return;
  }
  log(`  Supabase: ${url}`);
  const tokenVersion = nextTokenVersion();
  for (const user of SEED_USERS) {
    const existing = await supabaseRest<ProfileUser[]>(url, key, `users_profile?username=eq.${encodeURIComponent(user.username)}&select=id,username,email,role,is_active,password_hash,password_salt`);
    const current = existing[0];
    if (current) {
      const needsPassword = force || isBootstrapHash(current.password_salt, current.password_hash);
      if (!needsPassword) {
        log(`  [skip] ${user.username} (${user.email}) - already exists, password kept`);
        if (!dryRun) {
          await supabaseRest(url, key, `users_profile?id=eq.${encodeURIComponent(current.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ role: user.role, full_name: user.full_name, email: user.email, must_change_password: false, is_active: true }),
          });
        }
      } else {
        const salt = crypto.randomBytes(12).toString("base64url");
        const hash = seedPasswordHash(SEED_PASSWORD, salt);
        const reason = isBootstrapHash(current.password_salt, current.password_hash) ? "bootstrap hash replaced" : "password reset";
        log(`  [${dryRun ? "dry-run would update" : "ok"}] ${user.username} (${user.email}) - role ${user.role}, ${reason} to ${SEED_PASSWORD}`);
        if (!dryRun) {
          await supabaseRest(url, key, `users_profile?id=eq.${encodeURIComponent(current.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ password_salt: salt, password_hash: hash, must_change_password: false, is_active: true, token_version: tokenVersion }),
          });
        }
      }
    } else {
      const salt = crypto.randomBytes(12).toString("base64url");
      const hash = seedPasswordHash(SEED_PASSWORD, salt);
      log(`  [${dryRun ? "dry-run would create" : "ok"}] ${user.username} (${user.email}) - role ${user.role}, password ${SEED_PASSWORD}`);
      if (!dryRun) {
        await supabaseRest(url, key, "users_profile", {
          method: "POST",
          body: JSON.stringify([{
            username: user.username,
            full_name: user.full_name,
            email: user.email,
            role: user.role,
            password_salt: salt,
            password_hash: hash,
            must_change_password: false,
            is_active: true,
            token_version: tokenVersion,
          }]),
        });
      }
    }
  }
}

async function seedLocal(force: boolean, dryRun: boolean, log: (msg: string) => void) {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!databaseUrl) {
    log("  DATABASE_URL not set. Skipping local users table.");
    return;
  }
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  });
  try {
    log(`  Local database: ${databaseUrl.replace(/:[^:@/]+@/, ":***@")}`);
    const tokenVersion = nextTokenVersion();
    for (const user of SEED_USERS) {
      const salt = crypto.randomBytes(12).toString("base64url");
      const hash = seedPasswordHash(SEED_PASSWORD, salt);
      const existing = await pool.query<{ id: string; password_hash: string | null; password_salt: string | null }>(
        `select id, password_hash, password_salt from users where lower(username) = lower($1) or lower(email) = lower($2) limit 1`,
        [user.username, user.email],
      );
      const current = existing.rows[0];
      const needsPassword = force || isBootstrapHash(current?.password_salt ?? undefined, current?.password_hash ?? undefined);
      if (current && !needsPassword) {
        log(`  [skip] ${user.username} (${user.email}) - already exists, password kept`);
        if (!dryRun) {
          await pool.query(
            `update users set role=$1, full_name=$2, email=$3, must_change_password=false, is_active=true where id=$4`,
            [user.role, user.full_name, user.email, current.id],
          );
        }
      } else {
        log(`  [${dryRun ? "dry-run would " : ""}${current ? "update" : "create"}] ${user.username} (${user.email}) - role ${user.role}, password ${SEED_PASSWORD}`);
        if (!dryRun) {
          await pool.query(
            `insert into users (email, role, username, full_name, password_salt, password_hash, must_change_password, token_version)
             values ($1,$2,$3,$4,$5,$6,false,$7)
             on conflict (email) do update set
               role = excluded.role, username = coalesce(nullif(excluded.username, ''), users.username),
               full_name = coalesce(excluded.full_name, users.full_name),
               password_salt = excluded.password_salt, password_hash = excluded.password_hash,
               must_change_password = false, is_active = true, token_version = excluded.token_version`,
            [user.email, user.role, user.username, user.full_name, salt, hash, tokenVersion],
          );
        }
      }
    }
  } finally {
    await pool.end();
  }
}

export async function ensureSeededUsers(options: SeedOptions = {}, log: (msg: string) => void = console.log) {
  const { forcePassword = false, dryRun = false } = options;
  const title = dryRun ? "DRY-RUN — nothing will be written" : forcePassword ? "FORCE — existing passwords will be reset" : "CREATE-IF-MISSING — existing passwords kept";
  log(`Seeding ${SEED_USERS.length} users (${title})`);
  log(`Hashing: HMAC-SHA256(cookieSecret, "<salt>:${SEED_PASSWORD}")`);
  log(`cookieSecret source: ${process.env.COOKIE_SECRET ? "environment/backend/.env" : "default 'dev-change-me'"}`);
  log("");
  if (dryRun) {
    for (const user of SEED_USERS) log(`  [dry-run] would ensure ${user.username} (${user.email}) role ${user.role}`);
    log("");
    return;
  }
  try {
    await seedSupabase(forcePassword, dryRun, log);
  } catch (error) {
    log(`  Supabase seeding failed: ${error instanceof Error ? error.message : error}`);
  }
  log("");
  try {
    await seedLocal(forcePassword, dryRun, log);
  } catch (error) {
    log(`  Local seeding failed: ${error instanceof Error ? error.message : error}`);
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const dryRun = process.argv.includes("--dry-run");
  await ensureSeededUsers({ forcePassword: force, dryRun });
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error("\nSeeding failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
