import nodemailer from "nodemailer";
import { config } from "./config.js";

const resendErrorMessage = "تعذر إرسال كود التحقق. تأكد من إعدادات Resend أو أضف دومين موثق.";

export async function sendVerificationEmail(email: string, code: string, subject = "كود التحقق من Zunion") {
  if (config.otpDevMode) {
    console.log(`[DEV CODE] ${email}: ${code}`);
    return;
  }

  if (config.resend.apiKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resend.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.resend.from,
        to: [email],
        subject,
        text: `كود التحقق الخاص بك هو ${code}. ينتهي خلال 10 دقائق.`,
        html: `<div dir="rtl" style="font-family:Arial,Tahoma,sans-serif;line-height:1.8"><h2 style="color:#d90416">Zunion</h2><p>كود التحقق الخاص بك هو:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>ينتهي هذا الكود خلال 10 دقائق.</p></div>`,
      }),
    });

    if (!response.ok) {
      throw new Error(resendErrorMessage);
    }
    return;
  }

  if (!config.smtp.host) {
    throw new Error(resendErrorMessage);
  }

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });

  await transporter.sendMail({
    from: config.smtp.from,
    to: email,
    subject,
    text: `كود التحقق الخاص بك هو ${code}. ينتهي خلال 10 دقائق.`,
  });
}

export async function sendOtpEmail(email: string, otp: string) {
  if (config.otpDevMode) {
    console.log(`[DEV OTP] ${email}: ${otp}`);
    return;
  }

  if (config.resend.apiKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resend.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.resend.from,
        to: [email],
        subject: "Zunion login OTP",
        text: `Your Zunion login code is ${otp}. It expires in 10 minutes.`,
        html: `<div dir="ltr" style="font-family:Arial,sans-serif"><h2>Zunion login code</h2><p>Your login code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${otp}</p><p>This code expires in 10 minutes.</p></div>`,
      }),
    });

    if (!response.ok) {
      await response.text();
      throw new Error(resendErrorMessage);
    }
    return;
  }

  if (!config.smtp.host) {
    console.log(`[DEV OTP] ${email}: ${otp}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });

  await transporter.sendMail({
    from: config.smtp.from,
    to: email,
    subject: "Zunion login OTP",
    text: `Your Zunion login code is ${otp}. It expires in 10 minutes.`,
  });
}
