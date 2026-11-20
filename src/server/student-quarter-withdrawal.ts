import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { lockAccountProfile } from "./account-profile-lock";
import { lockUsernameNamespace } from "./auth/username-namespace";
import {
  executionAssignments,
  executionPairingId,
  executionParticipantId,
  pairingEvidenceIds,
  supersededPairingIds,
} from "./participant-execution";
import { preserveHistoricalAcademics } from "./historical-academic-snapshot";
import { quarterBlockAccountWhere } from "./history-row-ownership";
import { lockCatalogue } from "./qualifications";
import { lockStudentRequestReview } from "./request-review";
import {
  lockSessionPlanning,
  releaseSessionLegacyParticipation,
} from "./session-planning";
import {
  lockStudentRequestExecution,
  studentRequestExecutionAssignments,
} from "./student-request-execution";
import { closeStudentRequest } from "./student-request-state";
import { lockEntity, type DomainDb, type TransactionDb } from "./transactions";

const LIMIT = 1000;
const stamp = z.string().nullable();
const reviewSchema = z
  .object({
    id: z.string(),
    surveyId: z.string().nullable(),
    legacyTuteeId: z.string().nullable(),
    legacyIntakeTermId: z.string().nullable(),
    kind: z.string(),
    state: z.string(),
    requestedByUserId: z.string(),
    pairingId: z.string().nullable(),
    createdAt: z.string(),
    resolvedAt: stamp,
    resolvedByUserId: z.string().nullable(),
  })
  .strict();
const assignmentSchema = z
  .object({
    surveyId: z.string(),
    pairingId: z.string(),
    tuteeId: z.string(),
    sourceTuteeId: z.string(),
    revision: z.number(),
    releasedAt: stamp,
  })
  .strict();
const list = <T extends z.ZodType>(schema: T) => z.array(schema).max(LIMIT);

/** Inspection snapshots contain authority and lifecycle identifiers only. Never
 * add application answers, signatures, review reasons or credential material. */
export const quarterWithdrawalEvidenceSchema = z
  .object({
    version: z.literal(1),
    review: reviewSchema,
    authorityBlockers: z.array(z.string()).max(LIMIT),
    owner: z
      .object({
        id: z.string(),
        studentId: z.string().nullable(),
        emailHash: z.string(),
        sessionVersion: z.number(),
        historyAccessRevision: z.number(),
        suspendedAt: stamp,
        mergedIntoId: z.string().nullable(),
        recoveryVoidedAt: stamp,
      })
      .strict()
      .nullable(),
    term: z
      .object({ id: z.string(), active: z.boolean(), createdAt: z.string() })
      .strict()
      .nullable(),
    profiles: list(
      z
        .object({
          id: z.string(),
          intakeTermId: z.string().nullable(),
          status: z.string(),
          directOwnerIds: z.array(z.string()).max(100),
          retainedOwner: z
            .object({ userId: z.string(), revision: z.number() })
            .strict()
            .nullable(),
          executionTuteeId: z.string(),
        })
        .strict(),
    ),
    sources: list(
      z
        .object({
          id: z.string(),
          tuteeId: z.string().nullable(),
          intakeTermId: z.string(),
          state: z.string(),
          currentVersion: z.number(),
          invalidityVersion: z.number(),
          confirmedAt: stamp,
          verificationDueAt: stamp,
          resolvedAt: stamp,
        })
        .strict(),
    ),
    assignments: list(assignmentSchema),
    effectiveAssignments: list(
      assignmentSchema.omit({ revision: true, releasedAt: true }),
    ),
    manualAssignments: list(
      z
        .object({
          sourceTuteeId: z.string(),
          sourcePairingId: z.string(),
          pairingId: z.string(),
          tuteeId: z.string(),
          receiptId: z.string().nullable(),
          revision: z.number(),
          path: z
            .array(
              z
                .object({
                  sourcePairingId: z.string(),
                  targetPairingId: z.string(),
                  sourceTuteeId: z.string(),
                  targetTuteeId: z.string(),
                  receiptId: z.string(),
                  pairingRevision: z.number(),
                  participantRevision: z.number().nullable(),
                })
                .strict(),
            )
            .max(100),
        })
        .strict(),
    ),
    pairings: list(
      z
        .object({
          id: z.string(),
          termId: z.string(),
          tutorId: z.string(),
          subject: z.string(),
          scheduleConfirmed: z.boolean(),
          dayOfWeek: z.number(),
          startMin: z.number(),
          endMin: z.number(),
          roomVersion: z.number(),
        })
        .strict(),
    ),
    members: list(
      z.object({ pairingId: z.string(), tuteeId: z.string() }).strict(),
    ),
    consolidations: list(
      z
        .object({
          sourceId: z.string(),
          targetId: z.string(),
          active: z.boolean(),
          revision: z.number(),
        })
        .strict(),
    ),
    pendingReviews: list(reviewSchema),
    blocks: list(
      z
        .object({
          id: z.string(),
          emailHash: z.string(),
          intakeTermId: z.string(),
          surveyId: z.string().nullable(),
          legacyTuteeId: z.string().nullable(),
          userId: z.string().nullable(),
        })
        .strict(),
    ),
    publication: z
      .object({
        plans: list(
          z
            .object({
              id: z.string(),
              termId: z.string(),
              sourceFingerprint: z.string(),
              sourceScheduleFingerprint: z.string(),
            })
            .strict(),
        ),
        participants: list(
          z
            .object({
              id: z.string(),
              planId: z.string(),
              tuteeId: z.string(),
              cohortId: z.string().nullable(),
              status: z.string(),
              version: z.number(),
            })
            .strict(),
        ),
        cohorts: list(
          z
            .object({
              id: z.string(),
              planId: z.string(),
              status: z.string(),
              version: z.number(),
              startsAt: z.string(),
              endsAt: z.string(),
              scheduledParticipantCount: z.number(),
            })
            .strict(),
        ),
        continuationMembers: list(
          z
            .object({
              planId: z.string(),
              pairingId: z.string(),
              tuteeId: z.string(),
              assignmentId: z.string().nullable(),
              sourceSurveyId: z.string().nullable(),
              sourceTuteeId: z.string().nullable(),
              joinedAt: z.string(),
              releasedAt: stamp,
            })
            .strict(),
        ),
        executions: list(
          z
            .object({
              participantId: z.string(),
              tuteeId: z.string(),
              sourceSurveyIds: z.array(z.string()).max(LIMIT),
              revision: z.number(),
            })
            .strict(),
        ),
        planExecutions: list(
          z
            .object({
              planId: z.string(),
              tutorId: z.string(),
              revision: z.number(),
              assignments: executionAssignments,
            })
            .strict(),
        ),
        responseExecutions: list(
          z
            .object({
              responseId: z.string(),
              userId: z.string(),
              profileKind: z.string(),
              profileId: z.string(),
              revision: z.number(),
            })
            .strict(),
        ),
        requests: list(
          z
            .object({
              id: z.string(),
              planId: z.string(),
              status: z.string(),
              version: z.number(),
              currentOfferId: z.string().nullable(),
            })
            .strict(),
        ),
        responses: list(
          z
            .object({
              id: z.string(),
              offerId: z.string(),
              actorUserId: z.string(),
              actorKey: z.string(),
              state: z.string(),
              deadline: stamp,
              respondedAt: stamp,
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();
export type QuarterWithdrawalEvidence = z.infer<
  typeof quarterWithdrawalEvidenceSchema
>;

function invalid(message: string): never {
  throw new TRPCError({ code: "PRECONDITION_FAILED", message });
}
function bounded<T>(rows: T[]): T[] {
  if (rows.length > LIMIT)
    invalid(
      "Too much participation evidence to safely review this withdrawal. Contact staff.",
    );
  return rows;
}
const iso = (value: Date | null) => value?.toISOString() ?? null;
const emailHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const reviewSelect = {
  id: true,
  surveyId: true,
  legacyTuteeId: true,
  legacyIntakeTermId: true,
  kind: true,
  state: true,
  requestedByUserId: true,
  pairingId: true,
  createdAt: true,
  resolvedAt: true,
  resolvedByUserId: true,
} as const;
const sourceSelect = {
  id: true,
  tuteeId: true,
  intakeTermId: true,
  state: true,
  currentVersion: true,
  invalidityVersion: true,
  confirmedAt: true,
  verificationDueAt: true,
  resolvedAt: true,
} as const;

async function loadScope(db: DomainDb, reviewId: string) {
  const review = await db.studentRequestReview.findUniqueOrThrow({
    where: { id: reviewId },
    select: reviewSelect,
  });
  const trigger = review.surveyId
    ? await db.studentSurvey.findUnique({
        where: { id: review.surveyId },
        select: sourceSelect,
      })
    : null;
  const termId = trigger?.intakeTermId ?? review.legacyIntakeTermId;
  const [owner, retained, term] = await Promise.all([
    db.user.findUnique({
      where: { id: review.requestedByUserId },
      select: {
        id: true,
        studentId: true,
        email: true,
        sessionVersion: true,
        historyAccessRevision: true,
        suspendedAt: true,
        mergedIntoId: true,
        recoveryVoidedAt: true,
      },
    }),
    db.studentProfileOwnership.findMany({
      where: { userId: review.requestedByUserId },
      orderBy: { tuteeId: "asc" },
      take: LIMIT + 1,
    }),
    termId
      ? db.term.findUnique({
          where: { id: termId },
          select: { id: true, active: true, createdAt: true },
        })
      : null,
  ]);
  bounded(retained);
  const ownedIds = [
    ...new Set([
      ...retained.map((row) => row.tuteeId),
      ...(owner?.studentId ? [owner.studentId] : []),
    ]),
  ].sort();
  const triggerId = trigger?.tuteeId ?? review.legacyTuteeId;
  const originalIds = [
    ...new Set([...ownedIds, ...(triggerId ? [triggerId] : [])]),
  ].sort();
  const executionIds = new Map<string, string>();
  for (const id of originalIds)
    executionIds.set(id, await executionParticipantId(db, "TUTEE", id));
  const profileIds = [
    ...new Set([...originalIds, ...executionIds.values()]),
  ].sort();
  for (const id of profileIds)
    if (!executionIds.has(id))
      executionIds.set(id, await executionParticipantId(db, "TUTEE", id));
  const [profiles, directOwners, ownerships, sources, members, consolidations] =
    await Promise.all([
      db.tutee.findMany({
        where: { id: { in: profileIds } },
        select: { id: true, status: true, intakeTermId: true },
        orderBy: { id: "asc" },
        take: LIMIT + 1,
      }),
      db.user.findMany({
        where: { studentId: { in: profileIds } },
        select: { id: true, studentId: true },
        orderBy: { id: "asc" },
        take: LIMIT + 1,
      }),
      db.studentProfileOwnership.findMany({
        where: { tuteeId: { in: profileIds } },
        orderBy: { tuteeId: "asc" },
        take: LIMIT + 1,
      }),
      db.studentSurvey.findMany({
        where: {
          OR: [
            { tuteeId: { in: profileIds } },
            ...(trigger ? [{ id: trigger.id }] : []),
          ],
        },
        select: sourceSelect,
        orderBy: { id: "asc" },
        take: LIMIT + 1,
      }),
      db.pairingTutee.findMany({
        where: {
          tuteeId: { in: profileIds },
          pairing: { termId: termId ?? "" },
          pairingId: { notIn: await supersededPairingIds(db) },
        },
        select: { pairingId: true, tuteeId: true },
        orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }],
        take: LIMIT + 1,
      }),
      db.participantConsolidation.findMany({
        where: {
          kind: "TUTEE",
          OR: [
            { sourceId: { in: profileIds } },
            { targetId: { in: profileIds } },
          ],
        },
        select: {
          sourceId: true,
          targetId: true,
          active: true,
          revision: true,
        },
        orderBy: { sourceId: "asc" },
        take: LIMIT + 1,
      }),
    ]);
  for (const rows of [
    profiles,
    directOwners,
    ownerships,
    sources,
    members,
    consolidations,
  ])
    if (rows.length > LIMIT)
      invalid(
        "Too much participation evidence to safely review this withdrawal. Contact staff.",
      );
  const scopeSources = sources.filter((row) => row.intakeTermId === termId);
  const manualAssignments: QuarterWithdrawalEvidence["manualAssignments"] = [];
  const authorityBlockers: string[] = [];
  const manualIds = profiles
    .filter(
      (profile) =>
        ownedIds.includes(profile.id) &&
        !sources.some((source) => source.tuteeId === profile.id),
    )
    .map((profile) => profile.id);
  const manualLinks = bounded(
    await db.pairingTutee.findMany({
      where: { tuteeId: { in: manualIds }, pairing: { termId: termId ?? "" } },
      select: { pairingId: true, tuteeId: true },
      orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }],
      take: LIMIT + 1,
    }),
  );
  for (const link of manualLinks) {
    const source = profiles.find((profile) => profile.id === link.tuteeId)!;
    const pairingId = await executionPairingId(db, link.pairingId);
    const tuteeId = executionIds.get(source.id)!;
    // Predecessors remain immutable history after an ordinary current unassign.
    // Only a live exact final tuple requires a complete transfer proof path.
    if (
      !(await db.pairingTutee.count({
        where: {
          pairingId,
          tuteeId,
          pairing: { termId: termId ?? "", term: { active: true } },
        },
      }))
    )
      continue;
    const path: QuarterWithdrawalEvidence["manualAssignments"][number]["path"] =
      [];
    let currentPairingId = link.pairingId;
    let currentTuteeId = source.id;
    let validPath = true;
    const visited = new Set<string>();
    for (;;) {
      if (visited.has(currentPairingId) || path.length >= 100) {
        validPath = false;
        break;
      }
      visited.add(currentPairingId);
      const edge = await db.pairingExecutionSuccessor.findUnique({
        where: { sourcePairingId: currentPairingId },
      });
      if (!edge) break;
      const transfer = await db.participantConsolidation.findUnique({
        where: { kind_sourceId: { kind: "TUTEE", sourceId: currentTuteeId } },
      });
      // A tutor-only successor keeps this exact learner tuple. Change the learner
      // only at the edge whose reviewed receipt grants that explicit alias.
      const changesLearner =
        transfer?.active && transfer.receiptId === edge.receiptId;
      const targetTuteeId = changesLearner ? transfer.targetId : currentTuteeId;
      if (
        !(await db.pairingTutee.count({
          where: { pairingId: edge.targetPairingId, tuteeId: targetTuteeId },
        }))
      ) {
        validPath = false;
        break;
      }
      path.push({
        sourcePairingId: currentPairingId,
        targetPairingId: edge.targetPairingId,
        sourceTuteeId: currentTuteeId,
        targetTuteeId,
        receiptId: edge.receiptId,
        pairingRevision: edge.revision,
        participantRevision: changesLearner ? transfer.revision : null,
      });
      currentPairingId = edge.targetPairingId;
      currentTuteeId = targetTuteeId;
    }
    if (
      !validPath ||
      currentPairingId !== pairingId ||
      currentTuteeId !== tuteeId
    ) {
      authorityBlockers.push(
        "The transferred manual enrollment needs an exact source review before withdrawal.",
      );
      continue;
    }
    if (path.length) {
      // A distinct original manual authority must never disappear behind one
      // canonical physical member simply because a display alias matches it.
      const originalPeers = await db.pairingTutee.findMany({
        where: { pairingId: link.pairingId, tuteeId: { not: source.id } },
        select: { tuteeId: true },
      });
      for (const peer of originalPeers)
        if (
          (await executionParticipantId(db, "TUTEE", peer.tuteeId)) ===
            tuteeId &&
          !ownedIds.includes(peer.tuteeId)
        )
          authorityBlockers.push(
            "Another original manual enrollment shares this execution member. Review its exact authority before withdrawal.",
          );
    } else if (source.status === "INACTIVE") continue;
    if (
      !(await db.pairingTutee.count({
        where: {
          pairingId,
          tuteeId,
          pairing: { termId: termId ?? "", term: { active: true } },
        },
      }))
    )
      continue;
    manualAssignments.push({
      sourceTuteeId: source.id,
      sourcePairingId: link.pairingId,
      pairingId,
      tuteeId,
      receiptId: path[0]?.receiptId ?? null,
      revision: path[0]?.pairingRevision ?? 0,
      path,
    });
  }
  bounded(manualAssignments);
  const exact = [];
  for (const source of scopeSources) {
    if (source.state === "OPEN")
      exact.push(...(await studentRequestExecutionAssignments(db, source)));
  }
  bounded(exact);
  const overlappingOriginalMembers = bounded(
    await db.pairingTutee.findMany({
      where: {
        pairingId: {
          in: await pairingEvidenceIds(
            db,
            exact.map((row) => row.pairingId),
          ),
        },
        tuteeId: { notIn: ownedIds },
      },
      select: { pairingId: true, tuteeId: true },
      orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }],
      take: LIMIT + 1,
    }),
  );
  for (const original of overlappingOriginalMembers) {
    if (await db.studentSurvey.count({ where: { tuteeId: original.tuteeId } }))
      continue;
    const currentPairingId = await executionPairingId(db, original.pairingId);
    const currentTuteeId = await executionParticipantId(
      db,
      "TUTEE",
      original.tuteeId,
    );
    if (
      !exact.some(
        (row) =>
          row.pairingId === currentPairingId && row.tuteeId === currentTuteeId,
      )
    )
      continue;
    const [retainedOwner, directOwner] = await Promise.all([
      db.studentProfileOwnership.findUnique({
        where: { tuteeId: original.tuteeId },
        select: { userId: true },
      }),
      db.user.findUnique({
        where: { studentId: original.tuteeId },
        select: { id: true },
      }),
    ]);
    if (
      [retainedOwner?.userId, directOwner?.id].some(
        (id) => id && id !== review.requestedByUserId,
      )
    )
      authorityBlockers.push(
        "Another explicitly owned manual enrollment shares this exact execution member. Review its source authority before withdrawal.",
      );
  }
  const [assignments, reviews, blocks] = await Promise.all([
    db.studentRequestExecutionAssignment.findMany({
      where: {
        OR: [
          { surveyId: { in: scopeSources.map((row) => row.id) } },
          ...exact.map(({ pairingId, tuteeId }) => ({ pairingId, tuteeId })),
          ...members.map(({ pairingId, tuteeId }) => ({ pairingId, tuteeId })),
        ],
      },
      select: {
        surveyId: true,
        pairingId: true,
        tuteeId: true,
        sourceTuteeId: true,
        revision: true,
        releasedAt: true,
      },
      orderBy: [{ surveyId: "asc" }, { pairingId: "asc" }],
      take: LIMIT + 1,
    }),
    db.studentRequestReview.findMany({
      where: {
        AND: [
          {
            OR: [
              { surveyId: { in: scopeSources.map((row) => row.id) } },
              {
                legacyTuteeId: { in: profileIds },
                legacyIntakeTermId: termId ?? "",
              },
            ],
          },
          { OR: [{ state: "PENDING" }, { id: review.id }] },
        ],
      },
      select: reviewSelect,
      orderBy: { id: "asc" },
      take: LIMIT + 1,
    }),
    db.studentQuarterBlock.findMany({
      where: {
        intakeTermId: termId ?? "",
        OR: [
          { userId: review.requestedByUserId },
          { surveyId: { in: scopeSources.map((row) => row.id) } },
          { legacyTuteeId: { in: profileIds } },
        ],
      },
      select: {
        id: true,
        email: true,
        intakeTermId: true,
        surveyId: true,
        legacyTuteeId: true,
        userId: true,
      },
      orderBy: { id: "asc" },
      take: LIMIT + 1,
    }),
  ]);
  bounded(assignments);
  bounded(reviews);
  bounded(blocks);
  const externalSources = bounded(
    await db.studentSurvey.findMany({
      where: {
        id: {
          in: assignments.map((row) => row.surveyId),
          notIn: scopeSources.map((row) => row.id),
        },
      },
      select: sourceSelect,
      orderBy: { id: "asc" },
      take: LIMIT + 1,
    }),
  );
  const evidenceSources = [...scopeSources, ...externalSources].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const pairingIds = [
    ...new Set([
      ...assignments.map((row) => row.pairingId),
      ...exact.map((row) => row.pairingId),
      ...members.map((row) => row.pairingId),
      ...manualAssignments.map((row) => row.pairingId),
    ]),
  ].sort();
  const pairings = bounded(
    await db.pairing.findMany({
      where: { id: { in: pairingIds } },
      select: {
        id: true,
        termId: true,
        tutorId: true,
        subject: true,
        scheduleConfirmed: true,
        dayOfWeek: true,
        startMin: true,
        endMin: true,
        roomVersion: true,
      },
      orderBy: { id: "asc" },
      take: LIMIT + 1,
    }),
  );
  const plans = bounded(
    await db.sessionPlan.findMany({
      where: {
        termId: termId ?? "",
        OR: [
          {
            assignments: {
              some: {
                pairingId: { in: await pairingEvidenceIds(db, pairingIds) },
              },
            },
          },
          { participants: { some: { tuteeId: { in: profileIds } } } },
        ],
      },
      select: {
        id: true,
        termId: true,
        sourceFingerprint: true,
        sourceScheduleFingerprint: true,
      },
      orderBy: { id: "asc" },
      take: LIMIT + 1,
    }),
  );
  const planIds = plans.map((row) => row.id);
  const affectedIds = [
    ...new Set([
      ...profileIds,
      ...executionIds.values(),
      ...exact.map((row) => row.tuteeId),
    ]),
  ].sort();
  const executedParticipants = bounded(
    await db.$queryRaw<
      { participantId: string }[]
    >`SELECT e."participantId" FROM "SessionParticipantExecution" e JOIN "SessionPlanParticipant" p ON p.id=e."participantId" WHERE p."planId"=ANY(${planIds}::text[]) AND e."tuteeId"=ANY(${affectedIds}::text[]) ORDER BY e."participantId" LIMIT 1001`,
  );
  const [participants, continuationMembers] = await Promise.all([
    db.sessionPlanParticipant.findMany({
      where: {
        planId: { in: planIds },
        OR: [
          { tuteeId: { in: affectedIds } },
          { id: { in: executedParticipants.map((row) => row.participantId) } },
        ],
      },
      select: {
        id: true,
        planId: true,
        tuteeId: true,
        cohortId: true,
        status: true,
        version: true,
      },
      orderBy: { id: "asc" },
      take: LIMIT + 1,
    }),
    db.sessionPlanContinuationMember.findMany({
      where: { planId: { in: planIds }, tuteeId: { in: affectedIds } },
      select: {
        planId: true,
        pairingId: true,
        tuteeId: true,
        assignmentId: true,
        sourceSurveyId: true,
        sourceTuteeId: true,
        joinedAt: true,
        releasedAt: true,
      },
      orderBy: [{ planId: "asc" }, { pairingId: "asc" }, { tuteeId: "asc" }],
      take: LIMIT + 1,
    }),
  ]);
  bounded(participants);
  bounded(continuationMembers);
  const [cohorts, candidateRequests] = await Promise.all([
    db.sessionPlanCohort.findMany({
      where: {
        id: {
          in: participants.flatMap((row) =>
            row.cohortId ? [row.cohortId] : [],
          ),
        },
        startsAt: { gt: new Date() },
        status: { not: "RECORDED" },
      },
      select: {
        id: true,
        planId: true,
        status: true,
        version: true,
        startsAt: true,
        endsAt: true,
        _count: {
          select: { participants: { where: { status: "SCHEDULED" } } },
        },
      },
      orderBy: { id: "asc" },
      take: LIMIT + 1,
    }),
    db.sessionPlanningRequest.findMany({
      where: {
        planId: { in: planIds },
        status: { in: ["PENDING", "SPLIT_REQUESTED"] },
      },
      select: {
        id: true,
        planId: true,
        status: true,
        version: true,
        currentOfferId: true,
        participantIds: true,
      },
      orderBy: { id: "asc" },
      take: LIMIT + 1,
    }),
  ]);
  bounded(cohorts);
  bounded(candidateRequests);
  const requests = candidateRequests.filter(
    (row) =>
      Array.isArray(row.participantIds) &&
      row.participantIds.some(
        (id) => typeof id === "string" && affectedIds.includes(id),
      ),
  );
  const [executions, responses] = await Promise.all([
    db.sessionParticipantExecution.findMany({
      where: { participantId: { in: participants.map((row) => row.id) } },
      select: {
        participantId: true,
        tuteeId: true,
        sourceSurveyIds: true,
        revision: true,
      },
      orderBy: { participantId: "asc" },
      take: LIMIT + 1,
    }),
    db.sessionPlanningResponse.findMany({
      where: { offer: { requestId: { in: requests.map((row) => row.id) } } },
      select: {
        id: true,
        offerId: true,
        actorUserId: true,
        actorKey: true,
        state: true,
        deadline: true,
        respondedAt: true,
      },
      orderBy: { id: "asc" },
      take: LIMIT + 1,
    }),
  ]);
  bounded(executions);
  bounded(responses);
  const [planExecutions, responseExecutions] = await Promise.all([
    db.sessionPlanExecution.findMany({
      where: { planId: { in: planIds } },
      select: {
        planId: true,
        tutorId: true,
        revision: true,
        assignments: true,
      },
      orderBy: { planId: "asc" },
      take: LIMIT + 1,
    }),
    db.sessionResponseExecution.findMany({
      where: { responseId: { in: responses.map((row) => row.id) } },
      select: {
        responseId: true,
        userId: true,
        profileKind: true,
        profileId: true,
        revision: true,
      },
      orderBy: { responseId: "asc" },
      take: LIMIT + 1,
    }),
  ]);
  bounded(planExecutions);
  bounded(responseExecutions);
  const safeReview = (row: typeof review) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: iso(row.resolvedAt),
  });
  const evidence = quarterWithdrawalEvidenceSchema.parse({
    version: 1,
    review: safeReview(review),
    authorityBlockers: [...new Set(authorityBlockers)].sort(),
    owner: owner
      ? {
          id: owner.id,
          studentId: owner.studentId,
          emailHash: emailHash(owner.email),
          sessionVersion: owner.sessionVersion,
          historyAccessRevision: owner.historyAccessRevision,
          mergedIntoId: owner.mergedIntoId,
          suspendedAt: iso(owner.suspendedAt),
          recoveryVoidedAt: iso(owner.recoveryVoidedAt),
        }
      : null,
    term: term ? { ...term, createdAt: term.createdAt.toISOString() } : null,
    profiles: profiles.map((row) => ({
      ...row,
      directOwnerIds: directOwners
        .filter((user) => user.studentId === row.id)
        .map((user) => user.id),
      retainedOwner: ownerships.find((owner) => owner.tuteeId === row.id)
        ? {
            userId: ownerships.find((owner) => owner.tuteeId === row.id)!
              .userId,
            revision: ownerships.find((owner) => owner.tuteeId === row.id)!
              .revision,
          }
        : null,
      executionTuteeId: executionIds.get(row.id)!,
    })),
    sources: evidenceSources.map(
      ({
        id,
        tuteeId,
        intakeTermId,
        state,
        currentVersion,
        invalidityVersion,
        confirmedAt,
        verificationDueAt,
        resolvedAt,
      }) => ({
        id,
        tuteeId,
        intakeTermId,
        state,
        currentVersion,
        invalidityVersion,
        confirmedAt: iso(confirmedAt),
        verificationDueAt: iso(verificationDueAt),
        resolvedAt: iso(resolvedAt),
      }),
    ),
    assignments: assignments.map((row) => ({
      ...row,
      releasedAt: iso(row.releasedAt),
    })),
    effectiveAssignments: exact,
    manualAssignments,
    pairings,
    members,
    consolidations,
    pendingReviews: reviews.map(safeReview),
    blocks: blocks.map(({ email, ...row }) => ({
      ...row,
      emailHash: emailHash(email),
    })),
    publication: {
      plans,
      participants,
      cohorts: cohorts.map(({ _count, ...row }) => ({
        ...row,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        scheduledParticipantCount: _count.participants,
      })),
      continuationMembers: continuationMembers.map((row) => ({
        ...row,
        joinedAt: row.joinedAt.toISOString(),
        releasedAt: iso(row.releasedAt),
      })),
      executions: executions.map((row) => ({
        ...row,
        sourceSurveyIds: [...row.sourceSurveyIds].sort(),
      })),
      planExecutions: planExecutions.map((row) => ({
        ...row,
        assignments: executionAssignments
          .parse(row.assignments)
          .sort((a, b) => a.sourcePairingId.localeCompare(b.sourcePairingId)),
      })),
      responseExecutions,
      requests: requests.map((row) => ({
        id: row.id,
        planId: row.planId,
        status: row.status,
        version: row.version,
        currentOfferId: row.currentOfferId,
      })),
      responses: responses.map((row) => ({
        ...row,
        deadline: iso(row.deadline),
        respondedAt: iso(row.respondedAt),
      })),
    },
  });
  return {
    review,
    trigger,
    owner,
    term,
    ownedIds,
    profiles,
    sources,
    exact,
    evidence,
  };
}

/** Read-only and valid after approval; recovery inspection must never expire,
 * repair or reopen participation while collecting this bounded evidence. */
export async function readQuarterWithdrawalEvidence(
  db: DomainDb,
  input: { reviewId: string },
) {
  return (await loadScope(db, input.reviewId)).evidence;
}

export async function readQuarterWithdrawalScope(
  db: DomainDb,
  input: { reviewId: string },
) {
  const scope = await loadScope(db, input.reviewId);
  const { review, trigger, owner, term, evidence } = scope;
  if (evidence.authorityBlockers.length)
    invalid(evidence.authorityBlockers[0]!);
  if (review.kind !== "STUDENT_ABORT" || review.state !== "PENDING")
    invalid("This withdrawal application has already been processed.");
  if (!term?.active)
    invalid("This quarter ended. Decline this outdated withdrawal request.");
  if (
    !owner ||
    owner.suspendedAt ||
    owner.mergedIntoId ||
    owner.recoveryVoidedAt ||
    !owner.email
  )
    invalid(
      "The requesting account changed. Decline this outdated withdrawal request.",
    );
  const selectedIds = scope.ownedIds;
  for (const profile of evidence.profiles) {
    const owners = [
      ...new Set([
        ...profile.directOwnerIds,
        ...(profile.retainedOwner ? [profile.retainedOwner.userId] : []),
      ]),
    ];
    if (
      selectedIds.includes(profile.id) &&
      (owners.length !== 1 || owners[0] !== owner.id)
    )
      invalid(
        "Current and retained enrollment ownership conflict. Review ownership before withdrawal.",
      );
  }
  const selectedSurveyIds = scope.sources
    .filter(
      (row) =>
        row.intakeTermId === term.id &&
        row.state === "OPEN" &&
        !!row.tuteeId &&
        selectedIds.includes(row.tuteeId),
    )
    .map((row) => row.id);
  // Only the writer needs full source rows for the existing closure/notice helper.
  const surveys = await db.studentSurvey.findMany({
    where: { id: { in: selectedSurveyIds } },
    orderBy: { id: "asc" },
    take: LIMIT + 1,
  });
  const manual = scope.profiles.filter(
    (profile) =>
      selectedIds.includes(profile.id) &&
      (profile.status !== "INACTIVE" ||
        evidence.manualAssignments.some(
          (assignment) =>
            assignment.sourceTuteeId === profile.id &&
            assignment.path.some((edge) => edge.participantRevision !== null),
        )) &&
      !scope.sources.some((source) => source.tuteeId === profile.id) &&
      (profile.intakeTermId === term.id ||
        (profile.intakeTermId === null && owner.studentId === profile.id) ||
        evidence.manualAssignments.some(
          (assignment) => assignment.sourceTuteeId === profile.id,
        )),
  );
  const triggerId = trigger?.tuteeId ?? review.legacyTuteeId;
  if (
    !triggerId ||
    !selectedIds.includes(triggerId) ||
    (review.surveyId
      ? !surveys.some((source) => source.id === review.surveyId)
      : !manual.some((profile) => profile.id === review.legacyTuteeId))
  )
    invalid(
      "The initiating enrollment is no longer owned by the requester. Decline this outdated withdrawal request.",
    );
  return { ...scope, surveys, manual };
}
export type QuarterWithdrawalScope = Awaited<
  ReturnType<typeof readQuarterWithdrawalScope>
>;
declare const lockedQuarterScope: unique symbol;
export type LockedQuarterWithdrawalScope = QuarterWithdrawalScope & {
  readonly [lockedQuarterScope]: true;
};

/** Match transfer/planning order before discovering exact source tuples. The
 * namespace's persistent fence rejects an old Serializable ownership snapshot.
 * A final reread also rejects changed scope under READ COMMITTED callers. */
export async function lockQuarterWithdrawalScope(
  tx: TransactionDb,
  input: { reviewId: string },
): Promise<LockedQuarterWithdrawalScope> {
  await lockEntity(tx, "program:period");
  await lockUsernameNamespace(tx);
  await lockCatalogue(tx);
  await lockSessionPlanning(tx);
  const initial = await readQuarterWithdrawalScope(tx, input);
  for (const id of [
    ...new Set([
      initial.owner!.id,
      ...initial.evidence.profiles.flatMap((row) => row.directOwnerIds),
      ...initial.evidence.profiles.flatMap((row) =>
        row.retainedOwner ? [row.retainedOwner.userId] : [],
      ),
    ]),
  ].sort())
    await lockAccountProfile(tx, id);
  const reviewSources = await tx.studentSurvey.findMany({
    where: { id: { in: initial.evidence.sources.map((row) => row.id) } },
    select: { id: true, email: true },
  });
  for (const source of reviewSources.sort((a, b) =>
    `${a.email}:${a.id}`.localeCompare(`${b.email}:${b.id}`),
  ))
    await lockStudentRequestReview(tx, source);
  for (const profile of initial.manual)
    await lockEntity(tx, `legacy-student:${profile.id}`);
  const profileIds = [
    ...new Set([
      ...initial.evidence.profiles.map((row) => row.id),
      ...initial.evidence.profiles.map((row) => row.executionTuteeId),
      ...initial.evidence.assignments.map((row) => row.tuteeId),
    ]),
  ].sort();
  await lockStudentRequestExecution(tx, profileIds);
  await tx.$queryRaw`SELECT id FROM "Tutee" WHERE id=ANY(${profileIds}::text[]) ORDER BY id FOR UPDATE`;
  const pairingIds = [
    ...new Set([
      ...initial.evidence.pairings.map((row) => row.id),
      ...initial.evidence.manualAssignments.map((row) => row.sourcePairingId),
    ]),
  ].sort();
  await tx.$queryRaw`SELECT id FROM "Pairing" WHERE id=ANY(${pairingIds}::text[]) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT "pairingId","tuteeId" FROM "PairingTutee" WHERE "pairingId"=ANY(${pairingIds}::text[]) ORDER BY "pairingId","tuteeId" FOR UPDATE`;
  const sourceIds = initial.evidence.sources.map((row) => row.id).sort();
  await tx.$queryRaw`SELECT "surveyId","pairingId" FROM "StudentRequestExecutionAssignment" WHERE "surveyId"=ANY(${sourceIds}::text[]) ORDER BY "surveyId","pairingId" FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "StudentRequestReview" WHERE id=${input.reviewId} FOR UPDATE`;
  const current = await readQuarterWithdrawalScope(tx, input);
  if (JSON.stringify(initial.evidence) !== JSON.stringify(current.evidence))
    invalid(
      "Tutoring participation changed while this withdrawal waited. Reload the current review.",
    );
  return current as LockedQuarterWithdrawalScope;
}

/** One reviewed decision owns all closures; single-request recall, unassignment
 * and schedule review keep using their existing exact-source primitives. */
export async function applyQuarterWithdrawal(
  tx: TransactionDb,
  scope: LockedQuarterWithdrawalScope,
  input: { actorId: string; now: Date },
) {
  const current = await readQuarterWithdrawalScope(tx, {
    reviewId: scope.review.id,
  });
  if (JSON.stringify(current.evidence) !== JSON.stringify(scope.evidence))
    invalid(
      "Tutoring participation changed. Reload the current withdrawal review.",
    );
  const { actorId, now } = input;
  const owner = scope.owner!;
  const term = scope.term!;
  // A pre-existing email block may belong to another account/source. Keep its
  // provenance; a separate current-account row is required after alias changes.
  const emailCandidates = [
    ...new Set([
      ...(scope.review.surveyId
        ? scope.surveys
            .filter((row) => row.id === scope.review.surveyId)
            .map((row) => row.email)
        : [owner.email]),
      ...scope.surveys.map((row) => row.email),
      owner.email,
    ]),
  ];
  const existing = await tx.studentQuarterBlock.findMany({
    where: { intakeTermId: term.id, email: { in: emailCandidates } },
  });
  if (
    !(await tx.studentQuarterBlock.count({
      where: {
        intakeTermId: term.id,
        AND: [await quarterBlockAccountWhere(tx, owner.id)],
      },
    }))
  ) {
    const email = emailCandidates.find(
      (email) => !existing.some((row) => row.email === email),
    );
    if (!email)
      invalid(
        "The withdrawal restriction has conflicting account provenance. Review the account restriction before approval.",
      );
    await tx.studentQuarterBlock.create({
      data: {
        email,
        intakeTermId: term.id,
        userId: owner.id,
        surveyId: scope.review.surveyId,
        legacyTuteeId: scope.review.legacyTuteeId,
      },
    });
  }
  await tx.studentRequestReview.update({
    where: { id: scope.review.id },
    data: { state: "APPROVED", resolvedAt: now, resolvedByUserId: actorId },
  });
  for (const source of scope.surveys)
    await closeStudentRequest(tx, source, "ABORTED", now);
  for (const profile of scope.manual) {
    await preserveHistoricalAcademics(tx, "TUTEE", profile.id);
    const members = scope.evidence.manualAssignments.filter(
      (member) => member.sourceTuteeId === profile.id,
    );
    for (const member of members) {
      // Manual source ownership never overrides an independent exact source.
      const mappings = await tx.studentRequestExecutionAssignment.findMany({
        where: {
          pairingId: member.pairingId,
          tuteeId: member.tuteeId,
          releasedAt: null,
        },
      });
      const sources = await tx.studentSurvey.findMany({
        where: {
          id: { in: mappings.map((row) => row.surveyId) },
          state: "OPEN",
          intakeTermId: term.id,
        },
        select: { id: true, tuteeId: true },
      });
      if (
        mappings.some(
          (mapping) =>
            !sources.some(
              (source) =>
                source.id === mapping.surveyId &&
                source.tuteeId === mapping.sourceTuteeId,
            ),
        )
      )
        invalid("Manual execution authority needs review before withdrawal.");
      if (sources.length) continue;
      await tx.pairingTutee.deleteMany({
        where: { pairingId: member.pairingId, tuteeId: member.tuteeId },
      });
      await releaseSessionLegacyParticipation(
        tx,
        {
          pairingId: member.pairingId,
          tuteeId: member.tuteeId,
          sourceTuteeId: profile.id,
          termId: term.id,
        },
        now,
      );
    }
    for (const id of [
      ...new Set([profile.id, ...members.map((member) => member.tuteeId)]),
    ]) {
      if (
        !(await tx.pairingTutee.count({
          where: {
            tuteeId: id,
            pairingId: { notIn: await supersededPairingIds(tx) },
            pairing: { term: { active: true } },
          },
        }))
      )
        await tx.tutee.update({ where: { id }, data: { status: "INACTIVE" } });
    }
  }
  await tx.studentRequestReview.updateMany({
    where: {
      state: "PENDING",
      OR: [
        { surveyId: { in: scope.surveys.map((row) => row.id) } },
        {
          legacyTuteeId: { in: scope.manual.map((row) => row.id) },
          legacyIntakeTermId: term.id,
        },
      ],
    },
    data: { state: "DENIED", resolvedAt: now, resolvedByUserId: actorId },
  });
  return {
    surveyIds: scope.surveys.map((row) => row.id),
    legacyTuteeIds: scope.manual.map((row) => row.id),
    termId: term.id,
    ownerId: owner.id,
  };
}
