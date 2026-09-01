import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Generates supabase/schema.sql from backend/src/db/001_init.sql.
// 001_init.sql is the single source of truth (applied by npm run db:migrate and
// the backend bootstrap via backend/src/schema.ts). This script wraps it with a
// `set search_path = public` header (so every unqualified object lands in the
// public schema of the new Supabase project) and appends the Supabase-only bits
// (storage bucket + policies) that must not run on plain PostgreSQL.
const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(here, "..", "src", "db", "001_init.sql"), "utf8");

const out = `-- ============================================================================
-- Zunion — Supabase database schema
-- ----------------------------------------------------------------------------
-- GENERATED from backend/src/db/001_init.sql (single source of truth).
-- Do not edit by hand; regenerate with: backend -> node scripts/generate-supabase-schema.mjs
--
-- Target: an EMPTY new Supabase project (Dashboard > SQL Editor, or psql).
-- Idempotent: safe to run more than once; it uses IF NOT EXISTS everywhere.
--
-- Facts:
--  * Login is username-based via public.users_profile (the backend verifies
--    HMAC-SHA256(cookieSecret, "<salt>:<password>") hashes, see backend/src/security.ts).
--  * The backend queries most tables over a direct PostgreSQL connection
--    (DATABASE_URL) and reaches users_profile / roles / password_reset_codes /
--    transactions through the service-role REST API.
--  * RLS is enabled on every table. Only orders + transactions are readable by
--    the 'anon' role (the browser dashboard reads them with the publishable key,
--    see src/services/statsService.ts). Everything else is owner/service-role only.
-- ============================================================================

set search_path = public;

${sql.trim()}

-- ============================================================================
-- Supabase Storage (legacy order-file attachments). Not used by the runtime
-- file upload flow (multer saves to disk), kept for parity/optional use.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('order-files', 'order-files', false)
on conflict (id) do update set public = false;

drop policy if exists "authenticated users can read order files" on storage.objects;
create policy "authenticated users can read order files"
  on storage.objects for select to authenticated
  using (bucket_id = 'order-files');

drop policy if exists "authenticated users can upload order files" on storage.objects;
create policy "authenticated users can upload order files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'order-files');

drop policy if exists "authenticated users can update order files" on storage.objects;
create policy "authenticated users can update order files"
  on storage.objects for update to authenticated
  using (bucket_id = 'order-files')
  with check (bucket_id = 'order-files');

drop policy if exists "authenticated users can delete order files" on storage.objects;
create policy "authenticated users can delete order files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'order-files');
`;

writeFileSync(resolve(here, "..", "..", "supabase", "schema.sql"), out);
console.log("supabase/schema.sql generated from 001_init.sql");