import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "../../../generated/prisma";
import { notificationInAppEvent } from "~/lib/notification-details";
import {
  notificationAttendanceStatus,
  notificationList,
} from "~/lib/notification-facts";
import {
  managementNotificationRecipients,
  notifyUsers,
} from "~/server/notifications/create";
import { computeSessionHours } from "~/lib/service-hours";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
} from "~/server/transactions";
import { reconsiderSessionFlag } from "~/server/crew/flags";
import { lockAttendanceSchedule } from "~/server/attendance-schedule";
import { syncPunishmentRemoval } from "~/server/discipline/removal";
import { getFeatures } from "~/server/program/features";
import { withRecoveryDeliverySource } from "~/server/recovery/delivery-effects";

const reason = z.string().trim().min(1, "Explain the correction.").max(1000);
const rating = z.number().int().min(1).max(5).nullable();
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export const attendanceCorrectionInput = z
  .object({
    id: z.string(),
    expectedUpdatedAt: z.coerce.date(),
    reason,
    date: z.coerce.date(),
    startMin: z.number().int().min(0).max(1439),
    endMin: z.number().int().min(1).max(1440),
    tutorStatus: z.enum(["PRESENT", "RESCHEDULED", "EXTRA", "TUTOR_ABSENT"]),
    tutorAbsentReason: z.string().trim().max(1000).nullable(),
    comments: z.string().max(5000).nullable(),
    online: z.boolean(),
    actualRoomId: z.string().nullable(),
    ratingPreparedness: rating,
    ratingParticipation: rating,
    ratingUnderstanding: rating,
    ratingBehavior: rating,
    ratingProgress: rating,
    tutees: z
      .array(
        z.object({
          tuteeId: z.string(),
          status: z.enum(["PRESENT", "EXCUSED_ABSENT", "UNEXCUSED_ABSENT"]),
          absenceReason: z.string().trim().max(1000).nullable(),
        }),
      )
      .min(1),
  })
  .superRefine((v, c) => {
    const fail = (message: string) =>
      c.addIssue({ code: z.ZodIssueCode.custom, message });
    if (v.endMin <= v.startMin) fail("End time must be after start time.");
    if (v.tutorStatus === "TUTOR_ABSENT" && !v.tutorAbsentReason)
      fail("Give a tutor absence reason.");
    if (v.tutees.some((t) => t.status === "EXCUSED_ABSENT" && !t.absenceReason))
      fail("Give each excused absence a reason.");
    if (
      v.tutorStatus !== "TUTOR_ABSENT" &&
      v.tutees.some((t) => t.status === "PRESENT") &&
      [
        v.ratingPreparedness,
        v.ratingParticipation,
        v.ratingUnderstanding,
        v.ratingBehavior,
        v.ratingProgress,
      ].some((x) => x === null)
    )
      fail("Complete all five ratings for a held session.");
  });

/** Shared correction writer: caller supplies current management authority; this
 * service retains schedule/merge locks, exact roster validation and derived effects.
 * Recovery uses a newly reviewed correction, never stored hour/card balances. */
export async function correctAttendance(
  db: DomainDb,
  raw: z.input<typeof attendanceCorrectionInput>,
  actor: { id: string; name?: string | null },
) {
  const input = attendanceCorrectionInput.parse(raw);
  return inTransaction(db, async (tx) => {
    const { withAutomaticRecoveryCheckpoint } =
      await import("~/server/recovery/checkpoint");
    return withAutomaticRecoveryCheckpoint(
      tx,
      { adapter: "ATTENDANCE", sourceId: input.id },
      actor,
      async () => {
        await lockAttendanceSchedule(tx);
        const requested = await tx.session.findUniqueOrThrow({
          where: { id: input.id },
        });
        const primaryId = requested.mergeGroupId ?? requested.id;
        await lockEntity(tx, `attendance-correction:${primaryId}`);
        const before = await tx.session.findMany({
          where: { OR: [{ id: primaryId }, { mergeGroupId: primaryId }] },
          include: {
            tutees: { include: { tutee: { select: { englishName: true } } } },
            cards: true,
            flags: true,
          },
        });
        const primary = before.find((s) => s.id === primaryId)!;
        // Corrections share the tutor/day locks used by attendance submission. Lock dates in
        // order so two corrections moving between days cannot introduce duplicate credit.
        const dateKeys = [
          ...new Set(
            [primary.date, input.date].map((date) =>
              date.toISOString().slice(0, 10),
            ),
          ),
        ].sort();
        for (const dateKey of dateKeys)
          await lockEntity(tx, `attendance-day:${primary.tutorId}:${dateKey}`);
        if (primary.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
          throw new TRPCError({
            code: "CONFLICT",
            message: "Attendance changed. Reload before correcting it.",
          });
        const roster = new Set(
          before.flatMap((s) => s.tutees.map((t) => t.tuteeId)),
        );
        if (
          input.tutees.length !== roster.size ||
          new Set(input.tutees.map((t) => t.tuteeId)).size !== roster.size ||
          input.tutees.some((t) => !roster.has(t.tuteeId))
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Include each recorded tutee exactly once.",
          });
        const {
          id: _id,
          expectedUpdatedAt: _version,
          reason: explanation,
          tutees,
          ...raw
        } = input;
        void _id;
        void _version;
        const computed = computeSessionHours({
          ...input,
          tuteeStatuses: tutees.map((t) => t.status),
        });
        const evidenceChanged =
          primary.date.getTime() !== input.date.getTime() ||
          primary.startMin !== input.startMin ||
          primary.endMin !== input.endMin ||
          primary.online !== input.online ||
          primary.actualRoomId !== (input.online ? null : input.actualRoomId) ||
          tutees.some((t) =>
            before.some((s) =>
              s.tutees.some(
                (old) => old.tuteeId === t.tuteeId && old.status !== t.status,
              ),
            ),
          );
        const timeChanged =
          primary.date.getTime() !== input.date.getTime() ||
          primary.startMin !== input.startMin ||
          primary.endMin !== input.endMin;
        // Preserve the ability to correct old overlapping data without moving its window;
        // new overlaps need the existing block corrected rather than another credit.
        if (timeChanged) {
          const dayStart = new Date(
            `${input.date.toISOString().slice(0, 10)}T00:00:00Z`,
          );
          const overlap = await tx.session.findFirst({
            where: {
              tutorId: primary.tutorId,
              id: { notIn: before.map((session) => session.id) },
              date: {
                gte: dayStart,
                lt: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000),
              },
              startMin: { lt: input.endMin },
              endMin: { gt: input.startMin },
            },
            select: { id: true },
          });
          if (overlap)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "This correction overlaps another saved attendance block for the tutor.",
            });
        }
        // Acquire every consequence lock before journaled attendance writes. This
        // keeps ordinary corrections and checkpoint compensation in the same order.
        for (const tuteeId of [...roster].sort())
          await lockEntity(tx, `tutee:${tuteeId}`);
        await lockEntity(tx, `session-flag:${primaryId}`);
        for (const s of before) {
          await tx.session.update({
            where: { id: s.id },
            data: {
              ...raw,
              actualRoomId: raw.online ? null : raw.actualRoomId,
              tutorAbsentReason:
                raw.tutorStatus === "TUTOR_ABSENT"
                  ? raw.tutorAbsentReason
                  : null,
              ...computed,
              shFactor: s.id === primaryId ? computed.shFactor : 0,
              shCount: s.id === primaryId ? computed.shCount : 0,
            },
          });
          for (const tt of s.tutees) {
            const value = tutees.find((t) => t.tuteeId === tt.tuteeId)!;
            const absenceReason =
              value.status === "EXCUSED_ABSENT" ? value.absenceReason : null;
            if (
              tt.status === value.status &&
              tt.absenceReason === absenceReason
            )
              continue;
            await tx.sessionTutee.update({
              where: {
                sessionId_tuteeId: { sessionId: s.id, tuteeId: tt.tuteeId },
              },
              data: {
                status: value.status,
                absenceReason,
              },
            });
          }
        }
        const features = await getFeatures(tx);
        for (const tt of [...tutees].sort((a, b) =>
          a.tuteeId.localeCompare(b.tuteeId),
        )) {
          const old = before
            .flatMap((s) => s.cards)
            .filter((c) => c.tuteeId === tt.tuteeId && c.source === "AUTO");
          // Keep issued cards as historical evidence, but withdraw an absence which was corrected.
          if (tt.status !== "UNEXCUSED_ABSENT")
            await tx.disciplinaryCard.updateMany({
              where: { id: { in: old.map((c) => c.id) } },
              data: {
                reviewStatus: "INVALID",
                reviewNote: `Attendance correction: ${explanation}`,
              },
            });
          else if (
            features.DISCIPLINE &&
            !before.some((s) =>
              s.tutees.some(
                (old) =>
                  old.tuteeId === tt.tuteeId &&
                  old.status === "UNEXCUSED_ABSENT",
              ),
            ) &&
            !old.some((c) => c.reviewStatus === "VALID")
          )
            await tx.disciplinaryCard.create({
              data: {
                tuteeId: tt.tuteeId,
                sessionId: primaryId,
                color: "RED",
                source: "AUTO",
                reason: "Unexcused absence (corrected attendance).",
                reviewStatus: "VALID",
                issuedByTutorId: primary.tutorId,
              },
            });
          await syncPunishmentRemoval(tx, tt.tuteeId);
        }
        if (evidenceChanged) await reconsiderSessionFlag(tx, primaryId);
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            userName: actor.name,
            entity: "Session",
            entityId: primaryId,
            action: `Corrected attendance: ${explanation}`,
            details: json({ before, after: input }),
          },
        });
        const heads = await managementNotificationRecipients(
          tx,
          "record_corrected",
        );
        const tutor = await tx.tutor.findUnique({
          where: { id: primary.tutorId },
          select: { englishName: true },
        });
        const rooms = await tx.room.findMany({
          where: {
            id: {
              in: [primary.actualRoomId, input.actualRoomId].filter(
                (id): id is string => !!id,
              ),
            },
          },
          select: { id: true, name: true },
        });
        const roomLabel = (
          id: string | null,
          online: boolean,
          locale: "en" | "zh",
        ) =>
          online
            ? locale === "en"
              ? "Online"
              : "线上"
            : (rooms.find((room) => room.id === id)?.name ?? "—");
        const changes = (locale: "en" | "zh") =>
          notificationList([
            ...(primary.tutorStatus !== input.tutorStatus
              ? [
                  `${notificationAttendanceStatus(primary.tutorStatus, locale)} → ${notificationAttendanceStatus(input.tutorStatus, locale)}`,
                ]
              : []),
            ...(primary.actualRoomId !== input.actualRoomId ||
            primary.online !== input.online
              ? [
                  `${roomLabel(primary.actualRoomId, primary.online, locale)} → ${roomLabel(input.actualRoomId, input.online, locale)}`,
                ]
              : []),
            ...tutees.flatMap((tutee) => {
              const old = before
                .flatMap((session) => session.tutees)
                .find((row) => row.tuteeId === tutee.tuteeId);
              return old && old.status !== tutee.status
                ? [
                    `${old.tutee.englishName}: ${notificationAttendanceStatus(old.status, locale)} → ${notificationAttendanceStatus(tutee.status, locale)}`,
                  ]
                : [];
            }),
          ]);
        const clock = (minute: number) =>
          `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
        await withRecoveryDeliverySource(
          tx,
          { entity: "Session", recordId: primaryId },
          () =>
            notifyUsers(
              heads.map((h) => h.id),
              {
                ...notificationInAppEvent("record_corrected", undefined, {
                  en: `Management corrected ${tutor?.englishName ?? "Tutor"}'s attendance: ${primary.date.toISOString().slice(0, 10)} ${clock(primary.startMin)}–${clock(primary.endMin)} → ${input.date.toISOString().slice(0, 10)} ${clock(input.startMin)}–${clock(input.endMin)}. ${changes("en")}`,
                  zh: `管理人员已更正 ${tutor?.englishName ?? "辅导伙伴"} 的出勤记录：${primary.date.toISOString().slice(0, 10)} ${clock(primary.startMin)}–${clock(primary.endMin)} → ${input.date.toISOString().slice(0, 10)} ${clock(input.startMin)}–${clock(input.endMin)}。${changes("zh")}`,
                }),
                title: "Management corrected a record",
                body: `${actor.name ?? "Management"}: ${input.reason}`,
                link: "/admin/audit",
              },
              tx,
            ),
        );
        return { ok: true };
      },
    );
  });
}
