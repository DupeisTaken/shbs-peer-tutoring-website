import { TRPCError } from "@trpc/server";
import type { TransactionDb } from "~/server/transactions";

/** Stable local provenance identity, preserving scalar ID compatibility and
 * canonical field order/types for composite keys. Only primary keys are stored. */
export function importedRecordKey(
  row: Record<string, unknown>,
  keys: readonly string[],
) {
  if (keys.length === 1 && keys[0] === "id") return String(row.id);
  return JSON.stringify(
    [...keys]
      .sort()
      .map((key) => [
        key,
        row[key] instanceof Date ? row[key].toISOString() : row[key],
      ]),
  );
}

/** Native management mutations never rewrite archive evidence as a side effect.
 * A separate reviewed archive correction/recovery is required for those rows. */
export async function assertMutableProgramRecords(
  tx: Pick<TransactionDb, "importedRecordProvenance">,
  records: { entity: string; recordId: string }[],
) {
  if (!records.length) return;
  const imported = await tx.importedRecordProvenance.findFirst({
    where: { OR: records },
    select: { entity: true },
  });
  if (imported)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This action includes imported historical evidence. Its recorded source values are preserved. Use an operator-reviewed archive recovery to correct or remove it.",
    });
}

export async function isImportedProgramRecord(
  tx: Pick<TransactionDb, "importedRecordProvenance">,
  entity: string,
  recordId: string,
) {
  return !!(await tx.importedRecordProvenance.findUnique({
    where: { entity_recordId: { entity, recordId } },
    select: { recordId: true },
  }));
}
