import { generateOtp, getRole, getSupabaseAdmin, hashOtp, methodGuard, normalizeEmail, sendOtpEmail } from "./_shared";

export default async function handler(req: any, res: any) {
  if (methodGuard(req, res)) return;

  try {
    const email = normalizeEmail(req.body?.email);
    const role = getRole(email);
    if (!role) return res.status(403).json({ error: "هذا البريد غير مصرح له بالدخول." });

    const supabase = getSupabaseAdmin();
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: userError } = await supabase
      .from("app_users")
      .upsert({ email, role, active: true }, { onConflict: "email" });
    if (userError) throw userError;

    const { error: otpError } = await supabase.from("otp_codes").insert({
      email,
      code_hash: hashOtp(email, otp),
      expires_at: expiresAt,
    });
    if (otpError) throw otpError;

    await sendOtpEmail(email, otp);
    return res.status(200).json({
      ok: true,
      devCode: process.env.OTP_DEV_MODE === "true" ? otp : undefined,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
  }
}
