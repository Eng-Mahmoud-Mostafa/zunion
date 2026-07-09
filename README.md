# Zunion Order System

Arabic RTL internal system for Zunion order workflow, customers, finance, reports, alerts, Excel import/export, printable order sheets, and role-based access.

## Localhost

```powershell
cd C:\Users\DELL\Documents\zunion
npm install
npm run local
```

Open:

```text
http://127.0.0.1:5195/
```

For local testing, `VITE_USE_SERVER_AUTH=false` uses the built-in seeded username/password users. This keeps the app working even when no backend is running.

Default local login:

```text
mahmoud / 1234
```

## Production Auth

For Vercel, set:

```text
VITE_USE_SERVER_AUTH=true
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_SECRET_KEY=sb_secret_...
RESEND_API_KEY=...
RESEND_FROM_EMAIL=onboarding@resend.dev
PASSWORD_CHANGE_EMAIL=mahmoud_foly@icloud.com
OTP_PEPPER=long-random-secret
OTP_DEV_MODE=false
```

Only these emails are allowed:

```text
mahmoudmostafa3104@gmail.com / Master
mahmoudelwensh2007@gmail.com / Helper
mahmoudodo20072021@gmail.com / Worker
mahmoud.foly.2007@gmail.com / Finish
```

The Resend API key, Supabase service-role key, and Supabase secret key are used only by Vercel API routes under `/api/auth/*`. They must never be added as `VITE_` variables.

## Supabase Setup

1. Open Supabase SQL editor.
2. Run `supabase/schema.sql`.
3. Confirm the private storage bucket `order-files` exists.
4. In Vercel, add all production environment variables above.
5. Redeploy.

The official uploaded logo is stored at `src/assets/logo.png` and used by the login page, sidebar, and generated Vite bundle. The browser favicon uses `public/favicon.png`.

## Features

- Dashboard styled after the provided Zunion screenshots
- Right-side Arabic RTL sidebar
- Orders table with search, filters, edit, delete, status updates, sticky header, and pagination
- Multi-product order form with automatic totals
- Print option for each order
- Workflow queues for التشغيل and التشطيب
- Delivery alerts for today, tomorrow, overdue, ready-not-messaged, balances, and stuck orders
- Customer creation and customer accounts
- Expenses and incomes screen with monthly summary
- Reports page
- Excel import and export through SheetJS/xlsx
- Local file preview validation for images/PDFs
- Supabase schema with RLS and private storage policies
- Vercel API OTP flow using Resend

## Build

```powershell
npm run build
```

## Vercel

This repo is configured for Vercel Services:

- `frontend`: root project, Vite, mounted at `/`
- `backend`: `backend/`, mounted at `/api`

In Vercel Project Settings, set Framework Preset to `Services`, then redeploy. Do not deploy it as Next.js.
