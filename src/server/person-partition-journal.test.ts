import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "./db";
import type { TransactionDb } from "./transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(() => db.$disconnect());
const serialized = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item);

async function fixture(work: (tx: TransactionDb, prefix: string) => Promise<void>) {
  await expect(db.$transaction(async (tx) => {
    await work(tx, randomUUID());
    throw new Error("rollback partition journal fixture");
  })).rejects.toThrow("rollback partition journal fixture");
}
async function receipt(tx: TransactionDb, id: string, subjects: { entity: string; recordId: string; privateNote?: string }[]) {
  return tx.personPartitionReceipt.create({ data: {
    id, actorId: `${id}-actor`, inputHash: "private-operation-hash", personId: `${id}-old`, newPersonId: `${id}-new`,
    sources: [{ kind: "TUTOR", id: `${id}-source`, privateNote: "private-source-note" }], subjects,
  } });
}

it("links only typed affected subjects and keeps unrelated same-actor roots clean", () => fixture(async (tx, id) => {
  await tx.recoveryTrackedEntity.createMany({ data: [
    { actionId: `${id}-related`, entity: "Tutor", recordId: `${id}-source` },
    { actionId: `${id}-collision`, entity: "User", recordId: `${id}-source` },
    { actionId: `${id}-reviewer`, entity: "User", recordId: `${id}-actor` },
  ] });
  await receipt(tx, id, [{ entity: "Tutor", recordId: `${id}-source`, privateNote: "private-subject-note" }]);
  const changes = await tx.recoveryChange.findMany({ where: { actionId: { startsWith: id } } });
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ actionId: `${id}-related`, entity: "PersonPartitionReceipt", operation: "INSERT" });
  expect(changes[0]!.after).toEqual({ id, personId: `${id}-old`, newPersonId: `${id}-new`, subjects: [{ entity: "Tutor", recordId: `${id}-source` }] });
  expect(changes[0]!.changedFields).toEqual(["actorId", "createdAt", "id", "inputHash", "newPersonId", "personId", "sources", "subjects"]);
  expect(serialized(changes)).not.toContain("private-");
  expect(await tx.recoveryEvent.findFirst({ where: { actionId: `${id}-related` } })).toMatchObject({ kind: "UNSUPPORTED" });
}));

it("journals both resulting Person subjects without interpreting arbitrary JSON as an edge", () => fixture(async (tx, id) => {
  await tx.recoveryTrackedEntity.createMany({ data: [
    { actionId: `${id}-old-root`, entity: "Person", recordId: `${id}-old` },
    { actionId: `${id}-new-root`, entity: "Person", recordId: `${id}-new` },
    { actionId: `${id}-unknown-root`, entity: "UnknownTable", recordId: `${id}-source` },
  ] });
  await receipt(tx, id, [{ entity: "Person", recordId: `${id}-old` }, { entity: "Person", recordId: `${id}-new` }, { entity: "UnknownTable", recordId: `${id}-source` }]);
  const changes = await tx.recoveryChange.findMany({ where: { actionId: { startsWith: id } }, orderBy: { actionId: "asc" } });
  expect(changes.map((row) => row.actionId)).toEqual([`${id}-new-root`, `${id}-old-root`]);
  expect(serialized(changes)).not.toContain("UnknownTable");
}));

it("suppresses compensation only for its exact root while retaining other roots", () => fixture(async (tx, id) => {
  await tx.recoveryTrackedEntity.createMany({ data: [
    { actionId: `${id}-first`, entity: "Tutor", recordId: `${id}-source` },
    { actionId: `${id}-second`, entity: "Tutor", recordId: `${id}-source` },
  ] });
  await tx.$queryRaw`SELECT set_config('shbs.recovery_compensating', ${`${id}-first`}, true)`;
  await receipt(tx, id, [{ entity: "Tutor", recordId: `${id}-source` }]);
  expect(await tx.recoveryChange.count({ where: { actionId: `${id}-first` } })).toBe(0);
  expect(await tx.recoveryChange.count({ where: { actionId: `${id}-second` } })).toBe(1);
  expect(await tx.recoveryEvent.findFirst({ where: { actionId: `${id}-second` } })).toMatchObject({ kind: "RECOVERY_COMPENSATION" });
}));

it("rejects the legacy global compensation flag instead of hiding other roots", async () => {
  await expect(db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('shbs.recovery_compensating','1',true)`;
    await receipt(tx, randomUUID(), []);
  })).rejects.toThrow("Recovery compensation requires an exact root");
});
