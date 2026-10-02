import { z } from "zod";
import { isSchoolYear } from "./period";
import { decodeRecordCell, parseRecordCsv, recordCsv } from "./record-transfer";

export const HISTORICAL_BATCH_LIMIT = 50;
export const historicalYear = z
  .string()
  .refine(isSchoolYear, "HISTORICAL_YEAR_INVALID")
  .nullable();
export const historicalCorrectionRow = z
  .object({
    recordId: z.string().min(1).max(256),
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    rawGrade: z.string().max(200).nullable(),
    schoolYear: historicalYear,
    evidence: z.string().trim().min(1).max(500),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export const historicalCorrectionRows = z
  .array(historicalCorrectionRow)
  .min(1)
  .max(HISTORICAL_BATCH_LIMIT)
  .refine(
    (rows) => new Set(rows.map((row) => row.recordId)).size === rows.length,
    "HISTORICAL_DUPLICATE_ID",
  );
export const historicalCorrectionInput = z
  .object({
    rows: historicalCorrectionRows,
    method: z.enum(["WEBSITE", "CSV"]),
  })
  .strict();
export type HistoricalCorrectionRow = z.infer<typeof historicalCorrectionRow>;
export type HistoricalCorrectionInput = z.infer<
  typeof historicalCorrectionInput
>;

export const HISTORICAL_CSV_COLUMNS = [
  "recordId",
  "expectedFingerprint",
  "rawGrade",
  "schoolYear",
  "evidence",
  "reason",
];

/** Stable record IDs and the exported snapshot are mandatory. Names are never matching keys.
 * Keep the archive's reversible null/formula escaping, including unsupported raw grades. */
export function parseHistoricalCorrectionCsv(
  text: string,
): HistoricalCorrectionRow[] {
  if (new TextEncoder().encode(text).length > 256 * 1024)
    throw new Error("HISTORICAL_CSV_LIMIT");
  const [header, ...rows] = parseRecordCsv(text);
  if (rows.length > HISTORICAL_BATCH_LIMIT)
    throw new Error("HISTORICAL_CSV_LIMIT");
  if (
    header?.length !== HISTORICAL_CSV_COLUMNS.length ||
    new Set(header).size !== header.length ||
    header.some((key) => !HISTORICAL_CSV_COLUMNS.includes(key))
  )
    throw new Error("HISTORICAL_CSV_COLUMNS");
  return historicalCorrectionRows.parse(
    rows.map((cells) => {
      if (cells.length !== header.length)
        throw new Error("HISTORICAL_CSV_COLUMNS");
      return Object.fromEntries(
        header.map((key, index) => [key, decodeRecordCell(cells[index]!)]),
      );
    }),
  );
}

export function historicalCorrectionCsv(rows: HistoricalCorrectionRow[]) {
  return recordCsv(HISTORICAL_CSV_COLUMNS, rows);
}

/** Reserved IDs identify the original enrollment/roster evidence, including missing grades.
 * Additional imported years use their own stable IDs and never replace this baseline. */
export function legacyAcademicRecordId(kind: "TUTEE" | "TUTOR", id: string) {
  return `legacy-${kind.toLowerCase()}:${id}`;
}
