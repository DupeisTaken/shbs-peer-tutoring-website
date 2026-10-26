import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_CODE_ATTEMPTS } from "~/server/auth/registration";
import type { DomainDb } from "~/server/transactions";

export type ApplicationAccountSetup = {
  state:
    | "active"
    | "linked"
    | "accountPending"
    | "accountRestricted"
    | "expired"
    | "used"
    | "missing"
    | "conflict"
    | "notEligible";
  tutorId: string | null;
  account: { name: string | null; username: string | null } | null;
  invitation: { id: string; code: string; expiresAt: Date } | null;
};

/** Authorized staff call this read on demand. It never repairs a binding, creates
 * an account, rotates a code or sends mail. Email/name matches are not provenance. */
export async function applicationAccountSetup(
  db: DomainDb,
  applicationId: string,
  now = new Date(),
): Promise<ApplicationAccountSetup> {
  const empty = {
    tutorId: null,
    account: null,
    invitation: null,
  };
  const application = await db.tutorApplication.findUnique({
    where: { id: applicationId },
    select: {
      type: true,
      status: true,
      invalidatedAt: true,
      promotedTutorId: true,
      email: true,
    },
  });
  if (!application)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Application not found.",
    });
  if (
    application.type !== "INITIAL" ||
    application.status !== "ACCEPTED" ||
    application.invalidatedAt
  )
    return { ...empty, state: "notEligible" };

  const codes = await db.registrationCode.findMany({
    where: { applicationId, kind: "TUTOR" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      code: true,
      tutorId: true,
      email: true,
      expiresAt: true,
      usedAt: true,
      attempts: true,
    },
  });
  const bindings = new Set(
    codes.flatMap((code) => (code.tutorId ? [code.tutorId] : [])),
  );
  if (application.promotedTutorId) bindings.add(application.promotedTutorId);
  // Never share a code when the source's recorded roster bindings disagree.
  if (bindings.size > 1) return { ...empty, state: "conflict" };
  const tutorId = [...bindings][0] ?? null;
  const tutor = tutorId
    ? await db.tutor.findUnique({
        where: { id: tutorId },
        select: {
          status: true,
          user: {
            select: {
              name: true,
              username: true,
              role: true,
              emailVerifiedAt: true,
              tutorAccessRevoked: true,
              suspendedAt: true,
              mergedIntoId: true,
              schoolDeparture: { select: { reason: true } },
            },
          },
        },
      })
    : null;
  if (tutorId && !tutor) return { ...empty, state: "conflict" };
  const user = tutor?.user;
  const account = user ? { name: user.name, username: user.username } : null;
  const base = { ...empty, tutorId, account };
  if (
    (tutor && tutor.status !== "ACTIVE") ||
    (user &&
      (user.role === "VIEWER" ||
        user.tutorAccessRevoked ||
        user.suspendedAt ||
        user.mergedIntoId ||
        user.schoolDeparture?.reason))
  )
    return { ...base, state: "accountRestricted" };
  // A current, verified relation is confirmation. A same-email user is never queried.
  if (user?.emailVerifiedAt) return { ...base, state: "linked" };
  const email = application.email.trim().toLowerCase();
  const outstanding = codes.filter(
    (code) => !code.usedAt && code.expiresAt > now,
  );
  // Application provenance alone cannot make an unbound or differently bound
  // invitation safe to share. Require the exact roster and normalized contact.
  if (
    outstanding.some(
      (code) =>
        !tutorId ||
        code.tutorId !== tutorId ||
        !z.string().email().safeParse(email).success ||
        code.email?.trim().toLowerCase() !== email,
    )
  )
    return { ...empty, state: "conflict" };
  const active = codes.find(
    (code) =>
      !code.usedAt &&
      code.expiresAt > now &&
      code.attempts < MAX_CODE_ATTEMPTS &&
      !!code.code?.trim(),
  );
  if (active?.code)
    return {
      ...base,
      state: "active",
      invitation: {
        id: active.id,
        code: active.code,
        expiresAt: active.expiresAt,
      },
    };
  if (user) return { ...base, state: "accountPending" };
  if (codes.some((code) => !!code.usedAt)) return { ...base, state: "used" };
  if (codes.length && codes.every((code) => code.expiresAt <= now))
    return { ...base, state: "expired" };
  // Missing plaintext and exhausted attempts are not shareable invitations either.
  return { ...base, state: "missing" };
}
