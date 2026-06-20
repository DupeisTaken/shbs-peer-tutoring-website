/**
 * Transactional email delivery via Aliyun Direct Mail (邮件推送) over SMTP.
 *
 * Email is "configured" once `EMAIL_FROM` + `SMTP_PASSWORD` are set (see src/env.js). When it
 * isn't, the app falls back to a sender that logs the message in development and warns in
 * production — so email-dependent flows still work locally and never silently drop mail.
 *
 * Aliyun setup: verify a sender domain, create a sender address (发信地址) with an SMTP password,
 * then point the SMTP_* / EMAIL_FROM env vars at it. See README-DEPLOY.md ("Email — Aliyun
 * Direct Mail"). Node runtime only.
 */
import nodemailer, { type Transporter } from "nodemailer";

import { env } from "~/env";
import { APP_TITLE } from "~/lib/branding";

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body (required). */
  text: string;
  /** Optional HTML body. */
  html?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** True once a sender address + SMTP password are configured. */
export function isEmailConfigured(): boolean {
  return Boolean(env.EMAIL_FROM && env.SMTP_PASSWORD);
}

/** The From header — display name (defaults to the app title) + the verified sender address. */
function fromAddress(): { name: string; address: string } {
  return {
    name: env.EMAIL_FROM_NAME ?? APP_TITLE,
    // Guaranteed present when isEmailConfigured() is true (the only path that uses this).
    address: env.EMAIL_FROM!,
  };
}

// Reuse a single SMTP transporter across requests / hot reloads.
const globalForEmail = globalThis as unknown as { mailTransport?: Transporter };

function transporter(): Transporter {
  globalForEmail.mailTransport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // Aliyun: 465 = SSL, 587/25/80 = STARTTLS. The login user is the sender address itself.
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER ?? env.EMAIL_FROM!,
      pass: env.SMTP_PASSWORD!,
    },
  });
  return globalForEmail.mailTransport;
}

const aliyunSender: EmailSender = {
  async send(message) {
    await transporter().sendMail({
      from: fromAddress(),
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  },
};

/** Fallback when email isn't configured: visible in dev, a loud warning in production. */
const devSender: EmailSender = {
  async send(message) {
    const line = `[email] (not configured) to=${message.to} subject="${message.subject}"`;
    if (env.NODE_ENV === "production") {
      console.warn(`${line} — set EMAIL_FROM + SMTP_PASSWORD to actually send.`);
    } else {
      console.info(`${line}\n${message.text}`);
    }
  },
};

/** Configured sender if env is set, otherwise the dev/log fallback. Call sites never change. */
export const emailSender: EmailSender = isEmailConfigured() ? aliyunSender : devSender;
