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
  it("rejects a ZIP64 sentinel without its required extra field", () => {
    const regular = zipSync({ "Tutor.csv": strToU8("id\na") });
    const endOffset = regular.length - 22;
    const directoryOffset = new DataView(regular.buffer).getUint32(endOffset + 16, true);
    const archive = new Uint8Array(regular.length + 76);
    archive.set(regular.subarray(0, endOffset));
    archive.set(regular.subarray(endOffset), endOffset + 76);
    const view = new DataView(archive.buffer);
    // ZIP64 end record and locator identify this as a ZIP64 archive.
    view.setUint32(endOffset, 0x06064b50, true);
    view.setBigUint64(endOffset + 4, 44n, true);
    view.setBigUint64(endOffset + 24, 1n, true);
    view.setBigUint64(endOffset + 32, 1n, true);
    view.setBigUint64(endOffset + 40, BigInt(endOffset - directoryOffset), true);
    view.setBigUint64(endOffset + 48, BigInt(directoryOffset), true);
    view.setUint32(endOffset + 56, 0x07064b50, true);
    view.setBigUint64(endOffset + 64, BigInt(endOffset), true);
    view.setUint32(endOffset + 72, 1, true);
    // A missing ZIP64 extra field previously trapped fflate's parser in a loop.
    // Corrupt the central directory's compressed size without adding that field.
    view.setUint32(directoryOffset + 20, 0xffffffff, true);
    expect(() => readRecordArchive(archive)).toThrow();
  });
});
