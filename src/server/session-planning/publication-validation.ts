import type { Prisma } from "../../../generated/prisma";
import { programCalendarDate } from "~/lib/program-calendar";
import { resolvePlanningCalendarDay } from "~/lib/session-planning";
import type { SchoolCalendarOverride } from "~/lib/school-calendar";
import type { TransactionDb } from "~/server/transactions";
import type { OverlappingCohort, OverlappingHold } from "./conflict-reads";

export type PublicationValidationInput = {
  tutorId: string;
  termId: string;
  originalDate: string;
  date: string;
  participantIds: readonly string[];
  startsAt: Date;
  endsAt: Date;
  startMin: number;
  endMin: number;
  roomId: string | null;
  /** Enumeration hint only: 0 means closed, 1..7 means a timetable weekday. */
  weekdayHint?: number;
};

type Recurring = {
  id: string;
  tutorId: string;
  roomId: string | null;
  startMin: number;
  dayOfWeek: number;
  tutees: { tuteeId: string }[];
};

type SnapshotRow = {
  startsAt: Date | null;
  endsAt: Date | null;
} & (
  | { kind: "cohort"; payload: Omit<OverlappingCohort, "startsAt" | "endsAt"> }
  | {
      kind: "hold";
      payload: Omit<OverlappingHold, "offers"> & {
        offer: { id: string; roomId: string | null; online: boolean };
      };
    }
  | { kind: "recurring"; payload: Recurring }
  | { kind: "calendar"; payload: SchoolCalendarOverride }
  | {
      kind: "key";
      payload: { role: "tutor" | "tutee"; profileId: string; userId: string };
    }
  | { kind: "materialized"; payload: { pairingId: string } }
  | { kind: "room"; payload: { exists: boolean; blocked: boolean } }
);

const stringIds = (value: Prisma.JsonValue): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

/** Fresh initial-publication evidence, after inserting this plan/its assignments
 * and before inserting its new cohort. The caller holds the period/room/planning
 * fences and still decides and writes each candidate serially. Each statement
 * sees coherent live facts and the transaction's earlier writes; nothing is
 * reused for a later candidate. A new cohort has no source roster or request.
 */
export async function readPublicationValidationSnapshot(
  tx: TransactionDb,
  input: PublicationValidationInput,
) {
  programCalendarDate.parse(input.date);
  const weekday = new Date(`${input.date}T00:00:00Z`).getUTCDay() || 7;
  const readRows = (weekdayHint: number | undefined) => tx.$queryRaw<
    SnapshotRow[]
  >`
    WITH /* shbs:publication-validation */ parameters AS (
      SELECT ${input.tutorId}::text AS "tutorId", ${input.termId}::text AS "termId",
        ${input.date}::text AS date, ${[...input.participantIds]}::text[] AS "participantIds",
        ${input.startsAt}::timestamp AS "startsAt", ${input.endsAt}::timestamp AS "endsAt",
        ${input.startMin}::integer AS "startMin", ${input.endMin}::integer AS "endMin",
        ${input.roomId}::text AS "roomId", ${weekday}::integer AS weekday,
        ${weekdayHint ?? null}::integer AS "weekdayHint"
    ), overlapping_cohorts AS (
      SELECT c.id, c."planId", c."startsAt", c."endsAt", c."roomId", c.online,
        p."tutorId", ARRAY(
          SELECT participant."tuteeId" FROM "SessionPlanParticipant" participant
          WHERE participant."cohortId"=c.id AND participant.status='SCHEDULED'
        ) AS "participantIds"
      FROM "SessionPlanCohort" c
      JOIN "SessionPlan" p ON p.id=c."planId"
      CROSS JOIN parameters a
      WHERE c.status='SCHEDULED' AND c."startsAt"<a."endsAt" AND c."endsAt">a."startsAt"
    ), overlapping_holds AS (
      SELECT r.id, r."currentOfferId", r.kind, r."parentRequestId", r."participantIds",
        p."tutorId", o.id AS "offerId", o."startsAt", o."endsAt", o."roomId", o.online
      FROM "SessionPlanningRequest" r
      JOIN "SessionPlan" p ON p.id=r."planId"
      JOIN "SessionPlanningOffer" o ON o.id=r."currentOfferId" AND o."requestId"=r.id
      CROSS JOIN parameters a
      WHERE r.status='PENDING' AND o."startsAt"<a."endsAt" AND o."endsAt">a."startsAt"
    ), potential_recurring AS (
      SELECT p.id, p."tutorId", p."roomId", p."startMin", p."dayOfWeek", ARRAY(
        SELECT roster."tuteeId" FROM "PairingTutee" roster WHERE roster."pairingId"=p.id
      ) AS "participantIds"
      FROM "Pairing" p CROSS JOIN parameters a
      WHERE p."termId"=a."termId" AND p."scheduleConfirmed"=true AND p."startMin"<a."endMin"
        AND (a."weekdayHint" IS NULL OR (a."weekdayHint" BETWEEN 1 AND 7 AND p."dayOfWeek"=a."weekdayHint"))
    ), tutor_ids AS (
      SELECT "tutorId" AS id FROM parameters
      UNION SELECT "tutorId" FROM overlapping_cohorts
      UNION SELECT "tutorId" FROM overlapping_holds
      UNION SELECT "tutorId" FROM potential_recurring
    ), tutee_ids AS (
      SELECT unnest("participantIds") AS id FROM parameters
      UNION SELECT unnest("participantIds") FROM overlapping_cohorts
      UNION SELECT value #>> '{}' FROM overlapping_holds h
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(h."participantIds")='array' THEN h."participantIds" ELSE '[]'::jsonb END
        ) AS item(value) WHERE jsonb_typeof(value)='string'
      UNION SELECT unnest("participantIds") FROM potential_recurring
    ), direct_users AS (
      SELECT id, "tutorId", "studentId" FROM "User"
      WHERE "tutorId" IN (SELECT id FROM tutor_ids) OR "studentId" IN (SELECT id FROM tutee_ids)
    ), mappings AS (
      SELECT 'tutor'::text AS role, "tutorId" AS "profileId", "userId", 0 AS priority
      FROM "TutorProfileOwnership" WHERE "tutorId" IN (SELECT id FROM tutor_ids)
      UNION ALL SELECT 'tutee'::text, "tuteeId", "userId", 0
      FROM "StudentProfileOwnership" WHERE "tuteeId" IN (SELECT id FROM tutee_ids)
      UNION ALL SELECT 'tutor'::text, "tutorId", id, 1 FROM direct_users
      WHERE "tutorId" IS NOT NULL AND "tutorId"<>''
      UNION ALL SELECT 'tutee'::text, "studentId", id, 1 FROM direct_users
      WHERE "studentId" IS NOT NULL AND "studentId"<>''
    ), canonical_keys AS (
      SELECT DISTINCT ON (role, "profileId") role, "profileId", "userId"
      FROM mappings ORDER BY role, "profileId", priority DESC
    )
    SELECT 'cohort'::text AS kind, jsonb_build_object(
      'id', c.id, 'planId', c."planId", 'roomId', c."roomId", 'online', c.online,
      'plan', jsonb_build_object('tutorId', c."tutorId"),
      'participants', (SELECT COALESCE(jsonb_agg(jsonb_build_object('tuteeId', id)), '[]'::jsonb)
        FROM unnest(c."participantIds") AS person(id))
    ) AS payload, c."startsAt", c."endsAt" FROM overlapping_cohorts c
    UNION ALL SELECT 'hold', jsonb_build_object(
      'id', h.id, 'currentOfferId', h."currentOfferId", 'kind', h.kind,
      'parentRequestId', h."parentRequestId", 'participantIds', h."participantIds",
      'plan', jsonb_build_object('tutorId', h."tutorId"),
      'offer', jsonb_build_object('id', h."offerId", 'roomId', h."roomId", 'online', h.online)
    ), h."startsAt", h."endsAt" FROM overlapping_holds h
    UNION ALL SELECT 'recurring', jsonb_build_object(
      'id', p.id, 'tutorId', p."tutorId", 'roomId', p."roomId", 'startMin', p."startMin",
      'dayOfWeek', p."dayOfWeek", 'tutees',
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('tuteeId', id)), '[]'::jsonb)
        FROM unnest(p."participantIds") AS person(id))
    ), NULL::timestamp, NULL::timestamp FROM potential_recurring p
    UNION ALL SELECT 'calendar', jsonb_build_object(
      'date', c.date, 'isSchoolDay', c."isSchoolDay", 'timetableWeekday', c."timetableWeekday",
      'active', c.active, 'version', c.version, 'scheduleRevision', c."scheduleRevision"
    ), NULL::timestamp, NULL::timestamp FROM "SchoolCalendarDay" c CROSS JOIN parameters a
      WHERE c.date=a.date
    UNION ALL SELECT 'key', jsonb_build_object(
      'role', k.role, 'profileId', k."profileId", 'userId', k."userId"
    ), NULL::timestamp, NULL::timestamp FROM canonical_keys k
    UNION ALL SELECT 'materialized', jsonb_build_object('pairingId', assignment."pairingId"),
      NULL::timestamp, NULL::timestamp
      FROM "SessionPlanAssignment" assignment
      JOIN "SessionPlan" plan ON plan.id=assignment."planId"
      CROSS JOIN parameters a
      WHERE plan.kind='REGULAR' AND plan."originalDate"=a.date
        AND assignment."pairingId" IN (SELECT id FROM potential_recurring)
    UNION ALL SELECT 'room', jsonb_build_object(
      'exists', a."roomId" IS NULL OR EXISTS(SELECT 1 FROM "Room" r WHERE r.id=a."roomId"),
      'blocked', a."roomId" IS NOT NULL AND EXISTS(
        SELECT 1 FROM "RoomUnavailability" r WHERE r."roomId"=a."roomId"
          AND r."dayOfWeek"=a.weekday AND r."startMin"<a."endMin" AND r."endMin">a."startMin"
      )
    ), NULL::timestamp, NULL::timestamp FROM parameters a
  `;

  // Date is a primary key in SchoolCalendarDay. Resolve only the calendar read
  // in this same statement, retaining shared tombstone/revision/makeup rules.
  const resolveTimetable = (facts: SnapshotRow[]) =>
    resolvePlanningCalendarDay(
      input.date,
      facts.flatMap((row) => (row.kind === "calendar" ? [row.payload] : [])),
    );
  let rows = await readRows(input.weekdayHint);
  let timetable = resolveTimetable(rows);
  const actualWeekday = timetable.isSchoolDay
    ? timetable.effectiveTimetableWeekday
    : 0;
  if (input.weekdayHint !== undefined && actualWeekday !== input.weekdayHint) {
    // A stale enumeration hint must never hide live recurrence. Re-read once
    // without a filter; that statement's own calendar selects its returned rows.
    rows = await readRows(undefined);
    timetable = resolveTimetable(rows);
  }

  const cohorts: OverlappingCohort[] = [];
  const holds: OverlappingHold[] = [];
  const potentialRecurring: Recurring[] = [];
  const mappings: Extract<SnapshotRow, { kind: "key" }>["payload"][] = [];
  const materialized = new Set<string>();
  let roomExists = input.roomId === null;
  let roomBlocked = false;
  for (const row of rows) {
    switch (row.kind) {
      case "cohort":
        cohorts.push({
          ...row.payload,
          startsAt: row.startsAt!,
          endsAt: row.endsAt!,
        });
        break;
      case "hold": {
        const { offer, ...request } = row.payload;
        holds.push({
          ...request,
          offers: [{ ...offer, startsAt: row.startsAt!, endsAt: row.endsAt! }],
        });
        break;
      }
      case "recurring":
        potentialRecurring.push(row.payload);
        break;
      case "calendar":
        break;
      case "key":
        mappings.push(row.payload);
        break;
      case "materialized":
        materialized.add(row.payload.pairingId);
        break;
      case "room":
        roomExists = row.payload.exists;
        roomBlocked = row.payload.blocked;
        break;
    }
  }
  const keys = {
    tutor: new Map(
      [
        input.tutorId,
        ...cohorts.map((row) => row.plan.tutorId),
        ...holds.map((row) => row.plan.tutorId),
        ...potentialRecurring.map((row) => row.tutorId),
      ].map((id) => [id, `tutor:${id}`]),
    ),
    tutee: new Map(
      [
        ...input.participantIds,
        ...cohorts.flatMap((row) =>
          row.participants.map((person) => person.tuteeId),
        ),
        ...holds.flatMap((row) => stringIds(row.participantIds)),
        ...potentialRecurring.flatMap((row) =>
          row.tutees.map((person) => person.tuteeId),
        ),
      ].map((id) => [id, `tutee:${id}`]),
    ),
  };
  for (const row of mappings)
    (row.role === "tutor" ? keys.tutor : keys.tutee).set(
      row.profileId,
      `user:${row.userId}`,
    );
  const recurring = timetable.isSchoolDay
    ? potentialRecurring.filter(
        (row) => row.dayOfWeek === timetable.effectiveTimetableWeekday,
      )
    : [];
  return {
    cohorts,
    holds,
    recurring,
    keys,
    materialized,
    timetable,
    roomExists,
    roomBlocked,
  };
}

export type PublicationValidationSnapshot = Awaited<
  ReturnType<typeof readPublicationValidationSnapshot>
>;
