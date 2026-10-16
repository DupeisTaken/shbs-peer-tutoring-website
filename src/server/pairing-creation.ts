import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { approvalScope } from "~/server/db-scope";
import { lockEntity, type TransactionDb } from "~/server/transactions";
import type { RoomOutcome } from "~/lib/room-allocation";

type CreationIntent = {
  clientKey?: string;
  tutorId: string;
  subject: string;
  subjectId?: string;
  timeSlotId: string;
  roomMode?: "AUTO" | "FIXED" | "NONE";
  roomId?: string;
  tuteeIds: string[];
};

/** Only semantic input is fingerprinted: a renewed one-use qualification ticket is not
 * a different requested pairing. Current catalogue labels/availability are never hashed. */
export function pairingCreationHash(input: CreationIntent) {
  const roomMode = input.roomMode ?? (input.roomId ? "FIXED" : "AUTO");
  return createHash("sha256")
    .update(
      JSON.stringify({
        tutorId: input.tutorId,
        subject: input.subject,
        subjectId: input.subjectId ?? null,
        timeSlotId: input.timeSlotId,
        roomMode,
        roomId: roomMode === "FIXED" ? (input.roomId ?? null) : null,
        tuteeIds: [...new Set(input.tuteeIds)].sort(),
      }),
    )
    .digest("hex");
}

/** The actor comes from authenticated context, or the trusted approval request during replay.
 * A receipt is written only with the committed pairing; failed validation can amend the draft. */
export async function pairingCreationReceipt(
  db: TransactionDb,
  actorId: string,
  input: CreationIntent,
) {
  if (!input.clientKey) return null; // Pre-deployment clients and immutable proposals remain parseable.
  const approvalId = approvalScope.getStore();
  if (approvalId) {
    const request = await db.approvalRequest.findUniqueOrThrow({
      where: { id: approvalId },
      select: { requesterId: true, operation: true },
    });
    if (request.operation !== "admin.createPairing")
      throw new TRPCError({
        code: "CONFLICT",
        message: "This review does not authorize pairing creation.",
      });
    actorId = request.requesterId;
  }
  await lockEntity(db, `pairing-creation:${actorId}:${input.clientKey}`);
  const identity = { actorId, clientKey: input.clientKey };
  const payloadHash = pairingCreationHash(input);
  const receipt = await db.pairingCreationRequest.findUnique({
    where: { actorId_clientKey: identity },
  });
  if (!receipt) return { ...identity, payloadHash, replay: null };
  if (receipt.payloadHash !== payloadHash)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This draft already created a different pairing. Refresh the list before deliberately starting a new pairing.",
    });
  const pairing = await db.pairing.findUnique({
    where: { id: receipt.pairingId },
  });
  if (!pairing)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This draft's pairing was already created and later deleted. Start a new pairing deliberately; retrying will not recreate it.",
    });
  // Report current persisted state, without replaying allocation or claiming a historical room
  // is still reserved if staff has changed the pairing since the original response was lost.
  const roomOutcome: RoomOutcome = !pairing.scheduleConfirmed
    ? "AWAITING"
    : pairing.roomNeedsAssignment
      ? "UNAVAILABLE"
      : pairing.roomMode === "NONE"
        ? "NONE"
        : pairing.roomId
          ? "RETAINED"
          : "UNASSIGNED";
  return { ...identity, payloadHash, replay: { ...pairing, roomOutcome } };
}
