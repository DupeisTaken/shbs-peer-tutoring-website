import type { Prisma } from "../../../generated/prisma";
import type { TransactionDb } from "~/server/transactions";

export type OverlappingCohort = {
  id: string;
  planId: string;
  startsAt: Date;
  endsAt: Date;
  roomId: string | null;
  online: boolean;
  plan: { tutorId: string };
  participants: { tuteeId: string }[];
};

/** Fresh statement snapshot, including empty cohorts. Select timestamps directly
 * so the driver retains Date values rather than JSON-encoding their wall clocks.
 */
export async function readOverlappingCohorts(
  tx: TransactionDb,
  startsAt: Date,
  endsAt: Date,
): Promise<OverlappingCohort[]> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      planId: string;
      startsAt: Date;
      endsAt: Date;
      roomId: string | null;
      online: boolean;
      tutorId: string;
      participantIds: string[];
    }[]
  >`
    SELECT c.id, c."planId", c."startsAt", c."endsAt", c."roomId", c.online,
      COALESCE(executor."tutorId", p."tutorId") AS "tutorId",
      ARRAY(
        SELECT COALESCE(member_executor."tuteeId", participant."tuteeId") FROM "SessionPlanParticipant" participant
        LEFT JOIN "SessionParticipantExecution" member_executor ON member_executor."participantId"=participant.id
        WHERE participant."cohortId"=c.id AND participant.status='SCHEDULED'
      ) AS "participantIds"
    FROM "SessionPlanCohort" c
    JOIN "SessionPlan" p ON p.id=c."planId"
    LEFT JOIN "SessionPlanExecution" executor ON executor."planId"=p.id
    WHERE c.status='SCHEDULED'
      AND c."startsAt"<${endsAt} AND c."endsAt">${startsAt}
  `;
  return rows.map(({ tutorId, participantIds, ...cohort }) => ({
    ...cohort,
    plan: { tutorId },
    participants: participantIds.map((tuteeId) => ({ tuteeId })),
  }));
}

export type OverlappingHold = {
  id: string;
  currentOfferId: string;
  kind: string;
  parentRequestId: string | null;
  participantIds: Prisma.JsonValue;
  plan: { tutorId: string };
  offers: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    roomId: string | null;
    online: boolean;
  }[];
};

/** Only the exact current offer of its own pending request holds an interval.
 * Keep every overlapping identity/room candidate for the caller's domain checks.
 */
export async function readOverlappingHolds(
  tx: TransactionDb,
  startsAt: Date,
  endsAt: Date,
  excludeRequestId?: string,
): Promise<OverlappingHold[]> {
  // Empty identifiers historically mean no exclusion, like an omitted value.
  const excluded = excludeRequestId?.length ? excludeRequestId : null;
  const rows = await tx.$queryRaw<
    {
      id: string;
      currentOfferId: string;
      kind: string;
      parentRequestId: string | null;
      participantIds: Prisma.JsonValue;
      tutorId: string;
      offerId: string;
      startsAt: Date;
      endsAt: Date;
      roomId: string | null;
      online: boolean;
    }[]
  >`
    SELECT r.id, r."currentOfferId", r.kind, r."parentRequestId", (SELECT COALESCE(jsonb_agg(COALESCE(e."tuteeId", original.value #>> '{}')), '[]'::jsonb)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r."participantIds")='array' THEN r."participantIds" ELSE '[]'::jsonb END) original(value)
        LEFT JOIN "SessionPlanParticipant" member ON member."planId"=r."planId" AND member."tuteeId"=(original.value #>> '{}')
        LEFT JOIN "SessionParticipantExecution" e ON e."participantId"=member.id) AS "participantIds",
      COALESCE(executor."tutorId", p."tutorId") AS "tutorId", o.id AS "offerId", o."startsAt", o."endsAt", o."roomId", o.online
    FROM "SessionPlanningRequest" r
    JOIN "SessionPlan" p ON p.id=r."planId"
    LEFT JOIN "SessionPlanExecution" executor ON executor."planId"=p.id
    JOIN "SessionPlanningOffer" o ON o.id=r."currentOfferId" AND o."requestId"=r.id
    WHERE r.status='PENDING'
      AND o."startsAt"<${endsAt} AND o."endsAt">${startsAt}
      AND (${excluded}::text IS NULL OR r.id<>${excluded})
  `;
  return rows.map((row) => ({
    id: row.id,
    currentOfferId: row.currentOfferId,
    kind: row.kind,
    parentRequestId: row.parentRequestId,
    participantIds: row.participantIds,
    plan: { tutorId: row.tutorId },
    offers: [
      {
        id: row.offerId,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        roomId: row.roomId,
        online: row.online,
      },
    ],
  }));
}
