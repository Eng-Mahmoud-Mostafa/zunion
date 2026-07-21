import nodemailer from "nodemailer";
import { Resend } from "resend";
import { config } from "./config.js";

type ResendFailure = {
  name?: string;
  message?: string;
  statusCode?: number;
};

function verificationHtml(code: string) {
  return `
    <div dir="rtl" style="font-family:Arial,Tahoma,sans-serif;line-height:1.8;color:#111">
      <h2 style="color:#d90416">نظام Zunion لإدارة الأوردرات</h2>
      <p>كود التحقق الخاص بك هو:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;direction:ltr">${code}</p>
      <p>هذا الكود صالح لمدة 10 دقائق.</p>
      <p>إذا لم تطلب هذا الكود، تجاهل هذه الرسالة.</p>
    </div>
  `;
}

function verificationText(code: string) {
  return [
    "نظام Zunion لإدارة الأوردرات",
    "",
    "كود التحقق الخاص بك هو:",
    code,
    "",
    "هذا الكود صالح لمدة 10 دقائق.",
    "إذا لم تطلب هذا الكود، تجاهل هذه الرسالة.",
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
  if (!config.resend.apiKey) {
    throw new Error("خدمة البريد الإلكتروني غير مهيأة على الخادم");
  }
  const resend = new Resend(config.resend.apiKey);
  const { error } = await resend.emails.send({
    from: config.resend.from,
    to: [to],
    subject,
    text: verificationText(code),
    html: verificationHtml(code),
  });
  if (error) {
    const safeError = error as ResendFailure;
    console.error("Resend error:", {
      name: safeError.name,
      message: safeError.message,
      statusCode: safeError.statusCode,
      from: config.resend.from,
    });
    throw new Error(mapResendError(safeError));
  }
}

async function sendWithSmtp(to: string, code: string, subject: string) {
  if (!config.smtp.host) {
    throw new Error("خدمة البريد الإلكتروني غير مهيأة على الخادم");
  }
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });

  await transporter.sendMail({
    from: config.smtp.from,
    to,
    subject,
    text: verificationText(code),
    html: verificationHtml(code),
  });
}

export async function sendVerificationEmail(email: string, code: string, subject = "كود التحقق - نظام Zunion") {
  if (config.otpDevMode) {
    console.log(`[DEV CODE] ${email}: ${code}`);
    return;
  }
  if (config.resend.apiKey) {
    await sendWithResend(email, code, subject);
    return;
  }
  await sendWithSmtp(email, code, subject);
}

export async function sendOtpEmail(email: string, otp: string) {
  await sendVerificationEmail(email, otp, "كود تسجيل الدخول - نظام Zunion");
}
