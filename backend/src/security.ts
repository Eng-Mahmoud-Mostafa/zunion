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

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[config.cookieName];
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  const tokenHash = hashSecret(token);
  const { rows } = await query<AuthUser & { session_id: string }>(
    `select u.id, u.email, u.role, s.id as session_id
     from sessions s
     join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()
     limit 1`,
    [tokenHash],
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ message: "Unauthorized" });
  req.user = { id: user.id, email: user.email, role: user.role };
  await query("update sessions set last_used_at = now() where id = $1", [user.session_id]);
  return next();
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
