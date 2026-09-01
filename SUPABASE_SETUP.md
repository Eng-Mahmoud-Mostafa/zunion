# Zunion — New Supabase Setup

This app no longer depends on the old Supabase project. Below is everything you need
to wire up a **brand-new** Supabase project. No old URLs, keys or schema are required.

---

## 1. What the app needs from you (4 values)

Create a new project at <https://supabase.com/dashboard> and copy these 4 values:

| Value | Where to find it (new project) | Used by |
|---|---|---|
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | Dashboard → Project Settings → API → **Project URL** | browser + backend |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API → **Publishable key** (new format `sb_publishable_...`) | browser (dashboard reads) |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → **Service role key** (`sb_secret_...`) | backend REST (users/roles/transactions) |
| `DATABASE_URL` | Project Settings → Database → Connection string, modern pooler format `postgresql://postgres.<ref>:<PASSWORD>@db.<ref>.supabase.co:5432/postgres` (or same host with user `postgres`) | backend direct SQL |

> `VITE_SUPABASE_ANON_KEY` (legacy `eyJ...` anon key) is still accepted as a fallback if the
> publishable key is not present. If you only have the anon key, set
> `VITE_SUPABASE_ANON_KEY` instead.

These are copied into:

- **Browser** (`.env`, safe — publishable/anon only):
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`).
- **Backend** (`backend/.env`, secret — never expose in the browser):
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (fallback `SUPABASE_SECRET_KEY`),
  `DATABASE_URL`, `DATABASE_SSL=true`.

See `.env.example` and `backend/.env.example` for the full list (SMTP/Resend, OTP,
cookie secret, upload dir, port, origin).

> Tip: an `.env` at the repo root is read by Vite; the backend loads `backend/.env`.

---

## 2. Create the schema

You have two options; **option B is the recommended one** for a fresh project.

### Option A — SQL editor (one paste)

1. Open the new project → **SQL Editor → New query**.
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) and run it.
3. Run it a second time to confirm it is idempotent (all statements are guarded —
   `create table if not exists`, `add column if not exists`, `drop policy if exists`).

### Option B — from the backend (recommended)

```sh
cd backend
npm run db:migrate      # applies backend/src/db/001_init.sql via DATABASE_URL
npm run seed:users      # strict: creates the 14 default users (fails if any exist)
```

`npm run db:migrate` is idempotent and is the same path the backend runs on boot
(`ensureSchema`). `supabase/schema.sql` is **generated** from `001_init.sql`
(`backend/scripts/generate-supabase-schema.mjs`) and adds only the `set search_path`
header, the anon SELECT policies and the `order-files` storage bucket — you should not
hand-edit it.

If any file uploads should live in Supabase Storage instead of the local `UPLOAD_DIR`,
the `order-files` bucket and its `authenticated` policies are already in the file.

---

## 3. Default users

`npm run db:migrate` + `npm run seed:users` create 14 usernames
(`seedUsers` from `backend/src/seeds.ts`) with password `1234`.

- In development, `OTP_DEV_MODE=true` lets you log in with any username + `1234`.
- On first login after seeding, the backend rotates each user's password hash to
  `1234` (see `npm run seed:users`), so the seeded value works.
- After go-live, delete or disable the demo rows and set real passwords via the
  dashboard (Admin → Users), or run `backend/scripts/reset-all-passwords.ts`.

Change these secrets before production:
- `COOKIE_SECRET` / `OTP_PEPPER` in `backend/.env` (and root `.env`).
- The `users_profile` seed in `backend/src/db/001_init.sql` encodes passwords with the
  default `dev-change-me` cookie secret — the runtime re-hashes to the real secret on
  first login.
- The Resend/SMTP `RESEND_FROM_EMAIL` (`onboarding@resend.dev`) is dev-only.

---

## 4. Row-level security (summary)

RLS is enabled on **every** table. The backend connects as the table owner (direct SQL)
or the `service_role` (REST), both of which bypass RLS — server queries are unaffected.

The Browser (publishable/anon key) is only allowed to read, for the dashboard
(`src/services/statsService.ts`):

- `orders` — `anon read orders` (SELECT)
- `transactions` — `anon read transactions` (SELECT)

Everything else (`users_profile`, `roles`, `password_reset_codes`, sessions, audit,
order_files, customers, …) is revoked from `anon`/`authenticated` and needs the
service-role/postgres role. If you later open any other table to the browser, create a
policy in [the RLS block of `001_init.sql`](backend/src/db/001_init.sql) and regenerate
`schema.sql`:

```sh
cd backend
node scripts/generate-supabase-schema.mjs
```

---

## 5. First run / smoke test

With the 4 values in place and the schema applied:

```sh
cd backend && npm run dev        # API on :4000 (see APP_ORIGIN / PORT)
# in another terminal:
npm run dev                      # Vite on http://127.0.0.1:5173
```

Sanity checks:

- `GET /api/health` returns ok and the DB round-trip succeeds.
- Log in with a seeded user (`1234`) — OTP/SMS routes work in `OTP_DEV_MODE`.
- Dashboard home/finance/reports load — they read `orders` + `transactions` with the
  publishable key (if Supabase is not configured, the frontend falls back to local data
  instead of erroring).
- Create an order → it persists in `orders` via the backend and appears on the dashboard.

## 6. Notes / known limits

- With Supabase absent of the env values, the frontend skips remote reads
  (`supabase` is `null` in `src/lib/supabase.ts`); the UI then uses local
  storage/backend-only data.
- The dashboard's "آخر الأوردرات" panel reads legacy column names
  (`orderClientName`, `orderParty`, `delivery_status`); those don't exist on the modern
  `orders` table (which uses `customer_name_snapshot`, `party`, `work_stage`), so names
  may render as `-`. Order counts and statuses still work. Fixing the dashboard to use
  the backend endpoints is an optional follow-up.