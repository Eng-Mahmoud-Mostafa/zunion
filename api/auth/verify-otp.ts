import { createSession, getRole, getSupabaseAdmin, hashOtp, methodGuard, normalizeEmail, setSessionCookie } from "./_shared";

export default async function handler(req: any, res: any) {
  if (methodGuard(req, res)) return;

  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || "").trim();
    const stayLoggedIn = Boolean(req.body?.stayLoggedIn);
    const role = getRole(email);
    if (!role) return res.status(403).json({ error: "هذا البريد غير مصرح له بالدخول." });
    if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: "كود الدخول يجب أن يكون 6 أرقام." });

    const supabase = getSupabaseAdmin();
    const codeHash = hashOtp(email, otp);
    const { data: code, error } = await supabase
      .from("otp_codes")
      .select("id, expires_at, used_at")
      .eq("email", email)
      .eq("code_hash", codeHash)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!code) return res.status(401).json({ error: "كود الدخول غير صحيح أو انتهت صلاحيته." });

    const session = createSession(email, role, stayLoggedIn);
    const { error: markError } = await supabase
      .from("otp_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("id", code.id);
    if (markError) throw markError;

    const { error: sessionError } = await supabase.from("app_sessions").insert({
      id: session.id,
      email,
      role,
      expires_at: session.expiresAt,
    });
    if (sessionError) throw sessionError;

    setSessionCookie(res, session.id, session.expiresAt);
    return res.status(200).json({ ok: true, session });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
  }
}
