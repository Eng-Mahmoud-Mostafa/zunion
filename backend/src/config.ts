import "dotenv/config";

const databaseUrlValue = (process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "").trim();
export const databaseConfigured = Boolean(databaseUrlValue);

const resendApiKey = process.env.RESEND_API_KEY ?? "";
const resendFromEmail = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  appOrigin: process.env.APP_ORIGIN ?? "http://127.0.0.1:5173",
  databaseUrl: databaseUrlValue,
  databaseConfigured,
  databaseSsl: process.env.DATABASE_SSL === "true" || process.env.PGSSLMODE === "require" || Boolean(process.env.VERCEL),
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY,
  cookieSecret: process.env.COOKIE_SECRET ?? "dev-change-me",
  uploadDir: process.env.UPLOAD_DIR ?? (process.env.VERCEL ? "/tmp/uploads" : "uploads"),
  otpDevMode: process.env.OTP_DEV_MODE === "true",
  resend: {
    apiKey: resendApiKey,
    from: process.env.RESEND_FROM ?? `Zunion <${resendFromEmail}>`,
    fromEmail: resendFromEmail,
    passwordChangeEmail: process.env.PASSWORD_CHANGE_EMAIL ?? "mahmoudmostafa3104@gmail.com",
  },
};

if (!databaseConfigured) {
  console.warn("[config] DATABASE_URL (or POSTGRES_URL) is not set. The server will boot, but database-backed routes (auth sessions, orders, users, ...) will return errors until it is configured. Used by backend/src/db.ts (pg Pool).");
}
if (!resendApiKey) {
  console.warn("[config] RESEND_API_KEY is not set. Password-reset and verification emails are disabled; forgot-password returns a clear error. The email service is only initialized when sending. Used by backend/src/email.ts.");
}

export type UserRole = string;
