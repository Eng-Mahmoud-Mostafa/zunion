import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { query } from "./db.js";
import { appSessionLive, verifyAppSession, type AppSession } from "./security.js";
export const SESSION_REVOCATION_DDL = `create table if not exists revoked_app_sessions (
 session_id text primary key, expires_at timestamptz not null, revoked_at timestamptz not null default now()
);create index if not exists revoked_app_sessions_expiry_idx on revoked_app_sessions(expires_at);`;
/** Stable across /auth/me refreshes, including cookies issued before session IDs existed. */
export function sessionIdentity(session: AppSession): string {
 return session.sessionId || crypto.createHash("sha256").update(JSON.stringify([session.email,session.username,session.loggedInAt,session.expiresAt,session.tokenVersion ?? 0])).digest("hex");
}
export async function revokeSession(session: AppSession) {
 if (!appSessionLive(session)) return;
 await query("insert into revoked_app_sessions(session_id,expires_at) values($1,$2) on conflict(session_id) do update set expires_at=greatest(revoked_app_sessions.expires_at,excluded.expires_at)",[sessionIdentity(session),session.expiresAt]);
}
export async function checkSessionRevocation(req: Request,res: Response,next: NextFunction) {
 const raw=req.cookies?.zunion_app_session;
 const session=typeof raw==="string"?verifyAppSession(raw):null;
 if(!appSessionLive(session))return next();
 res.set("Cache-Control","no-store");
 try {
  const {rows}=await query("select session_id from revoked_app_sessions where session_id=$1 and expires_at>now()",[sessionIdentity(session)]);
  req.sessionRevoked=rows.length>0;
  next();
 }catch {res.status(503).json({message:"تعذر التحقق من الجلسة. حاول مرة أخرى."});}
}
