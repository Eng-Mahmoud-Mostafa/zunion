import nodemailer from "nodemailer";
import { config } from "./config.js";

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
      const details = await response.text();
      throw new Error(`Resend email failed: ${details || response.statusText}`);
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
