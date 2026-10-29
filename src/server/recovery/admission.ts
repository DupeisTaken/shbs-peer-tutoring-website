import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  RECOVERY_EVIDENCE,
  recoveryCoveragePrefix,
  recoveryEventPrefix,
} from "~/lib/recovery-evidence";
import type {
  AdmissionRecoveryInput,
  AdmissionRecoveryPlan,
  AdmissionRecoveryResult,
} from "~/lib/recovery";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";
import { lockUsernameNamespace } from "~/server/auth/username-namespace";
import { databaseScope } from "~/server/db-scope";
import { recoveryAccountSelect, recoveryHash, recoveryJson } from "./capture";
import { preservedRecoveryEvent } from "./independent-changes";

const role = z.enum([
  "STUDENT",
  "VIEWER",
  "CREW",
  "TUTOR",
  "COORDINATOR",
  "ADMIN",
  "HEAD",
]);
const account = z.object({
  id: z.string(),
  role,
  tutorId: z.string().nullable(),
  tutorAccessRevoked: z.boolean(),
  recoveryVoidedAt: z.string().nullable().optional(),
});
const beforeSchema = z.object({
  application: z.object({
    status: z.enum(["PENDING", "INTERVIEW", "REJECTED"]),
    decisionComment: z.string().nullable(),
    decidedAt: z.string().nullable(),
    decidedByTutorId: z.string().nullable(),
    promotedTutorId: z.string().nullable(),
  }),
  tutor: z
    .object({
      id: z.string(),
      status: z.enum([
        "PENDING",
        "ACTIVE",
        "OPTED_OUT",
        "ARCHIVED",
        "GRADUATED",
        "TRANSFERRED",
      ]),
      preferredAssignedBlocks: z.number().nullable(),
    })
    .nullable(),
  account: account.nullable(),
});
const afterSchema = z.object({
  tutor: z.object({ id: z.string(), status: z.string() }).nullable(),
  account: account.nullable(),
  codeIds: z.array(z.string()),
});
const inputSchema = z.object({
  actionId: z.string().min(1),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  clientKey: z.string().uuid(),
  reason: z.string().trim().min(5).max(2000),
});
const registrationTables = new Set([
  "User",
  "Tutor",
  "RegistrationCode",
  "AccountInvitation",
  "Person",
  "AccountEmail",
  "AcademicProfile",
  "AcademicConfirmation",
  "HistoricalAcademicRecord",
  "Tutee",
]);
const assignmentTables = new Set([
  "Pairing",
  "PairingTutee",
  "PairingCreationRequest",
  "StudentSurvey",
  "Tutee",
  "MessageTutorAssignment",
]);
const unsupportedSchedulingTables = new Set([
  "StudentContinuationReceipt",
  "StudentContinuationAssignment",
  "StudentContinuationPairing",
  "SessionPlanContinuationMember",
  "SessionPlan",
  "SessionPlanAssignment",
  "SessionPlanCohort",
  "SessionPlanParticipant",
  "SessionPlanningSuggestion",
  "SessionPlanningRequest",
  "SessionPlanningOffer",
  "SessionPlanningResponse",
  "SessionPlanningReceipt",
  "SessionNotice",
  "SessionCalendarToken",
]);
const surveyClock = z.object({
  id: z.string(),
  tuteeId: z.string(),
  firstAssignedAt: z.string().nullable(),
  verificationDueAt: z.string().nullable(),
});
const messageAssignmentKey = z.object({
  tuteeId: z.string(),
  tutorId: z.string(),
});
/** PostgreSQL JSON renders timestamp-without-time-zone values without Z; these
 * database timestamps are UTC and must not inherit the operator's local zone. */
function journalDate(value: string | null): Date | null {
  return value
    ? new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : value + "Z")
    : null;
}
function changesOnly(before: unknown, after: unknown, allowed: string[]) {
  const parsed = z.record(z.string(), z.unknown());
  const a = parsed.safeParse(before);
  const b = parsed.safeParse(after);
  return (
    a.success &&
    b.success &&
    [...new Set([...Object.keys(a.data), ...Object.keys(b.data)])].every(
      (key) =>
        allowed.includes(key) ||
        JSON.stringify(a.data[key]) === JSON.stringify(b.data[key]),
    )
  );
}

async function graph(tx: TransactionDb, actionId: string) {
  const action = await tx.recoveryAction.findUnique({
    where: { id: actionId },
  });
  if (!action)
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "Admission provenance was not captured. Legacy audit evidence cannot establish a safe recovery.",
    });
  const before = beforeSchema.safeParse(action.before);
  const after = afterSchema.safeParse(action.after);
  const application = await tx.tutorApplication.findUnique({
    where: { id: action.applicationId },
    select: {
      id: true,
      type: true,
      name: true,
      status: true,
      email: true,
      updatedAt: true,
      promotedTutorId: true,
      invalidatedAt: true,
    },
  });
  const events = await tx.recoveryEvent.findMany({
    where: { actionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 101,
  });
  const changes = await tx.recoveryChange.findMany({
    where: { actionId },
    orderBy: { id: "asc" },
    take: 2001,
  });
  const tracked = await tx.recoveryTrackedEntity.findMany({
    where: { actionId },
    orderBy: [{ entity: "asc" }, { recordId: "asc" }],
    take: 1001,
  });
  const ids = (entity: string) =>
    tracked
      .filter((record) => record.entity === entity)
      .map((record) => record.recordId);
  const tutorId = after.success ? (after.data.tutor?.id ?? null) : null;
  const tutor = tutorId
    ? await tx.tutor.findUnique({
        where: { id: tutorId },
        select: {
          id: true,
          status: true,
          updatedAt: true,
          preferredAssignedBlocks: true,
        },
      })
    : null;
  const users = await tx.user.findMany({
    where: {
      OR: [{ id: { in: ids("User") } }, ...(tutorId ? [{ tutorId }] : [])],
    },
    select: recoveryAccountSelect,
    orderBy: { id: "asc" },
    take: 201,
  });
  const codes = await tx.registrationCode.findMany({
    where: { id: { in: after.success ? after.data.codeIds : [] } },
    select: {
      id: true,
      tutorId: true,
      usedAt: true,
      usedByUserId: true,
      expiresAt: true,
    },
    orderBy: { id: "asc" },
    take: 201,
  });
  const pairings = tutorId
    ? await tx.pairing.findMany({
        where: { tutorId },
        include: {
          tutees: { take: 401, orderBy: { tuteeId: "asc" } },
          term: { select: { active: true } },
          _count: { select: { sessions: true } },
        },
        orderBy: { id: "asc" },
        take: 201,
      })
    : [];
  const tuteeIds = [
    ...new Set(
      pairings.flatMap((pairing) => pairing.tutees.map((link) => link.tuteeId)),
    ),
  ].sort();
  const tutees = await tx.tutee.findMany({
    where: { id: { in: tuteeIds } },
    select: { id: true, status: true, updatedAt: true },
    orderBy: { id: "asc" },
    take: 401,
  });
  const clockChanges = changes.filter(
    (change) =>
      change.entity === "StudentSurvey" &&
      events.some(
        (event) => event.id === change.eventId && event.kind === "ASSIGNMENT",
      ),
  );
  const clockRestores = new Map<
    string,
    { before: z.infer<typeof surveyClock>; after: z.infer<typeof surveyClock> }
  >();
  for (const change of clockChanges) {
    const beforeClock = surveyClock.safeParse(change.before);
    const afterClock = surveyClock.safeParse(change.after);
    if (beforeClock.success && afterClock.success) {
      // Journal order retains the first attributable checkpoint across multiple
      // later assignment transactions instead of moving the deadline backwards twice.
      const original =
        clockRestores.get(beforeClock.data.id)?.before ?? beforeClock.data;
      clockRestores.set(beforeClock.data.id, {
        before: original,
        after: afterClock.data,
      });
    }
  }
  const surveys = await tx.studentSurvey.findMany({
    where: { id: { in: [...clockRestores.keys()] } },
    select: {
      id: true,
      tuteeId: true,
      firstAssignedAt: true,
      verificationDueAt: true,
    },
    orderBy: { id: "asc" },
    take: 401,
  });
  const messageKeys = changes
    .filter(
      (change) =>
        change.entity === "MessageTutorAssignment" &&
        change.operation === "INSERT",
    )
    .flatMap((change) => {
      const parsed = messageAssignmentKey.safeParse(change.recordKey);
      return parsed.success ? [parsed.data] : [];
    });
  const messageLinks = messageKeys.length
    ? await tx.messageTutorAssignment.findMany({
        where: { OR: messageKeys },
        orderBy: [{ tuteeId: "asc" }, { tutorId: "asc" }],
        take: 401,
      })
    : [];
  const receipt = await tx.recoveryReceipt.findUnique({ where: { actionId } });
  const independentAdmission =
    application && tutorId
      ? await tx.tutorApplication.count({
          where: {
            id: { not: action.applicationId },
            type: "INITIAL",
            status: "ACCEPTED",
            OR: [{ promotedTutorId: tutorId }, { email: application.email }],
          },
        })
      : 0;
  const missingCoverage = await tx.$queryRaw<
    Array<{ tableName: string }>
  >`SELECT tablename AS "tableName" FROM pg_tables p WHERE schemaname='public' AND tablename NOT LIKE 'Recovery%' AND tablename NOT IN ('_prisma_migrations','AuditLog','Notification','EmailDelivery','EmailOutbox','SignupMailAttempt','UsernameNamespaceGuard','SignupQuota','SignupLease','PublicApplicationRateLimit','CaptchaProof','CaptchaGrant') AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=format('%I.%I',p.schemaname,p.tablename)::regclass AND t.tgname='recovery_change_journal' AND t.tgenabled IN ('O','A') AND t.tgtype=29 AND t.tgfoid=CASE WHEN p.tablename IN ('StudentContinuationReceipt','StudentContinuationAssignment','StudentContinuationPairing','SessionPlanContinuationMember') THEN 'recovery_capture_continuation_change()'::regprocedure ELSE 'recovery_capture_change()'::regprocedure END) ORDER BY tablename`;
  const [replication] = await tx.$queryRaw<
    Array<{ mode: string }>
  >`SELECT current_setting('session_replication_role') AS mode`;
  return {
    action,
    before,
    after,
    application,
    events,
    changes,
    tracked,
    tutor,
    users,
    codes,
    pairings,
    tutees,
    surveys,
    clockRestores,
    messageLinks,
    receipt,
    independentAdmission,
    missingCoverage,
    replicationMode: replication?.mode,
  };
}

type Graph = Awaited<ReturnType<typeof graph>>;
// Transitive tracking includes learning-partner accounts. Only accounts attached
// to this admission receive compensation; related accounts remain independent.
function admissionAccounts(g: Graph) {
  return g.users.filter(
    (user) =>
      user.tutorId === g.tutor?.id ||
      (g.before.success && g.before.data.account?.id === user.id) ||
      (g.after.success && g.after.data.account?.id === user.id) ||
      g.codes.some((code) => code.usedByUserId === user.id),
  );
}
function buildPlan(g: Graph): AdmissionRecoveryPlan {
  const blockers: string[] = [];
  if (
    g.events.length > 100 ||
    g.changes.length > 2000 ||
    g.tracked.length > 1000 ||
    g.users.length > 200 ||
    g.codes.length > 200 ||
    g.pairings.length > 200 ||
    g.tutees.length > 400 ||
    g.surveys.length > 400 ||
    g.messageLinks.length > 400 ||
    g.pairings.some((pairing) => pairing.tutees.length > 400)
  )
    blockers.push(RECOVERY_EVIDENCE.graphLimit);
  if (
    g.action.kind !== "INITIAL_ADMISSION" ||
    !g.before.success ||
    !g.after.success
  )
    blockers.push(RECOVERY_EVIDENCE.missingEvidence);
  if (g.after.success && !g.after.data.account && !g.after.data.codeIds.length)
    blockers.push(RECOVERY_EVIDENCE.missingIssuance);
  if (g.after.success && g.codes.length !== g.after.data.codeIds.length)
    blockers.push(RECOVERY_EVIDENCE.missingAuthorization);
  if (
    !g.receipt &&
    (g.application?.status !== "ACCEPTED" ||
      g.application.type !== "INITIAL" ||
      !g.tutor)
  )
    blockers.push(RECOVERY_EVIDENCE.sourceChanged);
  if (g.application?.invalidatedAt) blockers.push(RECOVERY_EVIDENCE.invalidity);
  if (g.missingCoverage.length)
    blockers.push(
      recoveryCoveragePrefix +
        g.missingCoverage.map((record) => record.tableName).join(", "),
    );
  if (g.replicationMode !== "origin")
    blockers.push(RECOVERY_EVIDENCE.originRequired);
  if (
    g.surveys.length !== g.clockRestores.size ||
    g.surveys.some((survey) => {
      const expected = g.clockRestores.get(survey.id)?.after;
      return (
        !expected ||
        survey.firstAssignedAt?.getTime() !==
          journalDate(expected.firstAssignedAt)?.getTime() ||
        survey.verificationDueAt?.getTime() !==
          journalDate(expected.verificationDueAt)?.getTime()
      );
    })
  )
    blockers.push(RECOVERY_EVIDENCE.clockChanged);
  const rootEvents = g.events.filter((event) => event.kind === "ADMISSION");
  if (rootEvents.length !== 1) blockers.push(RECOVERY_EVIDENCE.sourceEvent);
  // Events group a whole transaction. A scheduling write inside trusted admission
  // capture still needs its own compensation adapter; the ADMISSION label must
  // not hide a commitment, consent receipt or private calendar capability.
  if (
    g.changes.some((change) => unsupportedSchedulingTables.has(change.entity))
  )
    blockers.push(recoveryEventPrefix + "UNSUPPORTED.");
  const later = g.events.filter((event) => event.kind !== "ADMISSION");
  for (const event of later) {
    const changes = g.changes.filter((change) => change.eventId === event.id);
    if (event.kind === "REGISTRATION") {
      const payload = z
        .object({ beforeAccount: account.nullable() })
        .safeParse(event.payload);
      if (
        !payload.success ||
        changes.some(
          (change) =>
            !registrationTables.has(change.entity) ||
            (change.entity === "User" &&
              change.operation === "UPDATE" &&
              !changesOnly(change.before, change.after, [
                "tutorId",
                "tutorAccessRevoked",
                "role",
                "sessionVersion",
                "profileVersion",
                "personId",
                "recoveryVoidedAt",
                "historyIdentityRevision",
              ])) ||
            (change.entity === "Tutee" &&
              (change.operation !== "UPDATE" ||
                !changesOnly(change.before, change.after, [
                  "updatedAt",
                  "historyIdentityRevision",
                ]))) ||
            (change.entity === "Person" &&
              change.operation === "UPDATE" &&
              !changesOnly(change.before, change.after, [
                "primaryUserId",
                "updatedAt",
              ])) ||
            change.operation === "DELETE",
        )
      )
        blockers.push(RECOVERY_EVIDENCE.registrationUnsupported);
    } else if (event.kind === "ASSIGNMENT") {
      if (
        changes.some(
          (change) =>
            !assignmentTables.has(change.entity) ||
            (change.entity === "PairingTutee" &&
              change.operation !== "INSERT") ||
            (change.entity === "Pairing" &&
              (change.operation === "DELETE" ||
                (change.operation === "UPDATE" &&
                  !changesOnly(change.before, change.after, [
                    "roomVersion",
                    "roomShortageKey",
                  ])))) ||
            (change.entity === "StudentSurvey" &&
              (change.operation !== "UPDATE" ||
                !changesOnly(change.before, change.after, [
                  "firstAssignedAt",
                  "verificationDueAt",
                  "updatedAt",
                ]))) ||
            (change.entity === "Tutee" &&
              (change.operation !== "UPDATE" ||
                !changesOnly(change.before, change.after, [
                  "status",
                  "updatedAt",
                ]))) ||
            (change.entity === "MessageTutorAssignment" &&
              change.operation !== "INSERT"),
        )
      )
        blockers.push(RECOVERY_EVIDENCE.assignmentUnsupported);
    } else if (event.kind === "INVITATION") {
      if (changes.some((change) => change.entity !== "AccountInvitation"))
        blockers.push(RECOVERY_EVIDENCE.invitationUnsupported);
    } else if (!preservedRecoveryEvent(changes))
      blockers.push(recoveryEventPrefix + event.kind + ".");
  }
  const createdPairings = new Set(
    g.changes
      .filter(
        (change) =>
          change.entity === "Pairing" && change.operation === "INSERT",
      )
      .flatMap((change) => {
        const key = z.object({ id: z.string() }).safeParse(change.recordKey);
        return key.success ? [key.data.id] : [];
      }),
  );
  const independentBefore =
    g.before.success && g.before.data.tutor?.status === "ACTIVE";
  if (
    !independentBefore &&
    !g.independentAdmission &&
    g.pairings.some(
      (pairing) =>
        !createdPairings.has(pairing.id) ||
        !pairing.term.active ||
        pairing._count.sessions > 0,
    )
  )
    blockers.push(RECOVERY_EVIDENCE.existingParticipation);
  for (const code of g.codes)
    if (
      code.usedAt &&
      code.usedByUserId &&
      !g.events.some((event) => event.kind === "REGISTRATION")
    )
      blockers.push(RECOVERY_EVIDENCE.missingRegistration);
  const accounts = admissionAccounts(g).map((user) => user.id);
  const fingerprint = recoveryHash({
    adapterVersion: 2,
    action: g.action,
    changes: g.changes.map((change) => ({
      ...change,
      id: change.id.toString(),
    })),
    events: g.events,
    application: g.application,
    tutor: g.tutor,
    users: g.users,
    codes: g.codes,
    pairings: g.pairings,
    tutees: g.tutees,
    surveys: g.surveys,
    messageLinks: g.messageLinks,
    independentAdmission: g.independentAdmission,
    missingCoverage: g.missingCoverage,
    replicationMode: g.replicationMode,
  });
  return {
    version: 1,
    actionId: g.action.id,
    applicationId: g.action.applicationId,
    applicantName: g.application?.name ?? null,
    fingerprint,
    coverage: blockers.length ? "UNKNOWN" : "COMPLETE",
    dependentEventCount: later.length,
    websiteEligible: !blockers.length && later.length <= 1 && !g.receipt,
    blockers: [...new Set(blockers)],
    warnings: [
      RECOVERY_EVIDENCE.preserveHistory,
      RECOVERY_EVIDENCE.preserveIdentity,
      ...(later.some((event) =>
        preservedRecoveryEvent(
          g.changes.filter((change) => change.eventId === event.id),
        ),
      )
        ? [RECOVERY_EVIDENCE.preserveLaterEdits]
        : []),
      ...(independentBefore || g.independentAdmission
        ? [RECOVERY_EVIDENCE.preserveAdmission]
        : []),
    ],
    effects: {
      registrationCodeCount: g.codes.length,
      tutorId: g.tutor?.id ?? null,
      accountIds: accounts,
      pairingIds:
        independentBefore || g.independentAdmission
          ? []
          : g.pairings.map((pairing) => pairing.id),
      tuteeIds:
        independentBefore || g.independentAdmission
          ? []
          : g.tutees.map((tutee) => tutee.id),
      verificationClockIds:
        independentBefore || g.independentAdmission
          ? []
          : g.surveys.map((survey) => survey.id),
      messageLinkIds:
        independentBefore || g.independentAdmission
          ? []
          : g.messageLinks.map((link) => `${link.tuteeId}:${link.tutorId}`),
    },
    events: g.events.map((event) => ({
      id: event.id,
      kind: event.kind,
      summary: g.changes
        .filter((change) => change.eventId === event.id)
        .every((change) => change.entity === "RegistrationCode")
        ? ("CODE_RESTRICTION" as const)
        : g.changes.some(
              (change) =>
                change.eventId === event.id &&
                change.entity === "Tutor" &&
                Array.isArray(change.changedFields) &&
                change.changedFields.includes("preferredAssignedBlocks"),
            )
          ? ("WORKLOAD_PREFERENCE" as const)
          : ("INDEPENDENT_UPDATE" as const),
      disposition:
        event.kind !== "ADMISSION" &&
        preservedRecoveryEvent(
          g.changes.filter((change) => change.eventId === event.id),
        )
          ? ("PRESERVED" as const)
          : ("REVIEW" as const),
      createdAt: event.createdAt.toISOString(),
    })),
    alreadyVoided: !!g.receipt,
  };
}

export function inspectAdmissionRecovery(
  db: DomainDb,
  input: { actionId: string },
): Promise<AdmissionRecoveryPlan> {
  const ownsTransaction = "$transaction" in db && !databaseScope.getStore();
  return inTransaction(
    db,
    async (tx) => {
      // Readers may compose with approval/CLI transactions. Only the transaction
      // owner changes its mode, before issuing the first planner query.
      if (ownsTransaction)
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return buildPlan(await graph(tx, input.actionId));
    },
    { isolationLevel: "RepeatableRead" },
  );
}

async function apply(
  db: DomainDb,
  raw: AdmissionRecoveryInput,
  actor: { id: string },
  channel: "WEBSITE" | "OPERATOR",
): Promise<AdmissionRecoveryResult> {
  const input = inputSchema.parse(raw);
  return inTransaction(
    db,
    async (tx) => {
      // Match assignment -> namespace -> application lock ordering. The shared
      // journal fence closes the preview/apply race, including raw SQL descendants.
      await lockEntity(tx, "program:period");
      await lockUsernameNamespace(tx);
      const source = await tx.recoveryAction.findUniqueOrThrow({
        where: { id: input.actionId },
      });
      await lockEntity(tx, `interview:${source.applicationId}`);
      await tx.$queryRaw`SELECT id FROM "TutorApplication" WHERE id = ${source.applicationId} FOR UPDATE`;
      await lockEntity(tx, `recovery:${input.actionId}`);
      // A row-version write rejects an old Serializable snapshot even when it
      // waited on the advisory fence after a descendant committed.
      await tx.$executeRaw`INSERT INTO "RecoveryFence"("actionId","revision") VALUES(${input.actionId},1) ON CONFLICT ("actionId") DO UPDATE SET revision="RecoveryFence".revision+1`;
      const principal = await tx.user.findUnique({
        where: { id: actor.id },
        select: {
          role: true,
          suspendedAt: true,
          mergedIntoId: true,
          recoveryVoidedAt: true,
        },
      });
      if (
        !principal ||
        !["ADMIN", "HEAD"].includes(principal.role) ||
        principal.suspendedAt ||
        principal.mergedIntoId ||
        principal.recoveryVoidedAt
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "A current Admin or Head must authorize recovery.",
        });
      const inputHash = recoveryHash(input);
      const previous = await tx.recoveryReceipt.findUnique({
        where: {
          actorId_clientKey: { actorId: actor.id, clientKey: input.clientKey },
        },
      });
      if (previous) {
        if (previous.inputHash !== inputHash)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This retry key belongs to a different recovery intent.",
          });
        return {
          actionId: previous.actionId,
          receiptId: previous.id,
          replayed: true,
        };
      }
      const g = await graph(tx, input.actionId);
      const plan = buildPlan(g);
      if (g.receipt)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This admission was already voided. Read its immutable receipt.",
        });
      if (plan.fingerprint !== input.expectedFingerprint)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The causal recovery scope changed. Inspect and review it again.",
        });
      if (plan.coverage !== "COMPLETE")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: plan.blockers.join(" "),
        });
      if (channel === "WEBSITE" && plan.dependentEventCount >= 2)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Two or more later dependent events require the operator CLI.",
        });
      const before = beforeSchema.parse(g.action.before);
      await tx.$queryRaw`SELECT set_config('shbs.recovery_compensating','1',true)`;
      const independent =
        before.tutor?.status === "ACTIVE" || g.independentAdmission > 0;
      await tx.registrationCode.updateMany({
        where: { id: { in: g.codes.map((code) => code.id) } },
        data: {
          expiresAt: new Date(0),
          emailVerifiedAt: null,
          emailCodeHash: null,
          emailCodeExpiresAt: null,
        },
      });
      if (!independent && g.tutor) {
        await tx.pairingTutee.deleteMany({
          where: { pairingId: { in: plan.effects.pairingIds } },
        });
        // Pairing creation also grants an enduring messaging relationship through
        // a database trigger. Revoke only edges first created by these assignments;
        // retain existing history and any independently supported relationship.
        for (const change of g.changes.filter(
          (row) =>
            row.entity === "MessageTutorAssignment" &&
            row.operation === "INSERT",
        )) {
          const key = messageAssignmentKey.parse(change.recordKey);
          // Interactive transactions share one PostgreSQL connection; keep these
          // dependent support checks serial rather than queueing overlapping I/O.
          const remainingAssignments = await tx.pairingTutee.count({
            where: { tuteeId: key.tuteeId, pairing: { tutorId: key.tutorId } },
          });
          const historicalSessions = await tx.sessionTutee.count({
            where: { tuteeId: key.tuteeId, session: { tutorId: key.tutorId } },
          });
          if (!remainingAssignments && !historicalSessions)
            await tx.messageTutorAssignment.deleteMany({ where: key });
        }
        for (const restore of g.clockRestores.values()) {
          const surviving = await tx.pairingTutee.count({
            where: {
              tuteeId: restore.before.tuteeId,
              pairing: {
                term: { active: true },
                tutor: {
                  status: "ACTIVE",
                  OR: [
                    { user: null },
                    {
                      user: {
                        tutorAccessRevoked: false,
                        suspendedAt: null,
                        mergedIntoId: null,
                      },
                    },
                  ],
                },
              },
            },
          });
          if (!surviving)
            await tx.studentSurvey.update({
              where: { id: restore.before.id },
              data: {
                firstAssignedAt: journalDate(restore.before.firstAssignedAt),
                verificationDueAt: journalDate(
                  restore.before.verificationDueAt,
                ),
              },
            });
        }
        await tx.tutee.updateMany({
          where: {
            id: { in: plan.effects.tuteeIds },
            status: "ACTIVE",
            pairings: {
              none: {
                pairing: {
                  term: { active: true },
                  tutor: {
                    status: "ACTIVE",
                    OR: [
                      { user: null },
                      {
                        user: {
                          tutorAccessRevoked: false,
                          suspendedAt: null,
                          mergedIntoId: null,
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
          data: { status: "PENDING" },
        });
        // Pairing records stay as historical planning evidence; their recurring
        // reservations are removed atomically with the dependent student links.
        await tx.pairing.updateMany({
          where: { id: { in: plan.effects.pairingIds } },
          data: {
            scheduleConfirmed: false,
            roomId: null,
            roomNeedsAssignment: false,
          },
        });
        await tx.tutor.update({
          where: { id: g.tutor.id },
          data: {
            status: before.tutor?.status ?? "ARCHIVED",
            ...(before.tutor
              ? {
                  preferredAssignedBlocks: before.tutor.preferredAssignedBlocks,
                }
              : {}),
          },
        });
      }
      if (!g.independentAdmission)
        for (const user of admissionAccounts(g)) {
          const prior =
            before.account?.id === user.id
              ? before.account
              : g.events
                  .filter((event) => event.kind === "REGISTRATION")
                  .map(
                    (event) =>
                      z
                        .object({ beforeAccount: account.nullable() })
                        .parse(event.payload).beforeAccount,
                  )
                  .find((candidate) => candidate?.id === user.id);
          const created = g.changes.some(
            (change) =>
              change.entity === "User" &&
              change.operation === "INSERT" &&
              (change.recordKey as { id?: string }).id === user.id,
          );
          if (prior) {
            // Restore only access actually added by admission. Independent student,
            // Crew, translator, suspension and credential facts stay authoritative.
            await tx.user.update({
              where: { id: user.id },
              data: {
                tutorId: prior.tutorId,
                tutorAccessRevoked: prior.tutorAccessRevoked,
                ...(prior.recoveryVoidedAt
                  ? {
                      recoveryVoidedAt: new Date(prior.recoveryVoidedAt),
                      passwordHash: null,
                    }
                  : {}),
                ...(user.role === "TUTOR" && prior.role !== "TUTOR"
                  ? { role: prior.role }
                  : {}),
              },
            });
          } else if (created) {
            const independentAccess =
              user.tuteeMember ||
              !!user.studentId ||
              !!user.crewStatus ||
              user.canTranslate ||
              ["ADMIN", "HEAD", "COORDINATOR", "VIEWER", "CREW"].includes(
                user.role,
              );
            await tx.user.update({
              where: { id: user.id },
              data: {
                tutorAccessRevoked: true,
                ...(independentAccess
                  ? {}
                  : { passwordHash: null, recoveryVoidedAt: new Date() }),
              },
            });
            if (!independentAccess) {
              await tx.passwordResetToken.deleteMany({
                where: { userId: user.id },
              });
              await tx.emailVerificationCode.deleteMany({
                where: { userId: user.id },
              });
            }
          } else
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "Account origin is unknown; the transaction was rolled back.",
            });
        }
      await tx.tutorApplication.update({
        where: { id: source.applicationId },
        data: {
          status: before.application.status,
          decisionComment: before.application.decisionComment,
          decidedAt: before.application.decidedAt
            ? new Date(before.application.decidedAt)
            : null,
          decidedByTutorId: before.application.decidedByTutorId,
          promotedTutorId: before.application.promotedTutorId,
        },
      });
      const receipt = await tx.recoveryReceipt.create({
        data: {
          actionId: input.actionId,
          actorId: actor.id,
          clientKey: input.clientKey,
          inputHash,
          reason: input.reason,
          channel,
          fingerprint: plan.fingerprint,
          evidence: recoveryJson({
            version: 1,
            plan,
            before: g.action.before,
            preservedInterviewEvidence: true,
          }),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          entity: "TutorApplication",
          entityId: source.applicationId,
          kind: "REVERSAL",
          operation: "recovery.voidAdmission",
          action:
            "Voided an initial admission and its supported causal consequences",
          details: recoveryJson({
            originalActionId: input.actionId,
            receiptId: receipt.id,
            reason: input.reason,
            dependentEventCount: plan.dependentEventCount,
            channel,
          }),
        },
      });
      return {
        actionId: input.actionId,
        receiptId: receipt.id,
        replayed: false,
      };
    },
    { isolationLevel: "Serializable" },
  );
}

/** Website callers have no channel input and cannot request the operator override. */
export const applyAdmissionRecovery = (
  db: DomainDb,
  input: AdmissionRecoveryInput,
  actor: { id: string },
) => apply(db, input, actor, "WEBSITE");
/** Imported by the local operator executable only; no router may expose this entrypoint. */
export const applyAdmissionRecoveryFromOperator = (
  db: DomainDb,
  input: AdmissionRecoveryInput,
  actor: { id: string },
) => apply(db, input, actor, "OPERATOR");
