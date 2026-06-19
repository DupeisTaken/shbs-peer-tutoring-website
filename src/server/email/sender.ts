/**
 * Email delivery seam (SCAFFOLDING — no provider wired up yet).
 *
 * The app needs to send transactional email for the upcoming email-based 2FA codes
 * (and, later, things like password resets). Rather than commit to a provider now,
 * everything depends on this small provider-agnostic interface. When a provider is
 * chosen (SMTP/Nodemailer, Resend, etc.), implement `EmailSender` against it and
 * swap the export below — no call sites change.
 *
 * See src/server/auth/two-factor.ts for the first intended consumer.
 */

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

/**
 * Placeholder sender. Throws so that enabling any email-dependent feature before a
 * real provider is configured fails loudly instead of silently dropping mail.
 *
 * TODO: replace with a concrete provider implementation and read its config from
 * `src/env.js` once the provider is decided.
 */
export const emailSender: EmailSender = {
  async send() {
    throw new Error(
      "EmailSender is not configured. Choose an email provider and implement " +
        "src/server/email/sender.ts before enabling email-dependent features.",
    );
  },
};
