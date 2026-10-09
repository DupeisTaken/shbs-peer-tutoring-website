/**
 * Transactional email delivery via Aliyun Direct Mail (邮件推送) over SMTP.
 *
 * Explicit SECURITY/PROGRAM categories select independently credentialed sender accounts.
 * Each falls back to the complete legacy EMAIL_FROM + SMTP_PASSWORD account during rollout.
 * Unconfigured mail is visible in development logs and rejected in production.
 *
 * Aliyun setup: verify a sender domain, create a sender address (发信地址) with an SMTP password,
 * then point the SMTP_* / EMAIL_FROM env vars at it. See docs/deployment.md ("Email — Aliyun
 * Direct Mail"). Node runtime only.
 */
import nodemailer from "nodemailer";
import { Socket } from "node:net";

import { env } from "~/env";
import { APP_TITLE } from "~/lib/branding";
import { renderEmail, type EmailPresentation } from "./template";
import { deferUntilCommit } from "~/server/db-scope";

export type EmailCategory = "SECURITY" | "PROGRAM";

export interface EmailMessage {
  /** Explicit purpose, independent of subject and signup transport deadline. */
  category: EmailCategory;
  /** Public signup uses a separate bounded transport, leaving recovery mail independent. */
  signup?: boolean;
  /** Stable identifier for durable notification retries. */
  messageId?: string;
  to: string;
  subject: string;
  /** Plain-text body (required). */
  text: string;
  /** Optional HTML body. */
  html?: string;
  /** Shared visual hierarchy without changing the required plain-text content. */
  presentation?: EmailPresentation;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

interface SenderAccount {
  key: EmailCategory | "LEGACY";
  address: string;
  user: string;
  password: string;
}

/** Fall back as a complete account; never borrow another sender's SMTP password. */
function senderAccount(category: EmailCategory): SenderAccount | undefined {
  const address =
    category === "SECURITY" ? env.EMAIL_SECURITY_FROM : env.EMAIL_PROGRAM_FROM;
  const password =
    category === "SECURITY"
      ? env.SMTP_SECURITY_PASSWORD
      : env.SMTP_PROGRAM_PASSWORD;
  const user =
    category === "SECURITY" ? env.SMTP_SECURITY_USER : env.SMTP_PROGRAM_USER;
  if (address && password)
    return { key: category, address, user: user ?? address, password };
  if (env.EMAIL_FROM && env.SMTP_PASSWORD) {
    return {
      key: "LEGACY",
      address: env.EMAIL_FROM,
      user: env.SMTP_USER ?? env.EMAIL_FROM,
      password: env.SMTP_PASSWORD,
    };
  }
  return undefined;
}

export function isEmailConfigured(category: EmailCategory): boolean {
  return Boolean(senderAccount(category));
}

/** Local logs count as intentional delivery; production needs this category's complete account. */
export function isEmailDeliveryAvailable(category: EmailCategory): boolean {
  return env.NODE_ENV !== "production" || isEmailConfigured(category);
}

// Separate pools prevent authentication reuse across identities. Legacy categories share one.
const globalForEmail = globalThis as unknown as {
  mailTransports?: Map<
    SenderAccount["key"],
    ReturnType<typeof createTransport>
  >;
};

function createTransport(
  account: SenderAccount,
  pool: boolean,
  socket?: Socket,
) {
  const options = {
    socket,
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // Aliyun: 465 = implicit TLS (SSL), 587/25/80 = STARTTLS. The login user is the sender address.
    secure: env.SMTP_PORT === 465,
    // On a STARTTLS port, refuse to fall back to plaintext if the upgrade isn't offered.
    requireTLS: env.SMTP_PORT !== 465,
    auth: {
      user: account.user,
      pass: account.password,
    },
    // Long-lived Node server: pool connections instead of dialing Aliyun per message.
    maxConnections: 3,
    maxMessages: 50,
    // Never let a stuck SMTP dialog hang the request that triggered the send.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
  return pool
    ? nodemailer.createTransport({ ...options, pool: true })
    : nodemailer.createTransport(options);
}

function transporter(account: SenderAccount) {
  const transports = (globalForEmail.mailTransports ??= new Map<
    SenderAccount["key"],
    ReturnType<typeof createTransport>
  >());
  let transport = transports.get(account.key);
  if (!transport) {
    transport = createTransport(account, true);
    transports.set(account.key, transport);
  }
  return transport;
}

async function sendSmtp(message: EmailMessage, account: SenderAccount) {
  // Hold the underlying socket: SMTPTransport.close() alone does not abort active delivery.
  const socket = message.signup ? new Socket() : undefined;
  let transport: ReturnType<typeof createTransport> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    transport = message.signup
      ? createTransport(account, false, socket)
      : transporter(account);
    const delivery = transport.sendMail({
      from: {
        name: env.EMAIL_FROM_NAME ?? APP_TITLE,
        address: account.address,
      },
      messageId: message.messageId,
      to: message.to,
      subject: message.subject,
      text: message.text,
      // Keep the shared template independent of the selected SMTP identity.
      html: message.html ?? renderEmail({ brand: APP_TITLE, ...message }),
    });
    const result = message.signup
      ? await Promise.race([
          delivery,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              socket?.destroy();
              transport?.close();
              reject(new Error("Signup SMTP deadline"));
            }, 30_000);
          }),
        ])
      : await delivery;
    // Single-recipient mail must be accepted before a flow reports success.
    if (result.rejected?.length || result.accepted?.length === 0) {
      throw new Error("SMTP recipient rejected");
    }
    console.info(`[email] ${message.category} delivered`);
  } catch {
    // SMTP exceptions may include credentials or content; propagate only a safe failure.
    console.error(`[email] ${message.category} delivery failed`);
    throw new Error("Email delivery failed. Please try again later.");
  } finally {
    clearTimeout(timer);
    if (message.signup) {
      socket?.destroy();
      transport?.close();
    }
  }
}

/**
 * Diagnostic: open a connection and authenticate against Aliyun **without** sending, so a bad
 * SMTP password / unverified sender / blocked port surfaces explicitly. Returns false (and logs)
 * when email isn't configured or the check fails — never throws, so it's safe in a health check.
 */
export async function verifyEmailTransport(
  category: EmailCategory,
): Promise<boolean> {
  const account = senderAccount(category);
  if (!account) return false;
  try {
    await transporter(account).verify();
    return true;
  } catch {
    console.error(`[email] ${category} transport verify failed`);
    return false;
  }
}

/** Resolve per message so availability checks and delivery use identical category routing. */
export const emailSender: EmailSender = {
  async send(message) {
    // Audited mutations commit their durable evidence before an external recipient is
    // contacted. Outside that scope callers retain synchronous delivery/failure semantics.
    if (deferUntilCommit(() => emailSender.send(message))) return;
    const account = senderAccount(message.category);
    if (account) return sendSmtp(message, account);
    if (env.NODE_ENV === "production") {
      console.warn(`[email] ${message.category} delivery unavailable`);
      throw new Error(
        "Email delivery is unavailable. Contact the program team.",
      );
    }
    console.info(
      `[email] (not configured) category=${message.category} to=${message.to} subject="${message.subject}"\n${message.text}`,
    );
  },
};
