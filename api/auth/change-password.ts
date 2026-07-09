import { getSupabaseAdmin, hashOtp, hashPassword, methodGuard, normalizeUsername, verifyPassword } from "./_shared";
import { randomUUID } from "node:crypto";

export default async function handler(req: any, res: any) {
  if (methodGuard(req, res)) return;

  try {
    const username = normalizeUsername(req.body?.username);
    const oldPassword = String(req.body?.oldPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    const code = String(req.body?.code || "").trim();

    if (!username || !oldPassword || !newPassword || !code) {
      return res.status(400).json({ error: "كل الحقول مطلوبة." });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ error: "كلمة المرور الجديدة يجب ألا تقل عن 4 أحرف." });
    }

    const supabase = getSupabaseAdmin();
    const { data: profile, error: profileError } = await supabase
      .from("users_profile")
      .select("id, username, role, password_hash, password_salt")
      .eq("username", username)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return res.status(404).json({ error: "المستخدم غير موجود." });
    if (!verifyPassword(oldPassword, profile.password_salt, profile.password_hash)) {
      return res.status(401).json({ error: "كلمة المرور القديمة غير صحيحة." });
    }

    const { data: resetCode, error: codeError } = await supabase
      .from("password_reset_codes")
      .select("id")
      .eq("username", username)
      .eq("code_hash", hashOtp(username, code))
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (codeError) throw codeError;
    if (!resetCode) return res.status(401).json({ error: "كود التحقق غير صحيح أو انتهت صلاحيته." });

    const salt = randomUUID();
    const passwordHash = hashPassword(newPassword, salt);
    const { error: updateError } = await supabase
      .from("users_profile")
      .update({ password_salt: salt, password_hash: passwordHash, must_change_password: false })
      .eq("id", profile.id);
    if (updateError) throw updateError;

    await supabase.from("password_reset_codes").update({ used: true }).eq("id", resetCode.id);
    await supabase.from("operation_logs").insert({
      user_id: profile.id,
      username,
      role: profile.role,
      action: "change_password",
      page: "change_password",
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
  }
}
