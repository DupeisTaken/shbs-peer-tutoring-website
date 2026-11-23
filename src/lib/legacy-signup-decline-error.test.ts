import { TRPCError } from "@trpc/server";
import { expect, it, vi } from "vitest";
import { assertNoPublishedTuteeDeletion } from "~/server/session-planning/deletion-guards";
import {
  localizedLegacySignupDeclineError,
  PUBLISHED_SESSION_DECLINE_MESSAGE,
} from "./legacy-signup-decline-error";

it("localizes the actual BAD_REQUEST decline refusal from the publication guard", async () => {
  const count = vi.fn().mockResolvedValue(1);
  const database = {
    sessionPlanParticipant: { count },
  } as unknown as Parameters<typeof assertNoPublishedTuteeDeletion>[0];
  const failure: unknown = await assertNoPublishedTuteeDeletion(
    database,
    "synthetic-guard-tutee",
    "declineSignup",
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(TRPCError);
  if (!(failure instanceof TRPCError))
    throw new Error("Expected the publication guard to reject the decline");
  expect(failure.code).toBe("BAD_REQUEST");
  expect(count).toHaveBeenCalledExactlyOnceWith({
    where: { tuteeId: "synthetic-guard-tutee" },
  });
  const translate = vi.fn(() => "Authored guidance in the active language");
  expect(localizedLegacySignupDeclineError(failure.message, translate)).toBe(
    "Authored guidance in the active language",
  );
  expect(translate).toHaveBeenCalledExactlyOnceWith("publishedSessionRecords");
});

it.each([
  undefined,
  "",
  "Version conflict: source was updated at 2026-11-05T00:00:00Z",
  "Cannot decline a signup with attendance history. Use its participation controls instead.",
  "Cannot delete a tutee with published dated-session records. Set them inactive and preserve the session history instead.",
  `${PUBLISHED_SESSION_DECLINE_MESSAGE} Extra server detail.`,
  ` ${PUBLISHED_SESSION_DECLINE_MESSAGE}`,
])("leaves other messages to each display owner's fallback: %s", (message) => {
  const translate = vi.fn(() => "Unrelated guidance");
  expect(localizedLegacySignupDeclineError(message, translate)).toBeUndefined();
  expect(translate).not.toHaveBeenCalled();
});
