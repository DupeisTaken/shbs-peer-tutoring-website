import { TRPCError } from "@trpc/server";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";
import { notifyAdmins, notifyUsers } from "./notifications/create";
import { recordAudit } from "./audit/log";

type Member = { kind: "tutor" | "crew"; id: string };
type RequestKind = "OPT_OUT" | "REENTRY";
type Actor = { id: string; name?: string | null };
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** One lock namespace covers submission, recall and review. The row lock also serializes
 * direct roster status edits; authorization middleware alone is not a fresh state check. */
async function lockMember(tx: TransactionDb, member: Member) {
  await lockEntity(tx, `membership:${member.kind}:${member.id}`);
  if (member.kind === "tutor") {
    await tx.$queryRaw`SELECT id FROM "Tutor" WHERE id = ${member.id} FOR UPDATE`;
    const row = await tx.tutor.findUniqueOrThrow({ where: { id: member.id } });
    return { status: row.status, name: row.englishName };
  }
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${member.id} FOR UPDATE`;
  const row = await tx.user.findUniqueOrThrow({ where: { id: member.id } });
  return { status: row.crewStatus, name: row.name ?? "Crew member" };
}

/** Keep existing duplicate requests as evidence, but prevent any new duplicate through the API. */
export async function requestMembership(
  db: DomainDb,
  member: Member,
  kind: RequestKind,
  reason?: string,
) {
  return inTransaction(db, async (tx) => {
    const current = await lockMember(tx, member);
    if (current.status !== (kind === "OPT_OUT" ? "ACTIVE" : "OPTED_OUT")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          kind === "OPT_OUT"
            ? "Only active members can opt out."
            : "Only opted-out members can request reentry.",
      });
    }
    const pending =
      member.kind === "tutor"
        ? await tx.tutorStatusRequest.findFirst({
            where: { tutorId: member.id, state: "PENDING" },
          })
        : await tx.crewStatusRequest.findFirst({
            where: { userId: member.id, state: "PENDING" },
          });
    if (pending)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "You already have an open request.",
      });
    const eligibleAt =
      kind === "OPT_OUT" ? new Date(Date.now() + COOLDOWN_MS) : null;
    const trimmedReason = reason?.trim() ?? "";
    const data = { kind, eligibleAt, reason: trimmedReason.length > 0 ? trimmedReason : null };
    const request =
      member.kind === "tutor"
        ? await tx.tutorStatusRequest.create({
            data: { tutorId: member.id, ...data },
          })
        : await tx.crewStatusRequest.create({
            data: { userId: member.id, ...data },
          });
    await notifyAdmins(
      {
        title: `${member.kind === "tutor" ? "Tutor" : "Crew"} ${kind === "OPT_OUT" ? "opt-out" : "reentry"} request`,
        body: `${current.name} asked ${kind === "OPT_OUT" ? "to opt out (review after the cooldown)" : "to rejoin"}.`,
        link: member.kind === "tutor" ? "/admin/tutor-requests" : "/admin/crew",
      },
      undefined,
      tx,
    );
    return { ok: true, id: request.id, eligibleAt };
  });
}

/** A recall can only transition a still-pending request; an approved decision is immutable. */
export async function recallMembership(
  db: DomainDb,
  member: Member,
  requestId?: string,
) {
  return inTransaction(db, async (tx) => {
    await lockMember(tx, member);
    const request =
      member.kind === "tutor"
        ? await tx.tutorStatusRequest.findFirst({
            where: { id: requestId, tutorId: member.id, state: "PENDING" },
          })
        : await tx.crewStatusRequest.findFirst({
            where: { userId: member.id, kind: "OPT_OUT", state: "PENDING" },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          });
    if (!request)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No open request to recall.",
      });
    const changed =
      member.kind === "tutor"
        ? await tx.tutorStatusRequest.updateMany({
            where: { id: request.id, state: "PENDING" },
            data: {
              state: "RECALLED",
              resolvedAt: new Date(),
              resolvedByName: "self",
            },
          })
        : await tx.crewStatusRequest.updateMany({
            where: { id: request.id, state: "PENDING" },
            data: {
              state: "RECALLED",
              decidedAt: new Date(),
              decidedByName: "self",
            },
          });
    if (!changed.count)
      throw new TRPCError({
        code: "CONFLICT",
        message: "This request is already resolved.",
      });
    return { ok: true };
  });
}

/** Membership, decision, notification and audit are one transaction, including when invoked
 * inside coordinator approval. Re-queueing students remains the existing explicit staff action. */
export async function decideMembership(
  db: DomainDb,
  kind: Member["kind"],
  requestId: string,
  approve: boolean,
  actor: Actor,
) {
  return inTransaction(db, async (tx) => {
    const initial =
      kind === "tutor"
        ? await tx.tutorStatusRequest.findUniqueOrThrow({
            where: { id: requestId },
          })
        : await tx.crewStatusRequest.findUniqueOrThrow({
            where: { id: requestId },
          });
    const member: Member = {
      kind,
      id: "tutorId" in initial ? initial.tutorId : initial.userId,
    };
    const current = await lockMember(tx, member);
    const request =
      kind === "tutor"
        ? await tx.tutorStatusRequest.findUniqueOrThrow({
            where: { id: requestId },
          })
        : await tx.crewStatusRequest.findUniqueOrThrow({
            where: { id: requestId },
          });
    if (request.state !== "PENDING")
      throw new TRPCError({
        code: "CONFLICT",
        message: "This request is already resolved.",
      });
    if (
      approve &&
      request.kind === "OPT_OUT" &&
      ((kind === "tutor" && !request.eligibleAt) ||
        (request.eligibleAt && request.eligibleAt > new Date()))
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The one-week cooldown hasn't elapsed yet.",
      });
    }
    // A historical pending request cannot reverse a later manual archive or membership change.
    if (
      approve &&
      current.status !== (request.kind === "OPT_OUT" ? "ACTIVE" : "OPTED_OUT")
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Membership changed since this request. Decline it and review the current roster.",
      });
    }
    const state = approve ? "APPROVED" : "DENIED";
    const changed =
      kind === "tutor"
        ? await tx.tutorStatusRequest.updateMany({
            where: { id: request.id, state: "PENDING" },
            data: {
              state,
              resolvedAt: new Date(),
              resolvedById: actor.id,
              resolvedByName: actor.name,
            },
          })
        : await tx.crewStatusRequest.updateMany({
            where: { id: request.id, state: "PENDING" },
            data: { state, decidedAt: new Date(), decidedByName: actor.name },
          });
    if (!changed.count)
      throw new TRPCError({
        code: "CONFLICT",
        message: "This request is already resolved.",
      });
    if (approve) {
      const status = request.kind === "OPT_OUT" ? "OPTED_OUT" : "ACTIVE";
      if (kind === "tutor")
        await tx.tutor.update({ where: { id: member.id }, data: { status } });
      else
        await tx.user.update({
          where: { id: member.id },
          data: { crewStatus: status },
        });
    }
    const userId =
      kind === "crew"
        ? member.id
        : (
            await tx.user.findUnique({
              where: { tutorId: member.id },
              select: { id: true },
            })
          )?.id;
    if (userId)
      await notifyUsers(
        [userId],
        {
          title: approve
            ? request.kind === "OPT_OUT"
              ? "Opt-out approved"
              : "Reentry approved"
            : "Request declined",
          body: approve
            ? request.kind === "OPT_OUT"
              ? "Your opt-out was approved."
              : "Welcome back — your membership is active again."
            : "An admin declined your request.",
          link: kind === "tutor" ? "/dashboard" : "/patrol",
        },
        tx,
      );
    await recordAudit(
      {
        userId: actor.id,
        userName: actor.name,
        action: `${approve ? "Approved" : "Denied"} ${kind} ${request.kind} request for ${current.name}`,
        entity: kind === "tutor" ? "TutorStatusRequest" : "CrewStatusRequest",
        entityId: request.id,
      },
      tx,
    );
    return { ok: true };
  });
}
