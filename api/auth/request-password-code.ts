import { generateOtp, getSupabaseAdmin, hashOtp, methodGuard, normalizeUsername, sendOtpEmail } from "./_shared";

export default async function handler(req: any, res: any) {
  if (methodGuard(req, res)) return;

  try {
    const username = normalizeUsername(req.body?.username);
    if (!username) return res.status(400).json({ error: "اسم المستخدم مطلوب." });

    const supabase = getSupabaseAdmin();
    const { data: profile, error } = await supabase
      .from("users_profile")
      .select("id, username, role")
      .eq("username", username)
      .maybeSingle();
    if (error) throw error;
    if (!profile) return res.status(404).json({ error: "المستخدم غير موجود." });

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const sendTo = process.env.PASSWORD_CHANGE_EMAIL || "mahmoud_foly@icloud.com";

    const { error: insertError } = await supabase.from("password_reset_codes").insert({
      username,
      code_hash: hashOtp(username, code),
      expires_at: expiresAt,
      used: false,
    });
    if (insertError) throw insertError;

    await sendOtpEmail(sendTo, code);
    await supabase.from("operation_logs").insert({
      user_id: profile.id,
      username,
      role: profile.role,
      action: "request_password_change_code",
      page: "change_password",
    });

    return res.status(200).json({
      ok: true,
      devCode: process.env.OTP_DEV_MODE === "true" ? code : undefined,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
  }
}
