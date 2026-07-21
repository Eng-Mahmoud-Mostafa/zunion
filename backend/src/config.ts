import "dotenv/config";

function databaseUrl() {
  const value = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (value?.trim()) return value.trim();
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    throw new Error("DATABASE_URL is not configured. Set it to the Supabase PostgreSQL connection string in the server environment.");
  }
  return "postgres://zunion:zunion@localhost:5432/zunion";
}

function requireProductionEmailConfig() {
  if ((process.env.NODE_ENV === "production" || process.env.VERCEL) && !process.env.RESEND_API_KEY && !process.env.SMTP_HOST) {
    throw new Error("Email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL, or configure SMTP_HOST server-side.");
  }
}

requireProductionEmailConfig();

const resendFromEmail = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  appOrigin: process.env.APP_ORIGIN ?? "http://127.0.0.1:5173",
  databaseUrl: databaseUrl(),
  databaseSsl: process.env.DATABASE_SSL === "true" || process.env.PGSSLMODE === "require" || Boolean(process.env.VERCEL),
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY,
  cookieName: process.env.SESSION_COOKIE_NAME ?? "zunion_session",
  cookieSecret: process.env.COOKIE_SECRET ?? "dev-change-me",
  uploadDir: process.env.UPLOAD_DIR ?? (process.env.VERCEL ? "/tmp/uploads" : "uploads"),
  otpDevMode: process.env.OTP_DEV_MODE === "true",
  resend: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM ?? `Zunion <${resendFromEmail}>`,
    fromEmail: resendFromEmail,
    passwordChangeEmail: process.env.PASSWORD_CHANGE_EMAIL ?? "mahmoud_foly@icloud.com",
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM ?? "Zunion <no-reply@zunion.local>",
  },
};

export const roleByEmail = {
  "mahmoudmostafa3104@gmail.com": "Master",
  "mahmoudelwensh2007@gmail.com": "Helper",
  "mahmoudodo20072021@gmail.com": "Worker",
  "mahmoud.foly.2007@gmail.com": "Finish",
} as const;

export type UserRole = string;
export type UserEmail = keyof typeof roleByEmail;
