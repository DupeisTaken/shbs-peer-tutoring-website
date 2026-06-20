/**
 * Promote an accepted tutor applicant into a real Tutor record AND a login account.
 *
 * Called when an application transitions to ACCEPTED (by the head's interview decision or by
 * an admin). Idempotent by email: an existing tutor is (re)activated rather than duplicated.
 * New tutors are created active, with first/last name split from the application name and an
 * auto-generated username.
 *
 * A login `User` is auto-provisioned with the shared default password (env
 * `TUTOR_DEFAULT_PASSWORD`); the first-login onboarding then forces a real password + email
 * (`mustChangePassword` + `emailVerifiedAt = null`). Requires an application email.
 */
import { env } from "~/env";
import { db } from "~/server/db";
import { hashPassword } from "~/server/auth/password";
import { defaultUsername, ensureUniqueUsername } from "~/server/auth/username";

export async function promoteApplicantToTutor(applicationId: string): Promise<void> {
  const app = await db.tutorApplication.findUnique({
    where: { id: applicationId },
    select: { name: true, email: true },
  });
  if (!app) return;

  const email = app.email?.trim() ? app.email.trim().toLowerCase() : null;

  // Resolve (or create) the Tutor record.
  let tutorId: string;
  const existing = email
    ? await db.tutor.findUnique({ where: { email }, select: { id: true } })
    : null;
  if (existing) {
    await db.tutor.update({ where: { id: existing.id }, data: { active: true } });
    tutorId = existing.id;
  } else {
    const parts = app.name.trim().split(/\s+/).filter(Boolean);
    const firstName = parts[0] ?? app.name.trim();
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : firstName;
    const username = await ensureUniqueUsername(defaultUsername(firstName, lastName));
    const tutor = await db.tutor.create({
      data: {
        firstName,
        lastName,
        englishName: `${firstName} ${lastName}`,
        username,
        email,
        active: true,
      },
      select: { id: true },
    });
    tutorId = tutor.id;
  }

  // Auto-provision a login account (needs an email). Link it to the tutor; if a user with
  // this email already exists, just link/activate it without touching their password.
  if (!email) return;
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    await db.user.update({ where: { id: user.id }, data: { tutorId } });
    return;
  }
  await db.user.create({
    data: {
      email,
      name: app.name.trim(),
      role: "TUTOR",
      tutorId,
      passwordHash: hashPassword(env.TUTOR_DEFAULT_PASSWORD),
      mustChangePassword: true,
      // Null so the first-login onboarding (set password + email) is enforced.
      emailVerifiedAt: null,
    },
  });
}
