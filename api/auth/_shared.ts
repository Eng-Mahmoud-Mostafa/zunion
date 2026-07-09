import { createClient } from "@supabase/supabase-js";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

export type ServerRole = "Master" | "Operator" | "Supervisor" | "Finishing" | "Helper" | "Worker" | "Finish";

export const seededUsers: Record<string, { fullName: string; role: ServerRole; email: string }> = {
  mahmoud: { fullName: "Mahmoud", role: "Master", email: "mahmoud@zunion.local" },
  reda: { fullName: "Reda", role: "Master", email: "reda@zunion.local" },
  hassan: { fullName: "Hassan", role: "Master", email: "hassan@zunion.local" },
  omar: { fullName: "Omar", role: "Operator", email: "omar@zunion.local" },
  youssef: { fullName: "Youssef", role: "Operator", email: "youssef@zunion.local" },
  khalifa: { fullName: "Khalifa", role: "Operator", email: "khalifa@zunion.local" },
  "opr 1": { fullName: "Opr 1", role: "Operator", email: "opr1@zunion.local" },
  "opr 2": { fullName: "Opr 2", role: "Operator", email: "opr2@zunion.local" },
  "opr 3": { fullName: "Opr 3", role: "Operator", email: "opr3@zunion.local" },
  "supervisor 1": { fullName: "Supervisor 1", role: "Supervisor", email: "supervisor1@zunion.local" },
  "supervisor 2": { fullName: "Supervisor 2", role: "Supervisor", email: "supervisor2@zunion.local" },
  "supervisor 3": { fullName: "Supervisor 3", role: "Supervisor", email: "supervisor3@zunion.local" },
  "finishing 1": { fullName: "Finishing 1", role: "Finishing", email: "finishing1@zunion.local" },
  "finishing 2": { fullName: "Finishing 2", role: "Finishing", email: "finishing2@zunion.local" },
};

export const allowedUsers: Record<string, ServerRole> = {
  "mahmoudmostafa3104@gmail.com": "Master",
  "mahmoud_foly@icloud.com": "Master",
};

export function normalizeEmail(email: unknown) {
  return String(email || "").trim().toLowerCase();
}

export function getRole(email: string) {
  return allowedUsers[email];
}

export function generateOtp() {
  return String(randomInt(100000, 1000000));
}

export function hashOtp(email: string, otp: string) {
  const pepper = process.env.OTP_PEPPER || process.env.RESEND_API_KEY || "local-dev";
  return createHash("sha256").update(`${email}:${otp}:${pepper}`).digest("hex");
}

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase server environment is missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function sendOtpEmail(email: string, otp: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");

  const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
  const from = process.env.RESEND_FROM || `Zunion <${fromEmail}>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: "كود الدخول إلى نظام Zunion",
      html: `
        <div dir="rtl" style="font-family:Arial,Tahoma,sans-serif;line-height:1.7">
          <h2 style="color:#d60000">Zunion</h2>
          <p>كود الدخول الخاص بك هو:</p>
          <p style="font-size:28px;font-weight:700;letter-spacing:4px">${otp}</p>
          <p>ينتهي هذا الكود خلال 10 دقائق.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    await response.text();
    throw new Error("تعذر إرسال كود التحقق. تأكد من إعدادات Resend أو أضف دومين موثق.");
  }
}

export function createSession(email: string, role: string, stayLoggedIn: boolean, username?: string, fullName?: string) {
  const expiresAt = new Date(Date.now() + (stayLoggedIn ? 14 * 24 : 8) * 60 * 60 * 1000).toISOString();
  return {
    id: randomUUID(),
    email,
    username,
    fullName,
    role,
    loggedInAt: new Date().toISOString(),
    expiresAt,
  };
}

export function normalizeUsername(username: unknown) {
  return String(username || "").trim().toLowerCase();
}

export function hashPassword(password: string, salt: string) {
  return createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

export function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function setSessionCookie(res: any, token: string, expiresAt: string) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  res.setHeader("Set-Cookie", [
    `zunion_session=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`,
  ]);
}

export function methodGuard(req: any, res: any, method = "POST") {
  if (req.method === method) return false;
  res.setHeader("Allow", method);
  res.status(405).json({ error: "Method not allowed" });
  return true;
}
