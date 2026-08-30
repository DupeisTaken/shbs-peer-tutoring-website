/**
 * Transactional email delivery via Aliyun Direct Mail (邮件推送) over SMTP.
 *
 * Email is "configured" once `EMAIL_FROM` + `SMTP_PASSWORD` are set (see src/env.js). When it
 * isn't, the app falls back to a sender that logs the message in development and warns in
 * production. Security-sensitive flows must also check `isEmailDeliveryAvailable` so a production
 * deployment can never report success after dropping a login or step-up code.
 *
 * Aliyun setup: verify a sender domain, create a sender address (发信地址) with an SMTP password,
 * then point the SMTP_* / EMAIL_FROM env vars at it. See README-DEPLOY.md ("Email — Aliyun
 * Direct Mail"). Node runtime only.
 */
import nodemailer, { type Transporter } from "nodemailer";
import type SMTPPool from "nodemailer/lib/smtp-pool";

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

/** True when security email can reach a user (or is intentionally visible in local logs). */
export function isEmailDeliveryAvailable(): boolean {
  return env.NODE_ENV !== "production" || isEmailConfigured();
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
const globalForEmail = globalThis as unknown as {
  mailTransport?: Transporter<SMTPPool.SentMessageInfo>;
};

function transporter(): Transporter<SMTPPool.SentMessageInfo> {
  globalForEmail.mailTransport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // Aliyun: 465 = implicit TLS (SSL), 587/25/80 = STARTTLS. The login user is the sender address.
    secure: env.SMTP_PORT === 465,
    // On a STARTTLS port, refuse to fall back to plaintext if the upgrade isn't offered.
    requireTLS: env.SMTP_PORT !== 465,
    auth: {
      user: env.SMTP_USER ?? env.EMAIL_FROM!,
      pass: env.SMTP_PASSWORD!,
    },
    // Long-lived Node server: pool connections instead of dialing Aliyun per message.
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
    // Never let a stuck SMTP dialog hang the request that triggered the send.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return globalForEmail.mailTransport;
}

const aliyunSender: EmailSender = {
  async send(message) {
    try {
      const info = await transporter().sendMail({
        from: fromAddress(),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      console.info(
        `[email] sent to=${message.to} subject="${message.subject}" id=${info.messageId}`,
      );
    } catch (err) {
      // Surface to the caller — security flows (OTP / reset link) must know delivery failed — but
      // log context first so an Aliyun misconfiguration is diagnosable from `docker compose logs`.
      console.error(
        `[email] FAILED to=${message.to} subject="${message.subject}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  },
};

/**
 * Diagnostic: open a connection and authenticate against Aliyun **without** sending, so a bad
 * SMTP password / unverified sender / blocked port surfaces explicitly. Returns false (and logs)
 * when email isn't configured or the check fails — never throws, so it's safe in a health check.
 */
export async function verifyEmailTransport(): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  try {
    await transporter().verify();
    return true;
  } catch (err) {
    console.error(
      `[email] transport verify failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/** Fallback when email isn't configured: visible in dev, a loud warning in production. */
const devSender: EmailSender = {
  async send(message) {
    const line = `[email] (not configured) to=${message.to} subject="${message.subject}"`;
    if (env.NODE_ENV === "production") {
      console.warn(
        `${line} — set EMAIL_FROM + SMTP_PASSWORD to actually send.`,
      );
    } else {
      console.info(`${line}\n${message.text}`);
    }
  },
};

/** Configured sender if env is set, otherwise the development/log fallback. */
export const emailSender: EmailSender = isEmailConfigured()
  ? aliyunSender
  : devSender;
