import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config, type UserRole } from "./config.js";
import { query } from "./db.js";

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function otpCode() {
  return String(crypto.randomInt(100000, 999999));
}

export function hashSecret(secret: string) {
  return crypto.createHmac("sha256", config.cookieSecret).update(secret).digest("hex");
}

export function nextTokenVersion(current?: number | null) {
  return Math.max((current ?? 0) + 1, Math.floor(Date.now() / 1000));
}

export type AppSession = {
  email?: string;
  username?: string;
  fullName?: string;
  role?: string;
  mustChangePassword?: boolean;
  tokenVersion?: number;
  permissions?: string[];
  loggedInAt?: string;
  expiresAt?: string;
};

export function signAppSession(session: AppSession) {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", config.cookieSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyAppSession(raw: string): AppSession | null {
  if (!raw || typeof raw !== "string") return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;
  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const expected = crypto.createHmac("sha256", config.cookieSecret).update(payload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AppSession;
  } catch {
    return null;
  }
}

export function appSessionLive(session: AppSession | null): session is AppSession {
  return Boolean(session && session.expiresAt && new Date(session.expiresAt).getTime() > Date.now());
}

export async function audit(user: AuthUser | null, action: string, entityType: string, entityId?: string, oldValue?: unknown, newValue?: unknown) {
  await query(
    `insert into audit_logs (user_id, user_email, user_role, action, entity_type, entity_id, old_value_json, new_value_json)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [user?.id ?? null, user?.email ?? null, user?.role ?? null, action, entityType, entityId ?? null, oldValue ?? null, newValue ?? null],
  );
}

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const APP_SESSION_COOKIE = "zunion_app_session";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const raw = req.cookies?.[APP_SESSION_COOKIE];
  const session = typeof raw === "string" ? verifyAppSession(raw) : null;
  if (!appSessionLive(session)) return res.status(401).json({ message: "Unauthorized" });

  const email = session.email || `${session.username || "user"}@zunion.local`;
  const role = session.role || "Worker";
  try {
    const { rows } = await query<AuthUser & { token_version: number }>(
      `insert into users (email, role, username, full_name)
       values ($1,$2,$3,$4)
       on conflict (email) do update set
         role = users.role,
         username = coalesce(users.username, excluded.username),
         full_name = coalesce(users.full_name, excluded.full_name)
       returning id, email, role, token_version`,
      [email, role, session.username ?? null, session.fullName ?? null],
    );
    const row = rows[0];
    if (!row) return res.status(401).json({ message: "Unauthorized" });
    if (Number(session.tokenVersion ?? 0) < Number(row.token_version ?? 0)) {
      return res.status(401).json({ message: "انتهت الجلسة. سجل الدخول مرة أخرى" });
    }
    req.user = { id: row.id, email: row.email, role: row.role };
    return next();
  } catch {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ message: "Forbidden" });
    return next();
  };
}

export function canSeeFinancials(role: UserRole) {
  return role === "Master" || role === "Helper";
}
