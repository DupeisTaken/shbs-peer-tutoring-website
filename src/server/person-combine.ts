import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isHistoricalTutor } from "~/lib/historical-academics";
import { isHistoricalTutee } from "~/lib/tutee-history";
import {
  personGraph,
  personSource,
  assignParticipantPerson,
} from "./person-identity";
import { inTransaction, lockEntity, type DomainDb } from "./transactions";
import { lockUsernameNamespace } from "./auth/username";
import { verifyPasswordConfirmation } from "./auth/password-confirmation";
import { previewCombine } from "./combine-accounts";
import { accountSafetyReason, personReviewItem, type PersonReviewItem } from "./person-operational-review";
import { linkTutorHistory, previewTutorHistory } from "./tutor-history";
import { linkTuteeHistory, previewHistoryLink } from "./tutee-history";

export const personCombineSelection = z.object({
  sources: z
    .array(personSource)
    .min(2)
    .max(20)
    .refine(
      (rows) =>
        new Set(rows.map((r) => `${r.kind}:${r.id}`)).size === rows.length,
      "Choose distinct records.",
    ),
  retainedUserId: z.string().min(1).max(128).optional(),
  retireDuplicateLogins: z.boolean().default(false),
});
export const personCombineInput = personCombineSelection.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(10).max(1000),
  acknowledged: z.literal(true),
  operationId: z.string().uuid(),
  confirmPassword: z.string().max(1024).optional(),
});
export const personReviewSelection = personCombineSelection
  .omit({ sources: true })
  .extend({ personId: z.string().min(1).max(128) });
export const personFinalizeInput = personReviewSelection.extend(
  personCombineInput.omit({ sources: true, retainedUserId: true, retireDuplicateLogins: true }).shape,
);
type Selection = z.input<typeof personCombineSelection>;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
// These legacy blockers protect its profile-mirror rewrite. This engine never
// copies a tutor username/email, so every original identifier stays reserved.
const legacyMirrorRewriteConflicts = new Set([
  "The linked tutor handle differs from its account handle. Reconcile the username in Edit profile before combining so no login identifier is silently released.",
  "The surviving username conflicts with another tutor profile.",
  "The surviving email conflicts with another tutor profile.",
]);

/** A review covers the whole explicit identity group, but access remains attached
 * to individual accounts. Neither equal names nor equal emails create an edge. */
async function plan(db: DomainDb, raw: Selection, reviewingGroup = false) {
  // A reviewed group can have one remaining source after an authorized deletion.
  // The public combine selector still requires two distinct records.
  const input = reviewingGroup
    ? personCombineSelection.extend({ sources: z.array(personSource).min(1) }).parse(raw)
    : personCombineSelection.parse(raw);
  const graph = await personGraph(db, input.sources);
  const term = await db.term.findFirst({
    where: { active: true },
    select: { id: true },
  });
  const live = graph.users.filter((r) => !r.mergedIntoId);
  const retainedUserId =
    input.retainedUserId ?? (live.length === 1 ? live[0]!.id : null);
  const retained = live.find((r) => r.id === retainedUserId);
  if (retainedUserId && !retained)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a current login from these records.",
    });
  const ready = (row: (typeof live)[number]) =>
    !!row.passwordHash &&
    !!row.emailVerifiedAt &&
    !row.mustChangePassword &&
    !row.suspendedAt;
  const historicalTutee = (row: (typeof graph.tutees)[number]) =>
    isHistoricalTutee(row, term?.id ?? null);
  const activeUnowned =
    graph.tutors.some((r) => !r.user && !isHistoricalTutor(r)) ||
    graph.tutees.some((r) => !r.user && !historicalTutee(r));
  const restricted = live.some(
    (r) => r.suspendedAt !== null || r.schoolDeparture !== null,
  );
  const conflicts: string[] = [];
  const blockers: PersonReviewItem[] = [];
  const userSource = (id: string) => ({ kind: "USER" as const, id });
  const retirementReviews = [];
  const pendingTutorRequests = await db.tutorStatusRequest.findMany({
    where: { tutorId: { in: graph.tutors.map((r) => r.id) }, state: "PENDING" },
    orderBy: { id: "asc" },
  });
  const openIntakes = await db.studentSurvey.findMany({
    where: {
      email: {
        in: live.flatMap((r) => [
          r.email,
          ...r.emails.map((address) => address.email),
        ]),
      },
      state: "OPEN",
      confirmedAt: null,
    },
    select: { id: true, email: true, tuteeId: true, submittedAt: true, verificationDueAt: true, expiresAt: true },
    orderBy: { id: "asc" },
  });
  // An archived label alone is insufficient if a recurring assignment still
  // depends on that login. Old-period assignments remain immutable evidence.
  const currentAssignments = await db.pairing.findMany({
    where: {
      term: { active: true },
      OR: [
        { tutorId: { in: graph.tutors.map((r) => r.id) } },
        {
          tutees: { some: { tuteeId: { in: graph.tutees.map((r) => r.id) } } },
        },
      ],
    },
    select: {
      id: true,
      termId: true,
      tutorId: true,
      tutees: { select: { tuteeId: true }, orderBy: { tuteeId: "asc" } },
    },
    orderBy: { id: "asc" },
  });
  const unownedAssignment = currentAssignments.some(
    (assignment) =>
      graph.tutors.some((row) => row.id === assignment.tutorId && !row.user) ||
      assignment.tutees.some((member) =>
        graph.tutees.some((row) => row.id === member.tuteeId && !row.user),
      ),
  );
  for (const row of graph.tutors.filter((r) => !r.user && !isHistoricalTutor(r)))
    blockers.push(personReviewItem("ACTIVE_UNOWNED_PROFILE", [{ kind: "TUTOR", id: row.id }], "/admin/tutors"));
  for (const row of graph.tutees.filter((r) => !r.user && !historicalTutee(r)))
    blockers.push(personReviewItem("ACTIVE_UNOWNED_PROFILE", [{ kind: "TUTEE", id: row.id }], "/admin/tutees"));
  for (const row of live) {
    if (row.suspendedAt) blockers.push(personReviewItem("ACCOUNT_SUSPENDED", [userSource(row.id)], "/admin/users"));
    if (row.schoolDeparture) blockers.push(personReviewItem("SCHOOL_DEPARTURE", [userSource(row.id)], "/admin/users"));
    if (!ready(row))
      blockers.push(personReviewItem("CREDENTIAL_SETUP_REQUIRED", [userSource(row.id)], "/admin/users", { blocksFinalization: row.id === retained?.id, blocksRetirement: row.id === retained?.id }));
  }
  for (const assignment of currentAssignments) {
    const sources = [
      ...graph.tutors.filter((r) => r.id === assignment.tutorId).map((r) => ({ kind: "TUTOR" as const, id: r.id })),
      ...graph.tutees.filter((r) => assignment.tutees.some((t) => t.tuteeId === r.id)).map((r) => ({ kind: "TUTEE" as const, id: r.id })),
    ];
    const unowned = sources.some((s) => s.kind === "TUTOR"
      ? !graph.tutors.find((r) => r.id === s.id)?.user
      : !graph.tutees.find((r) => r.id === s.id)?.user);
    const duplicateOwned = sources.some((s) => s.kind === "TUTOR"
      ? graph.tutors.some((r) => r.id === s.id && (r.user?.id ?? r.retainedOwner?.userId) !== retained?.id)
      : graph.tutees.some((r) => r.id === s.id && (r.user?.id ?? graph.ownership.find((o) => o.tuteeId === r.id)?.userId) !== retained?.id));
    blockers.push(personReviewItem("CURRENT_ASSIGNMENT", sources, "/admin/pairings", {
      work: [{ kind: "PAIRING", id: assignment.id, dueAt: null }],
      blocksFinalization: unowned || (input.retireDuplicateLogins && duplicateOwned),
      blocksRetirement: unowned || duplicateOwned,
    }));
  }
  // Pending work stays with its original domain. This projection contains IDs
  // and deadlines, never application answers, message bodies or proof material.
  const [approvals, crewRequests, studentRequests, historyInvitations, recordInvitations] = await Promise.all([
    db.approvalRequest.findMany({ where: { state: "PENDING" }, select: { id: true, requesterId: true, payload: true }, orderBy: { id: "asc" } }),
    db.crewStatusRequest.findMany({ where: { userId: { in: live.map((r) => r.id) }, state: "PENDING" }, select: { id: true, userId: true, eligibleAt: true }, orderBy: { id: "asc" } }),
    db.studentRequestReview.findMany({ where: { state: "PENDING", OR: [{ requestedByUserId: { in: live.map((r) => r.id) } }, { legacyTuteeId: { in: graph.tutees.map((r) => r.id) } }] }, select: { id: true, requestedByUserId: true, legacyTuteeId: true }, orderBy: { id: "asc" } }),
    db.tuteeHistoryInvitation.findMany({ where: { tuteeId: { in: graph.tutees.map((r) => r.id) }, expiresAt: { gt: new Date() } }, select: { tuteeId: true, expiresAt: true }, orderBy: { tuteeId: "asc" } }),
    db.historicalRecordInvitation.findMany({ where: { claimedAt: null, expiresAt: { gt: new Date() }, OR: [...graph.tutors.map((r) => ({ sources: { array_contains: [{ kind: "TUTOR", id: r.id }] } })), ...graph.tutees.map((r) => ({ sources: { array_contains: [{ kind: "TUTEE", id: r.id }] } }))] }, select: { scopeKey: true, sources: true, expiresAt: true }, orderBy: { scopeKey: "asc" } }),
  ]);
  for (const request of pendingTutorRequests) {
    const source = graph.tutors.find((row) => row.id === request.tutorId);
    const affectsRetirement = (source?.user?.id ?? source?.retainedOwner?.userId) !== retained?.id;
    blockers.push(personReviewItem("PENDING_TUTOR_REQUEST", [{ kind: "TUTOR", id: request.tutorId }], "/admin/tutor-requests", { work: [{ kind: "TUTOR_REQUEST", id: request.id, dueAt: null, availableAt: request.eligibleAt }], blocksFinalization: input.retireDuplicateLogins && affectsRetirement, blocksRetirement: affectsRetirement }));
  }
  for (const request of crewRequests)
    blockers.push(personReviewItem("PENDING_CREW_REQUEST", [userSource(request.userId)], "/admin/crew", { work: [{ kind: "CREW_REQUEST", id: request.id, dueAt: null, availableAt: request.eligibleAt }], blocksFinalization: input.retireDuplicateLogins }));
  for (const request of studentRequests)
    blockers.push(personReviewItem("PENDING_STUDENT_REQUEST", [userSource(request.requestedByUserId), ...(request.legacyTuteeId ? [{ kind: "TUTEE" as const, id: request.legacyTuteeId }] : [])], "/admin/tutee-requests", { work: [{ kind: "STUDENT_REQUEST", id: request.id, dueAt: null }], blocksFinalization: input.retireDuplicateLogins }));
  for (const request of approvals) {
    const sources = live.filter((r) => request.requesterId === r.id || JSON.stringify(request.payload).includes(r.id)).map((r) => userSource(r.id));
    if (sources.length) blockers.push(personReviewItem("PENDING_APPROVAL", sources, "/admin/approvals", { work: [{ kind: "APPROVAL", id: request.id, dueAt: null }], blocksFinalization: input.retireDuplicateLogins }));
  }
  for (const survey of openIntakes) {
    const sources = live.filter((r) => [r.email, ...r.emails.map((e) => e.email)].includes(survey.email)).map((r) => userSource(r.id));
    const affectsRetirement = sources.some((s) => s.id !== retained?.id);
    blockers.push(personReviewItem("UNCONFIRMED_INTAKE", sources, "/admin/requests", { work: [{ kind: "STUDENT_SURVEY", id: survey.id, dueAt: survey.verificationDueAt ?? survey.expiresAt }], blocksFinalization: input.retireDuplicateLogins && affectsRetirement, blocksRetirement: affectsRetirement }));
  }
  for (const invitation of historyInvitations)
    blockers.push(personReviewItem("PENDING_HISTORY_INVITATION", [{ kind: "TUTEE", id: invitation.tuteeId }], "/admin/tutees", { work: [{ kind: "TUTEE_HISTORY_INVITATION", id: invitation.tuteeId, dueAt: invitation.expiresAt }] }));
  for (const invitation of recordInvitations) {
    const parsed = z.array(personSource).safeParse(invitation.sources);
    if (parsed.success) blockers.push(personReviewItem("PENDING_HISTORY_INVITATION", parsed.data, "/admin/users", { work: [{ kind: "HISTORICAL_RECORD_INVITATION", id: invitation.scopeKey, dueAt: invitation.expiresAt }] }));
  }
  const requiresHead =
    live.length > 1 || activeUnowned || unownedAssignment || restricted;
  if (live.length > 1) {
    if (!retained)
      conflicts.push(
        "Choose the login to retain before retiring duplicate logins.",
      );
    else {
      for (const duplicate of live.filter((r) => r.id !== retained.id)) {
        const duplicateTutor = graph.tutors.find(
          (r) => r.id === duplicate.tutorId,
        );
        const duplicateTutee = graph.tutees.find(
          (r) => r.id === duplicate.studentId,
        );
        const duplicateTutorIds = new Set(
          graph.tutors
            .filter(
              (r) =>
                r.user?.id === duplicate.id ||
                r.retainedOwner?.userId === duplicate.id,
            )
            .map((r) => r.id),
        );
        const duplicateTuteeIds = new Set([
          ...(duplicate.studentId ? [duplicate.studentId] : []),
          ...graph.ownership
            .filter((r) => r.userId === duplicate.id)
            .map((r) => r.tuteeId),
        ]);
        const hasCurrentAssignment = currentAssignments.some(
          (assignment) =>
            duplicateTutorIds.has(assignment.tutorId) ||
            assignment.tutees.some((row) => duplicateTuteeIds.has(row.tuteeId)),
        );
        if (hasCurrentAssignment)
          conflicts.push(
            "Resolve the duplicate account's current-period assignments before retiring its login.",
          );
        if (
          pendingTutorRequests.some(
            (request) =>
              request.tutorId === duplicate.tutorId ||
              graph.tutors.some(
                (row) =>
                  row.id === request.tutorId &&
                  row.retainedOwner?.userId === duplicate.id,
              ),
          )
        )
          conflicts.push(
            "Resolve the duplicate account's pending tutor requests before retiring its login.",
          );
        if (
          openIntakes.some((survey) =>
            [
              duplicate.email,
              ...duplicate.emails.map((address) => address.email),
            ].includes(survey.email),
          )
        )
          conflicts.push(
            "Complete or withdraw the duplicate account's unconfirmed student intake before retiring its login.",
          );
        const review = await previewCombine(db, {
          survivorId: retained.id,
          duplicateId: duplicate.id,
        });
        retirementReviews.push(review);
        const safetyConflicts = review.conflicts.filter((text) => {
            if (
              text.includes("already holds combined history") ||
              legacyMirrorRewriteConflicts.has(text)
            )
              return false;
            // The survivor's current pointer is never replaced. Historical direct
            // profiles become retained read ownership after the login is retired.
            if (
              !hasCurrentAssignment &&
              duplicateTutor &&
              isHistoricalTutor(duplicateTutor) &&
              text ===
                "Both accounts have different tutor profiles. Resolve these links first; no tutor history will be discarded."
            )
              return false;
            if (
              !hasCurrentAssignment &&
              duplicateTutee &&
              historicalTutee(duplicateTutee) &&
              text ===
                "Both accounts have different current tutee profiles. Resolve these links first."
            )
              return false;
            return true;
          });
        conflicts.push(...safetyConflicts);
        // Requests, credentials, academics and capabilities have exact typed
        // projections above/below. Only carry legacy-only safety rules here so
        // the UI does not show a second, workless copy of the same issue.
        for (const message of safetyConflicts) {
          const reason = accountSafetyReason(message);
          if (["HEAD_ACCOUNT", "MESSAGING_DIFFERENCE", "ACCOUNT_RETIRED", "ACCOUNT_SAFETY_REVIEW"].includes(reason))
            blockers.push(personReviewItem(reason, [userSource(retained.id), userSource(duplicate.id)], "/admin/users", { blocksFinalization: input.retireDuplicateLogins }));
        }
        // The legacy flow can union memberships. This flow requires an explicit
        // resolution first, keeping the surviving account's authority unchanged.
        for (const field of [
          "role",
          "tuteeMember",
          "canTranslate",
          "crewStatus",
          "tutorAccessRevoked",
        ] as const) {
          if (retained[field] !== duplicate[field]) {
            conflicts.push(
              `Resolve differing ${field} decisions before retiring logins.`,
            );
            blockers.push(personReviewItem("CAPABILITY_DIFFERENCE", [userSource(retained.id), userSource(duplicate.id)], "/admin/users", { field, blocksFinalization: input.retireDuplicateLogins }));
          }
        }
        if (
          duplicate.tutorId &&
          !isHistoricalTutor(
            graph.tutors.find((r) => r.id === duplicate.tutorId)!,
          )
        ) {
          conflicts.push(
            "A duplicate login still owns a current tutor profile.",
          );
          blockers.push(personReviewItem("CURRENT_TUTOR_PROFILE", [userSource(duplicate.id), { kind: "TUTOR", id: duplicate.tutorId }], "/admin/tutors", { blocksFinalization: input.retireDuplicateLogins }));
        }
        if (
          duplicate.studentId &&
          !historicalTutee(
            graph.tutees.find((r) => r.id === duplicate.studentId)!,
          )
        ) {
          conflicts.push(
            "A duplicate login still owns a current tutee enrollment.",
          );
          blockers.push(personReviewItem("CURRENT_TUTEE_ENROLLMENT", [userSource(duplicate.id), { kind: "TUTEE", id: duplicate.studentId }], "/admin/tutees", { blocksFinalization: input.retireDuplicateLogins }));
        }
        const academic = (r: typeof retained) =>
          r.academicProfile
            ? {
                status: r.academicProfile.status,
                gradeLevel: r.academicProfile.gradeLevel,
                rawGrade: r.academicProfile.rawGrade,
                schoolYear: r.academicProfile.schoolYear,
                reconfirmRequired: r.academicProfile.reconfirmRequired,
              }
            : null;
        if (
          JSON.stringify(academic(retained)) !==
          JSON.stringify(academic(duplicate))
        ) {
          conflicts.push(
            "Resolve canonical academic profiles before retiring logins.",
          );
          blockers.push(personReviewItem("ACADEMIC_DIFFERENCE", [userSource(retained.id), userSource(duplicate.id)], "/admin/academic-corrections", { blocksFinalization: input.retireDuplicateLogins }));
        }
      }
    }
  }
  const canRetireLogins =
    live.length > 1 && !!retained && conflicts.length === 0 && !blockers.some((item) => item.blocksRetirement);
  if (live.length > 1) blockers.push(personReviewItem(
    retained ? "MULTIPLE_LIVE_LOGINS" : "RETAINED_LOGIN_REQUIRED",
    live.map((r) => userSource(r.id)), "/admin/users",
    { blocksFinalization: !(input.retireDuplicateLogins && canRetireLogins), blocksRetirement: !retained },
  ));
  const outcome =
    blockers.some((item) => item.blocksFinalization) ||
    activeUnowned ||
    unownedAssignment ||
    restricted ||
    (retained && !ready(retained)) ||
    (live.length > 1 && !(input.retireDuplicateLogins && canRetireLogins))
      ? ("REVIEW_REQUIRED" as const)
      : ("GROUPED" as const);
  const expandedSources = [
    ...graph.users.map((r) => ({ kind: "USER" as const, id: r.id })),
    ...graph.tutors.map((r) => ({ kind: "TUTOR" as const, id: r.id })),
    ...graph.tutees.map((r) => ({ kind: "TUTEE" as const, id: r.id })),
  ];
  const sourceRows = expandedSources.map((ref) => {
    if (ref.kind === "USER") {
      const r = graph.users.find((row) => row.id === ref.id)!;
      return {
        ref,
        name: r.name ?? r.username ?? r.email,
        email: r.email,
        status: r.mergedIntoId ? "RETIRED" : r.role,
        personId: r.personId,
        hasLogin: !r.mergedIntoId,
      };
    }
    if (ref.kind === "TUTOR") {
      const r = graph.tutors.find((row) => row.id === ref.id)!;
      return {
        ref,
        name: r.englishName,
        email: r.email,
        status: r.status,
        personId: r.personId,
        hasLogin: !!r.user || !!r.retainedOwner,
      };
    }
    const r = graph.tutees.find((row) => row.id === ref.id)!;
    return {
      ref,
      name: r.englishName,
      email: r.email,
      status: r.status,
      personId: r.personId,
      hasLogin: !!r.user || graph.ownership.some((o) => o.tuteeId === r.id),
    };
  });
  const personIds = new Set(sourceRows.map((r) => r.personId));
  const preview = {
    fingerprint: hash({
      input: { ...input, retainedUserId },
      graph,
      term,
      retirementReviews,
      pendingTutorRequests,
      openIntakes,
      currentAssignments,
      blockers,
    }),
    sources: sourceRows,
    accounts: live.map((r) => ({
      id: r.id,
      name: r.name ?? r.username ?? r.email,
      email: r.email,
      ready: ready(r),
    })),
    retainedUserId,
    requiresHead,
    alreadyTogether: personIds.size === 1 && !personIds.has(null),
    conflicts: [...new Set(conflicts)],
    blockers: [...new Map(blockers.map((item) => [item.id, item])).values()],
    warnings:
      outcome === "REVIEW_REQUIRED"
        ? [
            "Operational resolution remains required. Existing logins and their private access stay separate.",
          ]
        : [],
    canRetireLogins,
    retireDuplicateLogins: input.retireDuplicateLogins,
    outcome,
    counts: {
      users: graph.users.length,
      tutors: graph.tutors.length,
      tutees: graph.tutees.length,
    },
    authoritySummary: requiresHead
      ? "Head approval and current password are required."
      : "Admin or Head may confirm these unowned historical records.",
  };
  return { input, graph, live, retained, ready, historicalTutee, preview };
}

export async function previewPersonCombine(db: DomainDb, input: Selection) {
  return (await plan(db, input)).preview;
}

/** Review existing directory membership only. Reading this projection neither
 * advances revisions nor grants ownership, retires logins or clears review. */
async function planReview(db: DomainDb, raw: z.input<typeof personReviewSelection>) {
  const input = personReviewSelection.parse(raw);
  const person = await db.person.findUnique({ where: { id: input.personId } });
  if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "This identity group no longer exists." });
  if (person.mergedIntoId) throw new TRPCError({ code: "CONFLICT", message: "This group changed. Open its current directory entry and review again." });
  const [users, tutors, tutees] = await Promise.all([
    db.user.findMany({ where: { personId: person.id }, select: { id: true }, orderBy: { id: "asc" } }),
    db.tutor.findMany({ where: { personId: person.id }, select: { id: true }, orderBy: { id: "asc" } }),
    db.tutee.findMany({ where: { personId: person.id }, select: { id: true }, orderBy: { id: "asc" } }),
  ]);
  const sources = [
    ...users.map((r) => ({ kind: "USER" as const, id: r.id })),
    ...tutors.map((r) => ({ kind: "TUTOR" as const, id: r.id })),
    ...tutees.map((r) => ({ kind: "TUTEE" as const, id: r.id })),
  ];
  if (!sources.length) throw new TRPCError({ code: "CONFLICT", message: "This identity group has no remaining sources to review." });
  const planned = await plan(db, { ...input, sources }, true);
  if (planned.preview.sources.some((row) => row.personId !== person.id))
    throw new TRPCError({ code: "CONFLICT", message: "Source ownership crosses another identity group. Review Combine Records before finalizing." });
  return {
    ...planned,
    person,
    preview: {
      ...planned.preview,
      personId: person.id,
      // A grouping review must never authorize a finalization, or vice versa.
      fingerprint: hash({ action: "finalize", personId: person.id, snapshot: planned.preview.fingerprint }),
    },
  };
}

export async function reviewPersonParticipation(db: DomainDb, input: z.input<typeof personReviewSelection>) {
  return (await planReview(db, input)).preview;
}

export function personCombineReceiptResult(receipt: {
  id: string;
  personId: string;
  outcome: "GROUPED" | "REVIEW_REQUIRED";
  retiredUserIds: string[];
}) {
  return {
    ok: true as const,
    personId: receipt.personId,
    receiptId: receipt.id,
    outcome: receipt.outcome,
    retiredUserIds: receipt.retiredUserIds,
  };
}

/** One transaction records grouping, any independently safe read grants, explicit
 * retirement and its durable receipt. Retrying an accepted intent is read-only. */
export async function combinePersonRecords(
  db: DomainDb,
  actorId: string,
  raw: z.input<typeof personCombineInput>,
) {
  return commitPersonReview(db, actorId, personCombineInput.parse(raw));
}

export async function finalizePersonParticipation(
  db: DomainDb,
  actorId: string,
  raw: z.input<typeof personFinalizeInput>,
) {
  return commitPersonReview(db, actorId, personFinalizeInput.parse(raw));
}

async function commitPersonReview(
  db: DomainDb,
  actorId: string,
  reviewedInput: z.output<typeof personCombineInput> | z.output<typeof personFinalizeInput>,
) {
  const input = reviewedInput;
  const { confirmPassword: _password, ...intent } = input;
  void _password;
  const inputHash = hash(intent);
  return inTransaction(db, async (tx) => {
    // Pairing writers hold period before Tutor rows and planned-schedule writes.
    // Join that fence before namespace/account/table locks so our Pairing fence
    // cannot wait on a Tutor row whose writer is waiting for our table lock.
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockEntity(tx, "program:leadership");
    // Receipt lookup precedes source resolution: a completed intent remains
    // recoverable even if a later authorized workflow changes its source rows.
    const saved = await tx.personCombineReceipt.findUnique({
      where: { id: input.operationId },
    });
    if (saved) {
      const reviewer = await tx.user.findUnique({ where: { id: actorId } });
      if (
        !reviewer ||
        !["ADMIN", "HEAD"].includes(reviewer.role) ||
        reviewer.mergedIntoId ||
        reviewer.suspendedAt
      )
        throw new TRPCError({ code: "FORBIDDEN" });
      if (saved.actorId !== actorId || saved.inputHash !== inputHash)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This operation reference belongs to another reviewed intent.",
        });
      return personCombineReceiptResult(saved);
    }
    const finalizingPersonId = "personId" in input ? input.personId : null;
    const initial = "personId" in input
      ? (await planReview(tx, input)).graph
      : await personGraph(tx, input.sources);
    for (const id of [
      ...new Set([actorId, ...initial.users.map((r) => r.id)]),
    ].sort())
      await lockEntity(tx, `account-profile:${id}`);
    // Match the existing account-combine lock order; fence independent roster,
    // authority and ownership writers before validating the review snapshot.
    await tx.$executeRaw`LOCK TABLE "User", "Tutor", "Tutee", "Person", "AcademicProfile", "AccountEmail", "MessagePermission", "MessageRestriction", "StudentProfileOwnership", "TutorProfileOwnership", "PolicyAcceptance", "ApprovalRequest", "CrewStatusRequest", "StudentRequestReview", "StudentSurvey", "TutorStatusRequest", "Term", "SchoolDeparture", "Pairing", "PairingTutee", "TuteeHistoryInvitation", "HistoricalRecordInvitation" IN SHARE ROW EXCLUSIVE MODE`;
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (
      !actor ||
      !["ADMIN", "HEAD"].includes(actor.role) ||
      actor.mergedIntoId ||
      actor.suspendedAt
    )
      throw new TRPCError({ code: "FORBIDDEN" });
    const planned = "personId" in input ? await planReview(tx, input) : await plan(tx, input);
    const { graph, live, retained, ready, historicalTutee, preview } = planned;
    if (preview.requiresHead) {
      if (actor.role !== "HEAD")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Head review is required.",
        });
      if (
        !input.confirmPassword ||
        !verifyPasswordConfirmation(
          actorId,
          input.confirmPassword,
          actor.passwordHash,
        )
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Password is incorrect.",
        });
    }
    if (preview.fingerprint !== input.fingerprint)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Records changed. Reload and review the combination again.",
      });
    if (finalizingPersonId && (
      graph.persons.find((row) => row.id === finalizingPersonId)?.resolutionState !== "REVIEW_REQUIRED" ||
      preview.outcome !== "GROUPED"
    )) throw new TRPCError({
      code: "CONFLICT",
      message: "Resolve the remaining participation review items in their existing workflows, then refresh this review before finalizing.",
    });
    if (input.retireDuplicateLogins && !preview.canRetireLogins)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          preview.conflicts.join(" ") ||
          "These records do not have safely retireable duplicate logins.",
      });
    const canonical =
      graph.persons.find(
        (r) => r.id === retained?.personId && !r.mergedIntoId,
      ) ?? graph.persons.find((r) => !r.mergedIntoId);
    const person = canonical ?? (await tx.person.create({ data: {} }));
    const otherPersonIds = graph.persons
      .filter((r) => r.id !== person.id)
      .map((r) => r.id);
    await tx.person.updateMany({
      where: { id: { in: otherPersonIds } },
      data: {
        primaryUserId: null,
        mergedIntoId: person.id,
        revision: { increment: 1 },
      },
    });
    await tx.user.updateMany({
      where: { id: { in: graph.users.map((r) => r.id) } },
      data: { personId: person.id },
    });
    await assignParticipantPerson(
      tx,
      "TUTOR",
      graph.tutors.map((r) => r.id),
      person.id,
    );
    await assignParticipantPerson(
      tx,
      "TUTEE",
      graph.tutees.map((r) => r.id),
      person.id,
    );
    await tx.person.update({
      where: { id: person.id },
      data: {
        primaryUserId: retained?.id ?? null,
        resolutionState: preview.outcome,
        revision: { increment: 1 },
      },
    });
    const retiredUserIds: string[] = [];
    if (input.retireDuplicateLogins && retained) {
      for (const duplicate of live.filter((r) => r.id !== retained.id)) {
        // Release direct links before changing retained ownership. Immutable
        // historical actors and original login identifiers are left untouched.
        await tx.user.update({
          where: { id: duplicate.id },
          data: {
            mergedIntoId: retained.id,
            tutorId: null,
            studentId: null,
            passwordHash: null,
            sessionVersion: { increment: 1 },
            twoFactorEnabled: false,
          },
        });
        await tx.tutorProfileOwnership.updateMany({
          where: { userId: duplicate.id },
          data: { userId: retained.id, revision: { increment: 1 } },
        });
        await tx.studentProfileOwnership.updateMany({
          where: { userId: duplicate.id },
          data: { userId: retained.id, revision: { increment: 1 } },
        });
        if (duplicate.tutorId)
          await tx.tutorProfileOwnership.upsert({
            where: { tutorId: duplicate.tutorId },
            create: { tutorId: duplicate.tutorId, userId: retained.id },
            update: {},
          });
        if (duplicate.studentId)
          await tx.studentProfileOwnership.upsert({
            where: { tuteeId: duplicate.studentId },
            create: { tuteeId: duplicate.studentId, userId: retained.id },
            update: {},
          });
        await tx.studentQuarterBlock.updateMany({
          where: { userId: duplicate.id },
          data: { userId: retained.id },
        });
        await tx.notification.updateMany({
          where: { userId: duplicate.id },
          data: { userId: retained.id },
        });
        await tx.passwordResetToken.deleteMany({
          where: { userId: duplicate.id },
        });
        await tx.emailVerificationCode.deleteMany({
          where: { userId: duplicate.id },
        });
        await tx.studentActionConfirmation.deleteMany({
          where: { userId: duplicate.id },
        });
        await tx.emailDelivery.updateMany({
          where: { userId: duplicate.id, status: "PENDING" },
          data: { status: "CANCELLED", completedAt: new Date() },
        });
        retiredUserIds.push(duplicate.id);
      }
    }
    // Grant only after explicit safe retirement has established the final sole
    // principal. Identity-only groups with multiple live logins grant nothing.
    // Initial unowned sources exclude direct profiles already retained above.
    if (
      live.length - retiredUserIds.length === 1 &&
      retained &&
      ready(retained) &&
      !retained.schoolDeparture
    ) {
      for (const row of graph.tutors.filter(
        (r) => !r.user && !r.retainedOwner && isHistoricalTutor(r),
      )) {
        const review = await previewTutorHistory(tx, {
          tutorId: row.id,
          userId: retained.id,
        });
        await linkTutorHistory(tx, actorId, {
          tutorId: row.id,
          userId: retained.id,
          fingerprint: review.fingerprint,
          reason: input.reason,
          acknowledged: true,
        });
      }
      for (const row of graph.tutees.filter(
        (r) =>
          !r.user &&
          !graph.ownership.some((o) => o.tuteeId === r.id) &&
          historicalTutee(r),
      )) {
        const review = await previewHistoryLink(tx, {
          tuteeId: row.id,
          userId: retained.id,
        });
        await linkTuteeHistory(tx, actorId, {
          tuteeId: row.id,
          userId: retained.id,
          fingerprint: review.fingerprint,
          reason: input.reason,
          acknowledged: true,
        });
      }
    }
    await tx.auditLog.create({
      data: {
        userId: actorId,
        userName: actor.name ?? actor.username,
        entity: "Person",
        entityId: person.id,
        operation: finalizingPersonId ? "personCombine.finalize" : "personCombine.combine",
        action: finalizingPersonId ? "Finalized person participation review" : "Combined person records",
        details: {
          sources: planned.input.sources,
          ...(finalizingPersonId ? { reviewedPersonId: finalizingPersonId } : {}),
          reason: input.reason,
          fingerprint: input.fingerprint,
          outcome: preview.outcome,
          retainedUserId: retained?.id ?? null,
          retiredUserIds,
        },
      },
    });
    const receipt = await tx.personCombineReceipt.create({
      data: {
        id: input.operationId,
        actorId,
        inputHash,
        personId: person.id,
        outcome: preview.outcome,
        retiredUserIds,
      },
    });
    return personCombineReceiptResult(receipt);
  });
}
