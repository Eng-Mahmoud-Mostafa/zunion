import { Resend } from "resend";
import { config } from "./config.js";

type ResendFailure = {
  name?: string;
  message?: string;
  statusCode?: number;
};

function verificationHtml(code: string, subject: string) {
  return `<!doctype html>
<html dir="rtl" lang="ar">
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Tahoma,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr>
          <td style="background:#ed1c24;padding:20px 24px;text-align:right;">
            <span style="color:#ffffff;font-size:22px;font-weight:700;">Zunion</span>
            <span style="color:rgba(255,255,255,0.85);font-size:14px;margin-inline-start:8px;">نظام إدارة الأوردرات</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 24px;line-height:1.8;color:#18181b;font-size:15px;">
            <h1 style="font-size:18px;margin:0 0 12px;color:#18181b;">${subject}</h1>
            <p style="margin:0 0 16px;">كود التحقق الخاص بك هو:</p>
            <div style="background:#f4f4f5;border:1px dashed #d4d4d8;border-radius:8px;padding:16px;text-align:center;margin:0 0 16px;">
              <span style="font-size:30px;font-weight:700;letter-spacing:6px;direction:ltr;color:#18181b;">${code}</span>
            </div>
            <p style="margin:0 0 16px;">هذا الكود <strong>صالح لمدة 10 دقائق</strong> ويمكن استخدامه مرة واحدة فقط.</p>
            <p style="margin:0 0 16px;color:#52525b;">إذا لم تطلب هذا الكود، تجاهل هذه الرسالة. لا تشارك الكود مع أي شخص.</p>
            <p style="margin:0;color:#71717a;font-size:13px;">Zunion — إدارة التصنيع والتسليم والحسابات</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function verificationText(code: string, subject: string) {
  return [
    `نظام Zunion لإدارة الأوردرات`,
    "",
    subject,
    "",
    "كود التحقق الخاص بك هو:",
    code,
    "",
    "هذا الكود صالح لمدة 10 دقائق ويمكن استخدامه مرة واحدة فقط.",
    "إذا لم تطلب هذا الكود، تجاهل هذه الرسالة. لا تشارك الكود مع أي شخص.",
  ].join("\n");
}

function mapResendError(error: ResendFailure) {
  const message = String(error.message || "").toLowerCase();
  const status = Number(error.statusCode || 0);
  if (status === 401 || message.includes("api key") || message.includes("invalid api")) {
    return "خدمة البريد الإلكتروني غير مهيأة على الخادم";
  }
  if (status === 403 || message.includes("domain") || message.includes("verified") || message.includes("sender") || message.includes("from")) {
    return "عنوان البريد المرسل غير موثق. يجب توثيق الدومين المستخدم للإرسال";
  }
  if (status === 422 || message.includes("recipient") || message.includes("valid email") || message.includes("to")) {
    return "عنوان البريد الإلكتروني غير صالح";
  }
  if (status === 429 || message.includes("rate")) {
    return "تم إرسال عدد كبير من الطلبات. حاول مرة أخرى لاحقاً";
  }
  return "تعذر إرسال كود التحقق حالياً";
}

async function sendWithResend(to: string, code: string, subject: string) {
  const resend = new Resend(config.resend.apiKey);
  const { error } = await resend.emails.send({
    from: config.resend.from,
    to: [to],
    subject,
    text: verificationText(code, subject),
    html: verificationHtml(code, subject),
  });
  if (error) {
    const safeError = error as ResendFailure;
    console.error("Resend error:", {
      name: safeError.name,
      message: safeError.message,
      statusCode: safeError.statusCode,
      from: config.resend.from,
      to,
    });
    throw new Error(mapResendError(safeError));
  }
}

export type EmailService = {
  sendVerificationCode(to: string, code: string, subject?: string): Promise<void>;
};

export const emailService: EmailService = {
  async sendVerificationCode(to, code, subject = "كود التحقق - نظام Zunion") {
    if (config.otpDevMode) {
      console.log(`[DEV CODE] ${to}: ${code}`);
      return;
    }
    if (!config.resend.apiKey) {
      throw new Error("خدمة البريد الإلكتروني غير مهيأة على الخادم");
    }
    await sendWithResend(to, code, subject);
  },
};

export async function sendVerificationEmail(to: string, code: string, subject = "كود التحقق - نظام Zunion") {
  await emailService.sendVerificationCode(to, code, subject);
}
