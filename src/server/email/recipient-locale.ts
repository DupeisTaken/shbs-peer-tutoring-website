import {
  DEFAULT_EMAIL_LOCALE,
  normalizeEmailLocale,
  type EmailLocale,
} from "~/lib/email-locale";
import type { DomainDb } from "~/server/transactions";

/** Presentation only: the caller must already establish the exact recipient ID.
 * Never discover an owner from matching contact details or infer delivery authority. */
export async function accountEmailLocale(
  db: Pick<DomainDb, "user">,
  userId?: string | null,
  fallback: EmailLocale = DEFAULT_EMAIL_LOCALE,
): Promise<EmailLocale> {
  if (!userId) return fallback;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { emailLocale: true },
  });
  return user ? normalizeEmailLocale(user.emailLocale) : fallback;
}

/** Presentation-only lookup for an exact, already-authorized delivery address.
 * A verified registry entry may supply language; it grants no report or participant
 * ownership, delivery consent or private-reason proof. Pending/retired entries use English. */
export async function verifiedRecipientEmailLocale(
  db: Pick<DomainDb, "accountEmail">,
  to: string,
): Promise<EmailLocale> {
  const address = await db.accountEmail.findUnique({
    where: { email: to.trim().toLowerCase() },
    select: {
      verifiedAt: true,
      user: { select: { emailLocale: true, mergedIntoId: true } },
    },
  });
  return address?.verifiedAt && !address.user.mergedIntoId
    ? normalizeEmailLocale(address.user.emailLocale)
    : DEFAULT_EMAIL_LOCALE;
}
