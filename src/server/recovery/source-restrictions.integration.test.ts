import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "~/server/db";
import { decideMembership } from "~/server/membership";
import { currentPolicy } from "~/server/policy-acceptance";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  applyRecoveryCheckpoint,
  inspectRecoveryCheckpoint,
} from "./checkpoint";
import { participantIdentity } from "./adapters/shared";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(() => db.$disconnect());

const rollback = "rollback original-source recovery fixture";
type Provenance = "COMBINE" | "HISTORY_OVERRIDE";
async function fixture(
  provenance: Provenance,
  work: (
    tx: TransactionDb,
    data: Awaited<ReturnType<typeof setup>>,
  ) => Promise<void>,
) {
  await expect(
    db.$transaction(
      async (tx) => {
        await work(tx, await setup(tx, provenance));
        throw new Error(rollback);
      },
      { timeout: 40000 },
    ),
  ).rejects.toThrow(rollback);
}

async function setup(tx: TransactionDb, provenance: Provenance) {
  const prefix = `recovery-original-${randomUUID()}`;
  await tx.term.updateMany({ where: { active: true }, data: { active: false } });
  await tx.term.create({
    data: {
      id: `${prefix}-term`,
      name: "Synthetic source restriction term",
      schoolYear: "84-85",
      quarter: "Q1",
      active: true,
    },
  });
  const actor = await tx.user.create({
    data: { id: `${prefix}-reviewer`, role: "ADMIN" },
  });
  const tutor = await tx.tutor.create({
    data: {
      id: `${prefix}-tutor`,
      englishName: "Synthetic original-source tutor",
      status: "ACTIVE",
    },
  });
  const owner = await tx.user.create({
    data: {
      id: `${prefix}-current`,
      role: "TUTOR",
      tutorId: tutor.id,
      academicProfile: {
        create: { status: "NOT_APPLICABLE", reconfirmRequired: false },
      },
    },
  });
  const person = await tx.person.create({
    data: { id: `${prefix}-person`, primaryUserId: owner.id },
  });
  await tx.user.update({
    where: { id: owner.id },
    data: { personId: person.id },
  });
  await tx.tutor.update({
    where: { id: tutor.id },
    data: { personId: person.id },
  });
  const original = await tx.user.create({
    data: {
      id: `${prefix}-original`,
      personId: person.id,
      mergedIntoId: owner.id,
    },
  });
  const unrelated = await tx.user.create({
    data: {
      id: `${prefix}-unrelated`,
      personId: person.id,
      suspendedAt: new Date("2026-10-01T00:00:00Z"),
    },
  });
  await tx.tutorProfileOwnership.create({
    data: { tutorId: tutor.id, userId: owner.id },
  });

  // Seed immutable, exact historical evidence before the ordinary domain writer.
  // Neither Person membership nor a retirement-family inference supplies it.
  if (provenance === "COMBINE") {
    await tx.personCombineReceipt.create({
      data: {
        id: `${prefix}-combine`,
        actorId: actor.id,
        inputHash: "synthetic-reviewed-source-provenance",
        personId: person.id,
        outcome: "GROUPED",
        retiredUserIds: [original.id],
        ownershipTransfers: [
          {
            entity: "Tutor",
            recordId: tutor.id,
            sourceUserId: original.id,
            readerUserId: owner.id,
          },
        ],
      },
    });
  } else {
    const receipt = await tx.personHistoryCorrectionReceipt.create({
      data: {
        id: `${prefix}-history`,
        actorId: actor.id,
        inputHash: "synthetic-reviewed-source-provenance",
        personId: person.id,
        destinationPersonId: person.id,
        sourceUserIds: [original.id],
        before: {},
        after: {},
        subjects: [{ entity: "Tutor", recordId: tutor.id }],
      },
    });
    await tx.historyRowOwnership.create({
      data: {
        entity: "Tutor",
        recordId: tutor.id,
        readerUserId: owner.id,
        sourceUserIds: [original.id],
        receiptId: receipt.id,
      },
    });
  }
  await tx.policyDocument.upsert({
    where: { slug_locale: { slug: "tutor-policy", locale: "en" } },
    create: {
      slug: "tutor-policy",
      locale: "en",
      title: "Synthetic current tutor policy",
      body: "Synthetic current participation agreement",
    },
    update: {},
  });
  const policy = await currentPolicy(tx, "tutor-policy");
  await tx.policyAcceptance.create({
    data: {
      userId: owner.id,
      slug: "tutor-policy",
      revision: policy.revision,
      snapshot: policy.documents,
      signature: "Synthetic current owner's explicit agreement",
    },
  });
  const request = await tx.tutorStatusRequest.create({
    data: { tutorId: tutor.id, kind: "OPT_OUT", eligibleAt: new Date(0) },
  });
  await decideMembership(tx, "tutor", request.id, true, actor);
  const checkpoint = await tx.recoveryCheckpoint.findFirstOrThrow({
    where: { adapter: "PARTICIPANT_TUTOR", sourceId: tutor.id },
  });
  return { actor, tutor, owner, original, unrelated, checkpoint };
}

it.each(["COMBINE", "HISTORY_OVERRIDE"] as const)(
  "uses real %s provenance to block retired-source suspension without importing unrelated Person restrictions",
  async (provenance) => {
    await fixture(provenance, async (tx, data) => {
      const before = await inspectRecoveryCheckpoint(tx, {
        checkpointId: data.checkpoint.id,
      });
      expect(before.coverage).toBe("COMPLETE");
      const identity = await participantIdentity(tx, "TUTOR", data.tutor.id);
      expect(identity.ownerIds).toEqual([data.owner.id]);
      expect(identity.sourceRestrictions.sourceUserIds).toContain(data.original.id);
      expect(identity.sourceRestrictions.sourceUserIds).not.toContain(data.unrelated.id);
      const suspendedAt = new Date("2026-11-01T00:00:00Z");
      await tx.user.update({
        where: { id: data.original.id },
        data: { suspendedAt, sessionVersion: { increment: 1 } },
      });
      const after = await inspectRecoveryCheckpoint(tx, {
        checkpointId: data.checkpoint.id,
      });
      expect(after.fingerprint).not.toBe(before.fingerprint);
      expect(after.blockers.join(" ")).toContain("original account");
      await expect(
        applyRecoveryCheckpoint(
          tx,
          {
            checkpointId: data.checkpoint.id,
            expectedFingerprint: before.fingerprint,
            clientKey: randomUUID(),
            reason: "Synthetic stale original-source review",
          },
          data.actor,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await tx.recoveryReceipt.count({
        where: { actionId: data.checkpoint.actionId },
      })).toBe(0);
      expect(await tx.tutor.findUniqueOrThrow({
        where: { id: data.tutor.id },
      })).toMatchObject({ status: "OPTED_OUT" });
      expect(await tx.user.findUniqueOrThrow({
        where: { id: data.original.id },
      })).toMatchObject({ suspendedAt, mergedIntoId: data.owner.id });
    });
  },
);

it("retains an original retired source's school departure despite an eligible current owner", async () => {
  await fixture("HISTORY_OVERRIDE", async (tx, data) => {
    const before = await inspectRecoveryCheckpoint(tx, {
      checkpointId: data.checkpoint.id,
    });
    expect(before.coverage).toBe("COMPLETE");
    await tx.schoolDeparture.create({
      data: {
        userId: data.original.id,
        reason: "TRANSFERRED",
        source: "SYNTHETIC_REVIEWED_HISTORY",
        revision: 7,
      },
    });
    const after = await inspectRecoveryCheckpoint(tx, {
      checkpointId: data.checkpoint.id,
    });
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.blockers.join(" ")).toContain("original account");
    const identity = await participantIdentity(tx, "TUTOR", data.tutor.id);
    expect(identity.sourceRestrictions.accounts.find(
      (account) => account.id === data.original.id,
    )?.schoolDeparture).toMatchObject({ reason: "TRANSFERRED", revision: 7 });
    expect(identity.owners.map((owner) => owner.id)).toEqual([data.owner.id]);
  });
});
