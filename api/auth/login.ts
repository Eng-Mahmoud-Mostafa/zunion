import { createSession, getSupabaseAdmin, methodGuard, normalizeUsername, seededUsers, setSessionCookie, verifyPassword } from "./_shared";

export default async function handler(req: any, res: any) {
  if (methodGuard(req, res)) return;

  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");
    const stayLoggedIn = Boolean(req.body?.stayLoggedIn);
    if (!username || !password) return res.status(400).json({ error: "اسم المستخدم وكلمة المرور مطلوبان." });

    const supabase = getSupabaseAdmin();
    const { data: profile, error } = await supabase
      .from("users_profile")
      .select("id, username, full_name, role, email, is_active, password_hash, password_salt, must_change_password")
      .eq("username", username)
      .maybeSingle();

    if (error) throw error;
    const fallback = seededUsers[username];
    if (!profile && !fallback) return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
    if (profile && !profile.is_active) return res.status(403).json({ error: "هذا المستخدم غير مفعل." });

    const validPassword = profile
      ? verifyPassword(password, profile.password_salt, profile.password_hash)
      : password === "1234";
    if (!validPassword) return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });

    const role = profile?.role || fallback.role;
    const fullName = profile?.full_name || fallback.fullName;
    const email = profile?.email || fallback.email;
    const session = createSession(email, role, stayLoggedIn, username, fullName);

    await supabase.from("operation_logs").insert({
      user_id: profile?.id || null,
      username,
      role,
      action: "login",
      page: "login",
      new_value: { must_change_password: profile?.must_change_password ?? true },
    });

    setSessionCookie(res, session.id, session.expiresAt);
    return res.status(200).json({ ok: true, session, mustChangePassword: profile?.must_change_password ?? true });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
  }
}
