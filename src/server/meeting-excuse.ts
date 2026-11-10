import { TRPCError } from "@trpc/server";
import { portalAccess } from "~/lib/portal-access";
import { lockAccountProfile } from "~/server/account-profile-lock";
import { assertFeatureEnabled } from "~/server/program/features";
import { assertMutableProgramRecords } from "~/server/imported-records";
import { lockEntity, type TransactionDb } from "~/server/transactions";

type ExcuseAttendance = { id: string; status: string; excusedAt: Date | null };

/** Old staff saves retained the self marker. An accepted staff snapshot naming
 * this exact row and marker proves that generation is now staff-owned. Missing
 * historical evidence cannot establish an override; retain the schema's marker
 * convention for those indistinguishable legacy records. */
export async function selfMeetingExcuseIds(
  db: Pick<TransactionDb, "auditLog">,
  rows: readonly ExcuseAttendance[],
): Promise<Set<string>> {
  const candidates = rows.filter(
    (row) => row.status === "EXCUSED_ABSENT" && row.excusedAt,
  );
  const owned = new Set(candidates.map((row) => row.id));
  if (!candidates.length) return owned;
  const markers = new Map(
    candidates.map((row) => [row.id, row.excusedAt!.toISOString()]),
  );
  const staff = await db.auditLog.findMany({
    where: {
      operation: "admin.recordMeetingAttendance",
      AND: [
        { details: { path: ["outcome"], equals: "APPLIED" } },
        {
          OR: candidates.map((row) => ({
            details: {
              path: ["changes"],
              array_contains: [
                {
                  entity: "MeetingAttendance",
                  after: [
                    {
                      id: row.id,
                      excusedAt: markers.get(row.id)!,
                    },
                  ],
                },
              ],
            },
          })),
        },
      ],
    },
    select: { details: true },
  });
  for (const { details } of staff) {
    if (!details || typeof details !== "object" || Array.isArray(details))
      continue;
    const changes = details.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (
        !change ||
        typeof change !== "object" ||
        Array.isArray(change) ||
        change.entity !== "MeetingAttendance" ||
        !Array.isArray(change.after)
      )
        continue;
      for (const row of change.after) {
        if (
          row &&
          typeof row === "object" &&
          !Array.isArray(row) &&
          typeof row.id === "string" &&
          typeof row.excusedAt === "string" &&
          markers.get(row.id) === row.excusedAt
        )
          owned.delete(row.id);
      }
    }
  }
  return owned;
}

/** Match rollover/account lifecycle ordering before the shared attendance/hours
 * fence. The current linked membership and meeting are rechecked after waiting. */
export async function meetingForTutorExcuse(
  tx: TransactionDb,
  input: { userId: string; tutorId: string; meetingId: string },
) {
  await lockEntity(tx, "program:period");
  await lockAccountProfile(tx, input.userId);
  const { meeting } = await lockMeetingExcuseSource(tx, {
    meetingId: input.meetingId,
    tutorId: input.tutorId,
  });
  const account = await tx.user.findUnique({
    where: { id: input.userId },
    select: {
      role: true,
      tutorId: true,
      tutorAccessRevoked: true,
      suspendedAt: true,
      mergedIntoId: true,
      recoveryVoidedAt: true,
      schoolDeparture: true,
      tutor: { select: { status: true } },
    },
  });
  if (
    account?.tutorId !== input.tutorId ||
    account.tutorAccessRevoked ||
    account.recoveryVoidedAt ||
    account.tutor?.status !== "ACTIVE" ||
    !portalAccess(account).canParticipate
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This action requires an active tutor account.",
    });
  return meeting;
}

export function staffMeetingAttendanceConflict(): never {
  throw new TRPCError({
    code: "CONFLICT",
    message:
      "Staff recorded attendance for this meeting. Ask staff to correct it.",
  });
}

/** Caller takes the period fence first; any account-authority fences precede
 * this source boundary. Share parent -> tutor-hours ordering with staff/import,
 * then read the cutoff/source after waiting. */
export async function lockMeetingExcuseSource(
  tx: TransactionDb,
  input: { meetingId: string; tutorId: string },
) {
  await lockEntity(tx, `meeting-record:${input.meetingId}`);
  await lockEntity(tx, `meeting-hours:${input.tutorId}`);
  await assertFeatureEnabled(tx, "MEETINGS");
  await tx.$queryRaw`SELECT id FROM "TutorMeeting" WHERE id=${input.meetingId} FOR SHARE`;
  const meeting = await tx.tutorMeeting.findUnique({
    where: { id: input.meetingId },
    select: { id: true, title: true, date: true },
  });
  if (!meeting)
    throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found." });
  const attendance = await tx.meetingAttendance.findUnique({
    where: { meetingId_tutorId: input },
    select: { id: true, status: true, excusedAt: true },
  });
  await assertMutableProgramRecords(tx, [
    { entity: "TutorMeeting", recordId: input.meetingId },
    ...(attendance
      ? [{ entity: "MeetingAttendance", recordId: attendance.id }]
      : []),
  ]);
  return { meeting, attendance };
}
