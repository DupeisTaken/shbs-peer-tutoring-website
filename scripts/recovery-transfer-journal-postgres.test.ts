/** Opt-in journal/compensation rehearsal; the supplied database is never reset. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { PrismaClient, type Prisma } from "../generated/prisma";
import { hashPassword } from "../src/server/auth/password";
import { utcDatabaseUrl } from "../src/server/database-url";
import { assertIsolatedTestDatabase } from "../src/test/database-guard";

const adminUrl = process.env.SHBS_RECOVERY_TEST_SOURCE_ADMIN_URL;

function object(value: Prisma.JsonValue) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value;
}

void test("fixed-room transfer journals one later transaction per root and refuses unsupported compensation", {
  skip: !adminUrl,
  timeout: 180_000,
}, async (t) => {
  assert.ok(adminUrl);
  assertIsolatedTestDatabase(adminUrl);
  const name = `shbs_transfer_journal_${randomBytes(6).toString("hex")}_test`;
  const ownedUrl = new URL(adminUrl);
  ownedUrl.pathname = `/${name}`;
  assertIsolatedTestDatabase(ownedUrl.toString());
  const admin = new Client({ connectionString: utcDatabaseUrl(adminUrl), connectionTimeoutMillis: 5000 });
  await admin.connect();
  let created = false;
  let client: PrismaClient | undefined;
  const globalClient = globalThis as typeof globalThis & { prisma?: PrismaClient };
  const previousClient = globalClient.prisma;
  try {
    // Only the generated database is disposable. No migration or cleanup targets
    // the supplied maintenance database, and cleanup never terminates backends.
    assert.match(name, /^shbs_transfer_journal_[a-f0-9]{12}_test$/);
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`);
    created = true;
    const migrationClient = new Client({ connectionString: utcDatabaseUrl(ownedUrl.toString()), connectionTimeoutMillis: 5000 });
    await migrationClient.connect();
    try {
      const root = resolve(import.meta.dirname, "../prisma/migrations");
      const migrations = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      for (const migration of migrations)
        await migrationClient.query(await readFile(join(root, migration, "migration.sql"), "utf8"));
    } finally {
      await migrationClient.end();
    }
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcDatabaseUrl(ownedUrl.toString()), max: 2 }) });
    const database = client;
    // Legacy helpers importing the shared client also stay inside this owned DB.
    // Import runtime modules only after binding it; no module or journal is mocked.
    globalClient.prisma = database;
    const { currentPolicy } = await import("../src/server/policy-acceptance");
    const { approveQualification } = await import("../src/server/qualifications");
    const { previewPersonParticipationTransfer, transferPersonParticipation } = await import("../src/server/person-participation");
    const { captureRecoveryCheckpoint, inspectRecoveryCheckpoint,
      applyRecoveryCheckpoint, applyRecoveryCheckpointFromOperator } = await import("../src/server/recovery/checkpoint");
    const password = "Synthetic-fixed-room-journal-460!";
    const passwordHash = hashPassword(password);

    async function seed(quarter: "Q1" | "Q2") {
      const prefix = `room-journal-${randomUUID()}`;
      return database.$transaction(async (tx) => {
        await tx.term.updateMany({ where: { active: true }, data: { active: false } });
        const term = await tx.term.create({ data: { name: prefix, schoolYear: "26-27", quarter, active: true } });
        const person = await tx.person.create({ data: {} });
        const actor = await tx.user.create({ data: { email: `${prefix}-admin@example.test`, role: "ADMIN", passwordHash } });
        const tutors = await Promise.all(["source", "target"].map((suffix) =>
          tx.tutor.create({ data: { personId: person.id, englishName: `${prefix}-${suffix}`, status: "ACTIVE" } })));
        const [source, target] = tutors;
        assert.ok(source && target);
        const accounts = [];
        for (const tutor of tutors) accounts.push(await tx.user.create({ data: {
          personId: person.id, email: `${tutor.id}@example.test`, role: "TUTOR", tutorId: tutor.id,
          emailVerifiedAt: new Date(), passwordHash,
          academicProfile: { create: { status: "NOT_APPLICABLE", reconfirmRequired: false } },
        } }));
        const learner = await tx.tutee.create({ data: {
          englishName: `${prefix}-learner`, status: "ACTIVE", intakeTermId: term.id,
          signedRulebook: true, signedAt: new Date(), signatureName: "Synthetic explicit agreement",
        } });
        const owner = await tx.user.create({ data: {
          email: `${learner.id}@example.test`, role: "STUDENT", studentId: learner.id, tuteeMember: true,
          emailVerifiedAt: new Date(), academicProfile: { create: { status: "NOT_APPLICABLE", reconfirmRequired: false } },
        } });
        for (const [slug, owners] of [["tutor-policy", accounts], ["tutee-policy", [owner]]] as const) {
          await tx.policyDocument.upsert({ where: { slug_locale: { slug, locale: "en" } },
            create: { slug, locale: "en", title: "Synthetic policy", body: "Synthetic journal participation agreement" }, update: {} });
          const policy = await currentPolicy(tx, slug);
          for (const user of owners) await tx.policyAcceptance.create({ data: {
            userId: user.id, slug, revision: policy.revision, snapshot: policy.documents, signature: "Synthetic explicit agreement",
          } });
        }
        const subject = await tx.subject.create({ data: { name: `${prefix}-mathematics` } });
        await approveQualification(tx, source.id, subject.id, actor.id);
        const room = await tx.room.create({ data: { name: `${prefix}-fixed-room` } });
        const pairing = await tx.pairing.create({ data: {
          tutorId: source.id, termId: term.id, subject: subject.name, dayOfWeek: 2, startMin: 600, endMin: 645,
          scheduleConfirmed: true, roomMode: "FIXED", roomId: room.id, tutees: { create: { tuteeId: learner.id } },
        } });
        const retained = accounts.find((user) => user.tutorId === target.id)!;
        const selection = { personId: person.id, retainedUserId: retained.id, activeTutorId: target.id,
          activeTuteeId: null, tutorIds: [source.id, target.id], tuteeIds: [], acknowledgeHistoryAccessCorrection: true };
        return { actor, source, target, accounts, learner, term, room, pairing, selection };
      }, { timeout: 30_000 });
    }
    async function checkpoints(f: Awaited<ReturnType<typeof seed>>) {
      // Each API call owns and commits its transaction before the transfer.
      const roots = [];
      for (const tutor of [f.source, f.target]) {
        const checkpoint = await captureRecoveryCheckpoint(database, { adapter: "PARTICIPANT_TUTOR", sourceId: tutor.id }, f.actor);
        const preview = await inspectRecoveryCheckpoint(database, checkpoint);
        assert.equal(preview.coverage, "COMPLETE", preview.blockers.join(" "));
        assert.equal(preview.websiteEligible, true);
        roots.push(checkpoint);
      }
      return roots;
    }
    async function intent(f: Awaited<ReturnType<typeof seed>>) {
      const preview = await previewPersonParticipationTransfer(database, f.selection);
      assert.equal(preview.canTransfer, true, JSON.stringify(preview.blockers));
      return { ...f.selection, fingerprint: preview.fingerprint, operationId: randomUUID(),
        reason: "Reviewed exact fixed-room transfer and immutable recovery descendants", acknowledged: true as const, confirmPassword: password };
    }
    async function state(f: Awaited<ReturnType<typeof seed>>, actionIds: string[], operationId: string) {
      return database.$transaction(async (tx) => ({
        pairings: await tx.pairing.findMany({ where: { termId: f.term.id }, orderBy: { id: "asc" } }),
        edges: await tx.pairingExecutionSuccessor.findMany({ where: { receiptId: operationId }, orderBy: { sourcePairingId: "asc" } }),
        transfer: await tx.personParticipationTransferReceipt.findUnique({ where: { id: operationId } }),
        users: await tx.user.findMany({ where: { id: { in: f.accounts.map((user) => user.id) } }, select: { id: true, tutorId: true }, orderBy: { id: "asc" } }),
        changes: await tx.recoveryChange.findMany({ where: { actionId: { in: actionIds } }, orderBy: { id: "asc" } }),
        events: await tx.recoveryEvent.findMany({ where: { actionId: { in: actionIds } }, orderBy: { id: "asc" } }),
        fences: await tx.recoveryFence.findMany({ where: { actionId: { in: actionIds } }, orderBy: { actionId: "asc" } }),
        receipts: await tx.recoveryReceipt.findMany({ where: { actionId: { in: actionIds } }, orderBy: { id: "asc" } }),
      }));
    }

    await t.test("separate committed capture and transfer preserve per-root grouping while both channels fail closed", async () => {
      const f = await seed("Q1");
      const roots = await checkpoints(f);
      const input = await intent(f);
      const result = await transferPersonParticipation(database, f.actor.id, input);
      assert.equal(result.successorPairingIds.length, 1);
      const successorId = result.successorPairingIds[0]!;
      const snapshot = await state(f, roots.map((root) => root.actionId), input.operationId);
      assert.deepEqual(snapshot.pairings.find((row) => row.id === f.pairing.id), f.pairing);
      assert.equal(snapshot.pairings.find((row) => row.id === successorId)?.roomId, f.room.id);
      const transactionIds = new Set<string>();
      for (const [index, root] of roots.entries()) {
        const checkpoint = await database.recoveryCheckpoint.findUniqueOrThrow({ where: { id: root.checkpointId } });
        const events = snapshot.events.filter((event) => event.actionId === root.actionId && event.transactionId !== checkpoint.captureTransactionId);
        assert.equal(events.length, 1, "One transfer transaction is one later event per root, regardless of row count.");
        const event = events[0]!;
        transactionIds.add(event.transactionId);
        const changes = snapshot.changes.filter((row) => row.actionId === root.actionId);
        assert.ok(changes.length > 1);
        assert.ok(changes.every((row) => row.eventId === event.id));
        assert.equal(snapshot.fences.find((row) => row.actionId === root.actionId)?.revision, changes.length);
        const edge = changes.find((row) => row.entity === "PairingExecutionSuccessor" && object(row.recordKey).sourcePairingId === f.pairing.id);
        assert.ok(edge, "Both the original and executing tutor roots must see the exact transfer edge.");
        if (index === 1) {
          // The target root already tracks Tutor B. The source-only root need
          // not see the provisional insertion before the edge connects its work.
          const pairingChanges = changes.filter((row) => row.entity === "Pairing" && object(row.recordKey).id === successorId);
          const inserted = pairingChanges.find((row) => row.operation === "INSERT");
          const reserved = pairingChanges.find((row) => row.operation === "UPDATE" && object(row.before).scheduleConfirmed === false && object(row.after).scheduleConfirmed === true);
          assert.ok(inserted && reserved);
          assert.equal(object(inserted.after).roomId, null);
          assert.equal(object(inserted.after).roomMode, "NONE");
          assert.equal(object(inserted.after).scheduleConfirmed, false);
          assert.equal(object(inserted.after).groupId, null);
          assert.equal(object(reserved.after).roomId, f.room.id);
          assert.equal(object(reserved.after).roomMode, "FIXED");
          assert.ok(inserted.id < edge.id && edge.id < reserved.id);
        }
        const preview = await inspectRecoveryCheckpoint(database, root);
        assert.equal(preview.dependentEventCount, 1);
        assert.equal(preview.coverage, "UNKNOWN");
        assert.equal(preview.websiteEligible, false);
        assert.ok(preview.blockers.includes("Unsupported participant descendant changes require a separate correction."));
        assert.deepEqual(await state(f, roots.map((item) => item.actionId), input.operationId), snapshot, "Preview must be read-only.");
        for (const apply of [applyRecoveryCheckpoint, applyRecoveryCheckpointFromOperator]) {
          await assert.rejects(() => apply(database, { checkpointId: root.checkpointId,
            expectedFingerprint: preview.fingerprint, clientKey: randomUUID(), reason: "Synthetic unsupported transfer must remain blocked" }, f.actor),
          (error: unknown) => error instanceof Error && "code" in error && error.code === "PRECONDITION_FAILED");
          assert.deepEqual(await state(f, roots.map((item) => item.actionId), input.operationId), snapshot,
            "Neither website nor operator refusal may compensate bookings or commit a fence/receipt.");
        }
      }
      assert.equal(transactionIds.size, 1, "Both roots identify the same committed transfer transaction.");
    });

    await t.test("failed roster validation rolls provisional bookings and their journal/fence changes back atomically", async () => {
      const f = await seed("Q2");
      const roots = await checkpoints(f);
      // This existing roster guard rejects only after successor preparation.
      // Its original closed request is evidence, not consent to assign again.
      await database.studentSurvey.create({ data: { tuteeId: f.learner.id, state: "ABORTED",
        email: `${f.learner.id}@example.test`, intakeTermId: f.term.id, payload: {}, policyRevision: "original",
        policySnapshot: {}, tokenHash: randomUUID(), expiresAt: new Date("2099-01-01T00:00:00Z"), confirmedAt: new Date() } });
      const input = await intent(f);
      const before = await state(f, roots.map((root) => root.actionId), input.operationId);
      await assert.rejects(() => transferPersonParticipation(database, f.actor.id, input), /closed or expired student request/i);
      assert.deepEqual(await state(f, roots.map((root) => root.actionId), input.operationId), before,
        "An aborted transfer must leave no provisional target, edge, event, journal row, fence increment or receipt.");
    });
  } finally {
    await client?.$disconnect();
    globalClient.prisma = previousClient;
    try {
      if (created) {
        assert.match(name, /^shbs_transfer_journal_[a-f0-9]{12}_test$/);
        assert.notEqual(name, new URL(adminUrl).pathname.slice(1));
        await admin.query(`DROP DATABASE "${name}"`);
      }
    } finally {
      await admin.end();
    }
  }
});
