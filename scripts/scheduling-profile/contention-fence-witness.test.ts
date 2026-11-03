import assert from "node:assert/strict";
import { AsyncResource } from "node:async_hooks";
import test from "node:test";
import { Prisma } from "../../generated/prisma";
import { buildContentionFenceEvidence, captureContentionFenceEvidence, createContentionFenceWitness, isContentionPeriodFence } from "./contention-fence-witness";

const raw = () => ({ strings: ["SELECT pg_advisory_xact_lock(hashtextextended(", ", 0))"], values: ["program:period"] });
const observed = async (reverse = false) => {
  const witness = createContentionFenceWitness();
  for (const role of reverse ? ["acceptance", "bulk"] as const : ["bulk", "acceptance"] as const)
    await witness.run(role, () => witness.observeExecuteRaw(raw(), () => Promise.resolve(1)));
  return witness;
};
const audits = (reversed = false, tied = false) => {
  const first = "2026-11-03T00:00:00.000Z", second = tied ? first : "2026-11-03T00:00:00.010Z";
  const bulk = { id: reversed ? "z" : "a", operation: "admin.autoAssignUnassignedRooms", createdAt: reversed ? second : first };
  const responses = ["sessionPlanning.accepted", "sessionPlanning.responded", "sessionPlanning.respond"].map((operation, index) => ({ id: String.fromCharCode(98 + index), operation, createdAt: reversed ? first : second }));
  return reversed ? [...responses, bulk] : [bulk, ...responses];
};

void test("only the exact bound lockEntity period template is observed", () => {
  const key = "program:period";
  assert.equal(isContentionPeriodFence(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`), true);
  assert.equal(isContentionPeriodFence(raw()), true);
  assert.equal(isContentionPeriodFence([raw()]), true);
  assert.equal(isContentionPeriodFence([raw().strings, "program:period"]), true);
  for (const args of [
    { ...raw(), values: ["planned-room-schedule"] },
    { ...raw(), values: ["program:period", "extra"] },
    { ...raw(), strings: [raw().strings[0], ",0))"] },
    { ...raw(), strings: [raw().strings[0], ", 0)); SELECT 1"] },
    "SELECT pg_advisory_xact_lock(hashtextextended('program:period', 0))",
    { text: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", values: ["program:period"] },
  ]) assert.equal(isContentionPeriodFence(args), false);
});

void test("successful completion ordinals establish order independently of invocation order", async () => {
  const witness = createContentionFenceWitness();
  let finish: (value: number) => void = () => undefined;
  const blocked = new Promise<number>((resolve) => { finish = resolve; });
  const bulk = witness.run("bulk", () => witness.observeExecuteRaw(raw(), () => blocked));
  await witness.run("acceptance", () => witness.observeExecuteRaw(raw(), () => Promise.resolve(1)));
  finish(1); await bulk;
  assert.equal(witness.order(), "acceptance-before-bulk");
  assert.deepEqual(witness.snapshot().operations.map((row) => [row.role, row.invocation, row.acquisitions[0]?.sequence]), [["bulk", 0, 2], ["acceptance", 1, 1]]);
});

void test("detached server execution requires and preserves explicit operation binding", async () => {
  const server = new AsyncResource("contention-witness-detached-server");
  try {
    for (const reverse of [false, true]) {
      const witness = createContentionFenceWitness();
      for (const role of reverse ? ["acceptance", "bulk"] as const : ["bulk", "acceptance"] as const) {
        await witness.run(role, () => {
          const handler = witness.bindCurrentContext(() => witness.observeExecuteRaw(raw(), () => Promise.resolve(1)));
          return server.runInAsyncScope(handler);
        });
      }
      assert.equal(witness.order(), reverse ? "acceptance-before-bulk" : "bulk-before-acceptance");
    }
    const missing = createContentionFenceWitness();
    await missing.run("bulk", () => server.runInAsyncScope(() => missing.observeExecuteRaw(raw(), () => Promise.resolve(1))));
    await missing.run("acceptance", () => missing.observeExecuteRaw(raw(), () => Promise.resolve(1)));
    assert.throws(() => missing.order(), /Missing or duplicate real period/);
  } finally { server.emitDestroy(); }
});

void test("failed, missing, duplicate and unfinished acquisitions fail closed with raw terminals retained", async () => {
  const failed = createContentionFenceWitness();
  await assert.rejects(failed.run("bulk", () => failed.observeExecuteRaw(raw(), () => Promise.reject(new Error("synthetic failure")))), /synthetic failure/);
  await failed.run("acceptance", () => failed.observeExecuteRaw(raw(), () => Promise.resolve(1)));
  assert.equal(failed.snapshot().operations[0]?.terminal, "failed");
  assert.equal(failed.snapshot().operations[0]?.failedAcquisitions, 1);
  assert.throws(() => failed.order(), /did not succeed/);
  const duplicate = createContentionFenceWitness();
  await duplicate.run("bulk", async () => { await duplicate.observeExecuteRaw(raw(), () => Promise.resolve(1)); await duplicate.observeExecuteRaw(raw(), () => Promise.resolve(1)); });
  await duplicate.run("acceptance", () => duplicate.observeExecuteRaw(raw(), () => Promise.resolve(1)));
  assert.throws(() => duplicate.order(), /Missing or duplicate real period/);
  const snapshot = (await observed()).snapshot();
  snapshot.operations[0]!.terminal = "running";
  assert.throws(() => buildContentionFenceEvidence(snapshot, audits()), /did not succeed/);
});

void test("raw audit ties and contradictory persistence chronology remain separate from fence order", async () => {
  const snapshot = (await observed()).snapshot();
  const normal = buildContentionFenceEvidence(snapshot, audits());
  assert.equal(normal.order, "bulk-before-acceptance"); assert.equal(normal.auditHistoryOrder, normal.order);
  assert.equal(normal.hasTimestampTies, true); assert.equal(normal.crossGroupTimestampTie, false);
  const opposite = buildContentionFenceEvidence(snapshot, audits(true));
  assert.equal(opposite.order, "bulk-before-acceptance");
  assert.equal(opposite.auditHistoryOrder, "acceptance-before-bulk");
  assert.equal(opposite.auditTimestampContradictsFence, true); assert.equal(opposite.historyContradictsFence, true);
  const tied = buildContentionFenceEvidence(snapshot, audits(false, true));
  assert.equal(tied.auditTimestampOrder, "tied"); assert.equal(tied.crossGroupTimestampTie, true);
  const varying = audits();
  varying[2]!.createdAt = "2026-11-03T00:00:00.020Z";
  varying[3]!.createdAt = "2026-11-03T00:00:00.030Z";
  const distinct = buildContentionFenceEvidence(snapshot, varying);
  assert.equal(distinct.auditTimestampOrder, "bulk-before-acceptance");
  assert.equal(distinct.responseTimestampUniform, false);
  assert.equal(distinct.hasTimestampTies, false);
  assert.equal("txStartOrder" in distinct, false);
  assert.equal("txStartOrderBasis" in distinct, false);
  const interleaved = [...varying];
  interleaved[0] = { ...interleaved[0]!, createdAt: "2026-11-03T00:00:00.015Z" };
  interleaved.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  assert.equal(buildContentionFenceEvidence(snapshot, interleaved).auditTimestampOrder, "interleaved");
  assert.throws(() => buildContentionFenceEvidence(snapshot, audits().slice(1)), /Missing or extra/);
  const duplicate = audits(); duplicate[3] = duplicate[2]!;
  assert.throws(() => buildContentionFenceEvidence(snapshot, duplicate), /Duplicate contention audit/);
});

void test("capture selects only four raw audit identities/clocks after both operations succeed", async () => {
  const snapshot = (await observed()).snapshot();
  const db = { auditLog: { findMany: (args: unknown) => {
    assert.deepEqual(args, { where: { operation: { in: ["admin.autoAssignUnassignedRooms", "sessionPlanning.accepted", "sessionPlanning.responded", "sessionPlanning.respond"] } },
      select: { id: true, operation: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return Promise.resolve(audits());
  } } } as unknown as Parameters<typeof captureContentionFenceEvidence>[0];
  const evidence = await captureContentionFenceEvidence(db, snapshot);
  assert.equal(evidence.order, "bulk-before-acceptance");
  assert.deepEqual(Object.keys(evidence.audits[0]!).sort(), ["auditId", "createdAt", "operation"]);
});
