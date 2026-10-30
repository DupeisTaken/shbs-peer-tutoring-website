import type { Prisma, SessionPlanCohort } from "../../../generated/prisma";
import type { TransactionDb } from "~/server/transactions";
import { insertSessionNotices } from "./notice-inserts";
import { notificationTuteeRecipients } from "./notification-recipients";

const READ_BATCH_SIZE = 500;
type PublicationCohort = Pick<
  SessionPlanCohort,
  "id" | "version" | "startsAt" | "endsAt" | "roomId" | "online"
>;
export type PublicationNoticeInput = Readonly<{
  tutorId: string;
  timeZone: string;
  subjects: readonly string[];
  cohort: Readonly<PublicationCohort>;
  tuteeIds: readonly string[];
  event: "schedule_updated" | "cancelled";
}>;
export type PublicationNotice = Readonly<{
  tutorId: string;
  timeZone: string;
  subjects: readonly string[];
  cohort: Readonly<
    Omit<PublicationCohort, "startsAt" | "endsAt"> & {
      startsAt: string;
      endsAt: string;
    }
  >;
  tuteeIds: readonly string[];
  event: PublicationNoticeInput["event"];
}>;

/** Capture the decided audience and clocks before later publication writes.
 * ISO strings and copied/frozen arrays avoid mutable Date/roster references.
 */
export function capturePublicationNotice(
  input: PublicationNoticeInput,
): PublicationNotice {
  return Object.freeze({
    tutorId: input.tutorId,
    timeZone: input.timeZone,
    subjects: Object.freeze([...input.subjects]),
    cohort: Object.freeze({
      id: input.cohort.id,
      version: input.cohort.version,
      startsAt: input.cohort.startsAt.toISOString(),
      endsAt: input.cohort.endsAt.toISOString(),
      roomId: input.cohort.roomId,
      online: input.cohort.online,
    }),
    tuteeIds: Object.freeze([...input.tuteeIds]),
    event: input.event,
  });
}

/** Finalize only newly created, non-actionable publication notices. The caller
 * owns the planning fence/transaction and has already serialized every conflict
 * decision and plan/cohort/participant write. Reconciliation and formal requests
 * retain their existing paths, including original-clock and response authority.
 *
 * Contacts/room names are deliberately read fresh at finalization; the decided
 * audience/clocks above are never rederived from a later cohort. This is no
 * authority cache. Delivery independently rechecks address ownership after commit.
 * Errors propagate so the caller rolls back publication and all notice inserts.
 */
export async function queuePublicationNotices(
  tx: Pick<
    TransactionDb,
    "user" | "studentProfileOwnership" | "room" | "sessionNotice"
  >,
  descriptors: readonly PublicationNotice[],
): Promise<void> {
  if (!descriptors.length) return;
  const tutorIds = [...new Set(descriptors.map((notice) => notice.tutorId))];
  const tuteeIds = [
    ...new Set(descriptors.flatMap((notice) => notice.tuteeIds)),
  ];
  const roomIds = [
    ...new Set(
      descriptors.flatMap((notice) =>
        notice.cohort.roomId ? [notice.cohort.roomId] : [],
      ),
    ),
  ];
  const tutors = new Map<string, { id: string; email: string }>();
  for (let offset = 0; offset < tutorIds.length; offset += READ_BATCH_SIZE) {
    const users = await tx.user.findMany({
      where: {
        tutorId: { in: tutorIds.slice(offset, offset + READ_BATCH_SIZE) },
      },
      select: { id: true, email: true, tutorId: true },
    });
    for (const user of users)
      if (user.tutorId !== null) tutors.set(user.tutorId, user);
  }
  const tutees = new Map<string, { id: string; email: string }>();
  for (let offset = 0; offset < tuteeIds.length; offset += READ_BATCH_SIZE)
    for (const { tuteeId, user } of await notificationTuteeRecipients(
      tx,
      tuteeIds.slice(offset, offset + READ_BATCH_SIZE),
    ))
      tutees.set(tuteeId, user);
  const roomNames = new Map<string, string>();
  for (let offset = 0; offset < roomIds.length; offset += READ_BATCH_SIZE) {
    const rooms = await tx.room.findMany({
      where: { id: { in: roomIds.slice(offset, offset + READ_BATCH_SIZE) } },
      select: { id: true, name: true },
    });
    for (const room of rooms) roomNames.set(room.id, room.name);
  }
  const intents: Prisma.SessionNoticeCreateManyInput[] = [];
  for (const notice of descriptors) {
    const tutor = tutors.get(notice.tutorId);
    const audience = tutor?.email
      ? [{ actorKey: `tutor:${notice.tutorId}`, user: tutor }]
      : [];
    for (const tuteeId of notice.tuteeIds) {
      const user = tutees.get(tuteeId);
      if (user) audience.push({ actorKey: `tutee:${tuteeId}`, user });
    }
    const { cohort } = notice;
    // Preserve the legacy stored context verbatim, including null room labels,
    // leading whitespace and clipping. Rendering owns sessionNoticeContext.
    const context = {
      isActionable: false,
      startsAt: cohort.startsAt,
      endsAt: cohort.endsAt,
      timeZone: notice.timeZone,
      originalStartsAt: cohort.startsAt,
      subjectLabel: [...new Set(notice.subjects)].join(" / ").slice(0, 200),
      roomLabel: cohort.roomId
        ? (roomNames.get(cohort.roomId)?.slice(0, 120) ?? null)
        : null,
      online: cohort.online,
    };
    for (const person of audience)
      intents.push({
        dedupeKey: `cohort:${cohort.id}:${cohort.version}:${notice.event}:${person.actorKey}`,
        recipientUserId: person.user.id,
        recipientEmail: person.user.email,
        event: notice.event,
        context,
      });
  }
  // One operation-wide call retains first-intent dedupe, queue state, bounded
  // inserts and normal row-level recovery triggers without broad conflict skips.
  await insertSessionNotices(tx, intents);
}
