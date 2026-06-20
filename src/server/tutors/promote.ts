/**
 * Promote an accepted tutor applicant into a real Tutor record.
 *
 * Called when an application transitions to ACCEPTED (by the head's interview decision or by
 * an admin). Idempotent by email: if a tutor with the applicant's email already exists it is
 * (re)activated rather than duplicated. New tutors are created active, with first/last name
 * split from the application name and an auto-generated username.
 */
import { db } from "~/server/db";
import { defaultUsername, ensureUniqueUsername } from "~/server/auth/username";

export async function promoteApplicantToTutor(applicationId: string): Promise<void> {
  const app = await db.tutorApplication.findUnique({
    where: { id: applicationId },
    select: { name: true, email: true },
  });
  if (!app) return;

  const email = app.email?.trim() ? app.email.trim().toLowerCase() : null;

  // Already a tutor with this email? Just make sure they're active.
  if (email) {
    const existing = await db.tutor.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      await db.tutor.update({ where: { id: existing.id }, data: { active: true } });
      return;
    }
  }

  const parts = app.name.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? app.name.trim();
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : firstName;
  const username = await ensureUniqueUsername(defaultUsername(firstName, lastName));

  await db.tutor.create({
    data: {
      firstName,
      lastName,
      englishName: `${firstName} ${lastName}`,
      username,
      email,
      active: true,
    },
  });
}
