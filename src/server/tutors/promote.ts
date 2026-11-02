import { TRPCError } from "@trpc/server";
import { isFreshAdmissionCapture } from "~/server/recovery/capture";
import { requireSchoolParticipation } from "~/server/school-departure";
import { TUTOR_ACCESS_REVOKED_PROMOTION_MESSAGE } from "~/lib/tutor-promotion";
import {
  assertRequestProcessable,
  lockApplicationReview,
} from "~/server/request-invalidity";
import { applicationPromotionReadiness } from "./application-identity";
import { ensureNameFallbackForRole } from "~/server/program/name-fields";
import { initializeAccountAcademics } from "~/server/academics";
import { preserveHistoricalAcademics } from "~/server/historical-academics";
import { initializePersonSource } from "~/server/person-source-initialization";
import {
  lockAccountProfile,
  updateAccountProfile,
} from "~/server/account-profile";
/**
 * Promote an accepted tutor applicant into a roster Tutor + a registration invite.
 *
 * Called when an initial application is accepted by an eligible Admin/Head chair or an
 * authorized management decision. It creates (or reactivates) the Tutor record and issues a code
 * bound to the applicant's email — which they redeem at /register to self-create a verified login
 * (set their own password, confirm their email). The code is surfaced on the admin "Registration
 * codes" menu for the team to hand out; it is NOT auto-emailed.
 *
 * Idempotent by email (a returning applicant is reactivated, not duplicated) and by application
 * (an outstanding code isn't re-issued). Requires an application email.
 * Account restrictions are independent of application approval: only explicit Head restoration
 * may restore revoked existing membership, including when Head is the accepting interviewer.
 *
 * Node runtime only.
 */
import { db } from "~/server/db";
import {
  inTransaction,
  lockEntity,
  type TransactionDb,
} from "~/server/transactions";
import { issueRegistrationCode } from "~/server/auth/registration";
import {
  defaultUsername,
  canonicalUsername,
  ensureUserUsername,
  lockUsernameNamespace,
} from "~/server/auth/username";

const promotionAccountSelect = {
  id: true,
  name: true,
  legacyName: true,
  firstName: true,
  lastName: true,
  preferredName: true,
  alternativeNames: true,
  tutorId: true,
  role: true,
  emailVerifiedAt: true,
  username: true,
  tutorAccessRevoked: true,
  suspendedAt: true,
  mergedIntoId: true,
  recoveryVoidedAt: true,
} as const;

export async function promoteApplicantToTutor(
  applicationId: string,
  client: TransactionDb = db,
): Promise<void> {
  return inTransaction(client, async (db) => {
    await lockUsernameNamespace(db);
    await lockApplicationReview(db, applicationId);
    const app = await db.tutorApplication.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        alternativeNames: true,
        email: true,
        type: true,
        invalidatedAt: true,
      },
    });
    if (app?.type !== "INITIAL") return;
    assertRequestProcessable(app);

    const email = app.email?.trim() ? app.email.trim().toLowerCase() : null;
    if (!email) return; // applications always capture an email; nothing to bind a code to otherwise

    // The primary email is the existing matching rule; a linked roster owner is
    // also authoritative even when legacy contact mirrors disagree. Discover only
    // lock targets here, then reread their identity and restrictions under locks.
    const emailAccount = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    const candidateTutor = await db.tutor.findUnique({
      where: { email },
      select: { id: true },
    });
    const candidateOwner = candidateTutor
      ? await db.user.findUnique({
          where: { tutorId: candidateTutor.id },
          select: { id: true },
        })
      : null;
    // Preserve negative evidence from verified aliases, legacy email case, and
    // retained roster ownership. These matches can refuse admission; they never
    // authorize a new identity link or replace the primary-email matching rule.
    const findRestrictionOwners = (tutorId: string | undefined) =>
      db.user.findMany({
        where: {
          OR: [
            { email: { equals: email, mode: "insensitive" } },
            {
              emails: {
                some: {
                  email: { equals: email, mode: "insensitive" },
                  verifiedAt: { not: null },
                },
              },
            },
            ...(tutorId
              ? [{ tutorId }, { retainedTutorProfiles: { some: { tutorId } } }]
              : []),
          ],
        },
        select: promotionAccountSelect,
        orderBy: { id: "asc" },
      });
    const candidateRestrictionOwners = await findRestrictionOwners(
      candidateTutor?.id,
    );
    const accountIds = [
      ...new Set(
        [
          emailAccount?.id,
          candidateOwner?.id,
          ...candidateRestrictionOwners.map((account) => account.id),
        ].filter((id): id is string => !!id),
      ),
    ].sort();
    for (const id of accountIds) await lockAccountProfile(db, id);
    if (candidateTutor) {
      // Match historical-academic writers: account/User locks precede the roster
      // advisory and row locks. The namespace's persistent tuple fence above also
      // rejects a stale Serializable snapshot before it can authorize a grant.
      await lockEntity(db, `tutor:${candidateTutor.id}`);
      await db.$queryRaw`SELECT id FROM "Tutor" WHERE id = ${candidateTutor.id} FOR NO KEY UPDATE`;
    }
    const hasLogin = await db.user.findUnique({
      where: { email },
      select: promotionAccountSelect,
    });
    const existing = await db.tutor.findUnique({
      where: { email },
      select: { id: true },
    });
    const rosterOwner = existing
      ? await db.user.findUnique({
          where: { tutorId: existing.id },
          select: promotionAccountSelect,
        })
      : null;
    const restrictionOwners = await findRestrictionOwners(existing?.id);
    if (
      hasLogin?.id !== emailAccount?.id ||
      existing?.id !== candidateTutor?.id ||
      rosterOwner?.id !== candidateOwner?.id ||
      restrictionOwners.length !== candidateRestrictionOwners.length ||
      restrictionOwners.some(
        (account, index) =>
          account.id !== candidateRestrictionOwners[index]?.id,
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Applicant account linkage changed. Reload before approving.",
      });
    for (const account of restrictionOwners) {
      if (account.mergedIntoId)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This login was combined into another account. Ask Head to review the surviving account before approving.",
        });
      if (account.suspendedAt)
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Account access is suspended. Ask Head to review the account before approving tutoring.",
        });
      // Historical-only setup also sets this flag without granting membership.
      // Match registration: a retained current tutor link distinguishes revoked
      // membership from an account that can still receive its first admission.
      if (account.tutorId && account.tutorAccessRevoked &&
        !(account.recoveryVoidedAt && await isFreshAdmissionCapture(db, applicationId)))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: TUTOR_ACCESS_REVOKED_PROMOTION_MESSAGE,
        });
      await requireSchoolParticipation(db, account.id);
    }
    if (hasLogin?.tutorId && hasLogin.tutorId !== existing?.id)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Account already belongs to another tutor.",
      });
    if (rosterOwner && rosterOwner.id !== hasLogin?.id)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Account and tutor ownership differ. Ask Head to review the account linkage before approving.",
      });

    // A verified account already owns its name; a historical application cannot
    // replace it when participation is granted. Unlinked applicants establish a new name.
    // Active display may be a username under a hidden policy. Never turn that
    // handle into an original human name while granting tutoring membership.
    const readiness = await applicationPromotionReadiness(db, app);
    if (!readiness.ready)
      throw new TRPCError({ code: "BAD_REQUEST", message: readiness.reason! });
    const promotionIdentity = readiness.identity;
    const englishName = promotionIdentity.name.trim();

    // Resolve (or create) the Tutor record — reactivated if one already exists for this email.
    let tutorId: string;
    if (existing) {
      await preserveHistoricalAcademics(db, "TUTOR", existing.id);
      await db.tutor.update({
        where: { id: existing.id },
        data: { status: "ACTIVE" },
      });
      tutorId = existing.id;
    } else {
      // Confirmed parts drive the first handle. An unsplit legacy label stays a
      // single input; no inferred given/family boundary becomes identity evidence.
      // An established verified-account handle still wins in canonicalUsername.
      const usernameBase = defaultUsername(
        promotionIdentity.firstName ?? englishName,
        promotionIdentity.lastName ?? "",
      );
      const username = await canonicalUsername(db, usernameBase, {
        excludeUserId: hasLogin?.emailVerifiedAt ? hasLogin.id : undefined,
        userUsername: hasLogin?.emailVerifiedAt ? hasLogin.username : undefined,
      });
      const tutor = await db.tutor.create({
        data: {
          // Accepted accountless applicants still need a standalone directory
          // identity; this does not redeem their invitation or create a login.
          personId: (await db.person.create({ data: {} })).id,
          firstName: hasLogin?.emailVerifiedAt
            ? hasLogin.firstName
            : app.firstName,
          lastName: hasLogin?.emailVerifiedAt
            ? hasLogin.lastName
            : app.lastName,
          preferredName: hasLogin?.emailVerifiedAt
            ? hasLogin.preferredName
            : app.preferredName,
          alternativeNames: hasLogin?.emailVerifiedAt
            ? hasLogin.alternativeNames
            : app.alternativeNames,
          englishName,
          username,
          email,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      tutorId = tutor.id;
    }

    // Older accountless roster rows can predate directory identities. This
    // initializes metadata only, preserving the application's access decision.
    await initializePersonSource(db, { kind: "TUTOR", id: tutorId });
    await db.tutorApplication.update({
      where: { id: applicationId },
      data: { promotedTutorId: tutorId },
    });
    // Only a verified existing identity can receive the capability without another email challenge.
    if (hasLogin?.emailVerifiedAt && !hasLogin.recoveryVoidedAt) {
      // A verified existing account acquires the capability without receiving new credentials.
      if (["STUDENT", "VIEWER", "CREW"].includes(hasLogin.role))
        await ensureNameFallbackForRole(db, hasLogin.id, "TUTOR");
      await db.user.update({
        where: { id: hasLogin.id },
        data: {
          tutorId,
          // Initialize first membership only. Linked membership passed the
          // authoritative guard above and never has its Head restriction reset.
          ...(!hasLogin.tutorId ? { tutorAccessRevoked: false } : {}),
          ...(hasLogin.role === "STUDENT" ||
          hasLogin.role === "VIEWER" ||
          hasLogin.role === "CREW"
            ? { role: "TUTOR" }
            : {}),
        },
      });
      await initializeAccountAcademics(db, hasLogin.id);
      await ensureUserUsername(hasLogin.id, db);
      await updateAccountProfile(db, hasLogin.id);
      return;
    }

    // Avoid issuing a duplicate code for the same application if one is still outstanding.
    const openCode = await db.registrationCode.findFirst({
      where: { applicationId, usedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (openCode) return;

    await issueRegistrationCode(
      {
        email,
        tutorId,
        applicationId,
        label: app.name.trim(),
        issuedByName: "Accepted application",
      },
      db,
    );
  });
}
