import { TRPCError } from "@trpc/server";
import type { DomainDb } from "~/server/transactions";

export const schedulingNoticeRetentionMessage =
  "Scheduling notices must be retained. Suspend this account, change its memberships, or combine duplicate accounts instead of deleting it.";

/** Publication is retained evidence even before the first attendance submission.
 * Caller context changes only guidance; all statuses and dates remain protected. */
export async function assertNoPublishedTuteeDeletion(
  database: DomainDb,
  tuteeId: string,
  operation: "delete" | "declineSignup" = "delete",
) {
  if (await database.sessionPlanParticipant.count({ where: { tuteeId } }))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        operation === "declineSignup"
          ? "Cannot decline a signup with published dated-session records. Review its participation controls instead."
          : "Cannot delete a tutee with published dated-session records. Set them inactive and preserve the session history instead.",
    });
}

export async function assertNoSchedulingNoticeDeletion(
  database: DomainDb,
  userId: string,
) {
  if (
    await database.sessionNotice.count({ where: { recipientUserId: userId } })
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: schedulingNoticeRetentionMessage,
    });
}
