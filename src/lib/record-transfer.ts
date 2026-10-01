import { z } from "zod";
import { toCsv } from "~/lib/csv";

export const TRANSFER_MAX_BYTES = 5 * 1024 * 1024;
export const TRANSFER_MAX_ROWS = 5000;
export const transferFilesSchema = z
  .array(
    z
      .object({
        name: z.string().regex(/^[A-Za-z]+\.csv$/),
        text: z.string().max(TRANSFER_MAX_BYTES),
      })
      .strict(),
  )
  .min(1)
  .max(60)
  .superRefine((files, ctx) => {
    if (new Set(files.map((f) => f.name)).size !== files.length)
      ctx.addIssue({
        code: "custom",
        message: "Select each CSV filename only once.",
      });
    if (
      files.reduce(
        (size, f) => size + new TextEncoder().encode(f.text).length,
        0,
      ) > TRANSFER_MAX_BYTES
    )
      ctx.addIssue({
        code: "custom",
        message: "Import at most 5 MiB of CSV data at a time.",
      });
  });
export type TransferFile = z.infer<typeof transferFilesSchema>[number];

/** Strict RFC-style CSV reader: commas, doubled quotes, CRLF, BOM and multiline cells.
 * Reject malformed quoting instead of silently moving values into another column. */
export function parseRecordCsv(text: string): string[][] {
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const finishCell = () => {
    row.push(cell);
    cell = "";
    closed = false;
  };
  const finishRow = () => {
    finishCell();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += ch;
    } else if (ch === ",") finishCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      finishRow();
    } else if (ch === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || ch === '"')
        throw new Error(`CSV row ${rows.length + 1}: invalid quoting.`);
      cell += ch;
    }
  }
  if (quoted) throw new Error(`CSV row ${rows.length + 1}: unclosed quote.`);
  if (cell || row.length || closed) finishRow();
  if (!rows.length) throw new Error("CSV is empty; include a header row.");
  if (rows.length > TRANSFER_MAX_ROWS + 1)
    throw new Error("Import at most 5,000 records at a time.");
  return rows;
}

/** Transfer-specific escaping is reversible as well as spreadsheet-safe. Null is \\N;
 * leading backslashes/apostrophes are doubled, and toCsv neutralizes formula text. */
export function recordCsv(
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  return (
    "\uFEFF" +
    toCsv([
      columns,
      ...rows.map((row) =>
        columns.map((column) => {
          const value = row[column];
          if (value == null) return "\\N";
          if (typeof value === "number") return value;
          const text =
            typeof value === "string" ? value : JSON.stringify(value);
          return /^[\\']/.test(text) ? text[0] + text : text;
        }),
      ),
    ])
  );
}

export function decodeRecordCell(cell: string): string | null {
  if (cell === "\\N") return null;
  if (cell.startsWith("\\\\")) return cell.slice(1);
  if (cell.startsWith("'")) return cell.slice(1);
  return cell;
}

export const TRANSFER_README = `SHBS program records CSV format v1
One CSV per record type. Keep filenames and column names unchanged.
Upload one or more CSV files together, or this ZIP, then preview before importing.
UTF-8; ISO 8601 timestamps (with Z or offset); booleans true/false; lists and objects use JSON.
\\N means null. Empty cells mean empty text, not null. Double a leading backslash or apostrophe.
Formula-like text is prefixed with an apostrophe for spreadsheet safety; import removes it.
IDs are stable references. Assign unique IDs to new records and reuse them in related files.
Omit columns with defaults to use database defaults. Primary keys must always be supplied.
User.csv is reference-only: accounts must already exist with the same ID and email.
Imports add records only: exact repeats are skipped; conflicting existing records reject the batch.
New terms must be inactive. Pairings and sessions can only be added to inactive terms.
Account passwords, tokens, roles, permissions, private messages, audit/approval execution data,
website content, live configuration and uploaded files are outside this program-record archive.
Survey verification tokens are excluded and imported surveys receive unusable token hashes.
Maximum per transfer: 5 MiB of CSV data and 5,000 records. Larger archives require an operator backup.
`;
