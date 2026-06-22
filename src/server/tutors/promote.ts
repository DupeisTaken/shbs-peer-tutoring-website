/**
 * Promote an accepted tutor applicant into a roster Tutor + a registration invite.
 *
 * Called when an application transitions to ACCEPTED (by the head's interview decision or by an
 * admin). It creates (or reactivates) the Tutor record and issues a single-use registration code
 * bound to the applicant's email — which they redeem at /register to self-create a verified login
 * (set their own password, confirm their email). The code is surfaced on the admin "Registration
 * codes" menu for the team to hand out; it is NOT auto-emailed.
 *
 * Idempotent by email (a returning applicant is reactivated, not duplicated) and by application
 * (an outstanding code isn't re-issued). Requires an application email.
 *
 * Node runtime only.
 */
import { db } from "~/server/db";
import { issueRegistrationCode } from "~/server/auth/registration";
import { defaultUsername, ensureUniqueUsername } from "~/server/auth/username";

export async function promoteApplicantToTutor(applicationId: string): Promise<void> {
  const app = await db.tutorApplication.findUnique({
    where: { id: applicationId },
    select: { name: true, email: true },
  });
  if (!app) return;

  const email = app.email?.trim() ? app.email.trim().toLowerCase() : null;
  if (!email) return; // applications always capture an email; nothing to bind a code to otherwise

  const parts = app.name.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? app.name.trim();
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : firstName;

  // Resolve (or create) the Tutor record — reactivated if one already exists for this email.
  const existing = await db.tutor.findUnique({ where: { email }, select: { id: true } });
  let tutorId: string;
  if (existing) {
    await db.tutor.update({ where: { id: existing.id }, data: { status: "ACTIVE" } });
    tutorId = existing.id;
  } else {
    const username = await ensureUniqueUsername(defaultUsername(firstName, lastName));
    const tutor = await db.tutor.create({
      data: {
        firstName,
        lastName,
        englishName: `${firstName} ${lastName}`,
        username,
        email,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    tutorId = tutor.id;
  }

  // If they already have a login, no registration is needed.
  const hasLogin = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (hasLogin) return;

  // Avoid issuing a duplicate code for the same application if one is still outstanding.
  const openCode = await db.registrationCode.findFirst({
    where: { applicationId, usedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (openCode) return;

  await issueRegistrationCode({
    email,
    tutorId,
    applicationId,
    label: app.name.trim(),
    issuedByName: "Accepted application",
  });
}
