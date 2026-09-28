import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  decodeRecordCell,
  parseRecordCsv,
  recordCsv,
  transferFilesSchema,
  TRANSFER_MAX_BYTES,
} from "./record-transfer";
import {
  createRecordArchive,
  readRecordArchive,
} from "./record-transfer-archive";

describe("historical CSV files", () => {
  it("preserves Unicode, commas, quotes, multiline values, nulls and formula-safe strings", () => {
    const values = [
      null,
      "",
      "辅导伙伴",
      'a,"b"\nc',
      "=1+1",
      "  @SUM(A1)",
      "'quoted",
      "\\N",
      "\\path",
      "\ttext",
    ];
    const csv = recordCsv(
      ["value"],
      values.map((value) => ({ value })),
    );
    expect(
      parseRecordCsv(csv)
        .slice(1)
        .map((row) => decodeRecordCell(row[0]!)),
    ).toEqual(values);
    expect(csv).toContain("'=1+1");
  });
  it.each(['id\n"unfinished', 'id\n"closed"junk', 'id\nstray"quote'])(
    "rejects malformed CSV %s",
    (text) => expect(() => parseRecordCsv(text)).toThrow(),
  );
  it("handles CRLF and a trailing empty field without a spurious record", () => {
    expect(parseRecordCsv("\uFEFFid,name\r\na,\r\n")).toEqual([
      ["id", "name"],
      ["a", ""],
    ]);
  });
  it("rejects duplicate names, paths and oversized data", () => {
    const file = { name: "Tutor.csv", text: "id\ntutor" };
    expect(transferFilesSchema.safeParse([file, file]).success).toBe(false);
    expect(
      transferFilesSchema.safeParse([{ ...file, name: "../Tutor.csv" }])
        .success,
    ).toBe(false);
    expect(
      transferFilesSchema.safeParse([
        { ...file, text: "中".repeat(TRANSFER_MAX_BYTES / 2) },
      ]).success,
    ).toBe(false);
  });
  it("round trips a ZIP and rejects paths and decompression bombs", () => {
    const files = [
      { name: "Tutor.csv", text: "id,englishName\ntutor,Example" },
    ];
    expect(readRecordArchive(createRecordArchive(files))).toEqual(files);
    expect(() =>
      readRecordArchive(zipSync({ "../Tutor.csv": strToU8("id\na") })),
    ).toThrow(/filename/);
    expect(() =>
      readRecordArchive(
        zipSync({ "Tutor.csv": new Uint8Array(TRANSFER_MAX_BYTES + 1) }),
      ),
    ).toThrow(/limits/);
  });
});
