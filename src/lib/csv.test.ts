import { expect, it } from "vitest";
import { toCsv } from "./csv";

/** Independent RFC-style reader verifies that separators and quotes cannot create extra cells. */
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && input[i + 1] === "\n" && !quoted) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

it("round-trips names, dates, punctuation, multiline text, nulls and numeric quantities", () => {
  const input = [
    [
      "林同学",
      "2026-09-22",
      'A, "quoted" name',
      "Line one\nLine two",
      "CR\r\nLF",
      null,
      0,
      -1.5,
      3.25,
    ],
  ];
  expect(parseCsv(toCsv(input))).toEqual([
    [
      "林同学",
      "2026-09-22",
      'A, "quoted" name',
      "Line one\nLine two",
      "CR\r\nLF",
      "",
      "0",
      "-1.5",
      "3.25",
    ],
  ]);
});

it.each([
  "=1+1",
  "+SUM(1,2)",
  "-1+2",
  "@SUM(1,2)",
  "\t=1+1",
  "\r=1+1",
  "\n=1+1",
  " \t=1+1",
  "  +1+2",
  "\u0000=1+1",
  "\u007f=1+1",
  "＝1+1",
  "＋1+1",
  "－1+1",
  "＠SUM(1,2)",
])(
  "neutralizes spreadsheet formula/control prefix %j without splitting cells",
  (value) => {
    const csv = toCsv([["Name", value, "Next column"]]);
    expect(parseCsv(csv)).toEqual([["Name", `'${value}`, "Next column"]]);
    expect(csv).toContain(",\"'");
  },
);

it("keeps embedded delimiters and quote escapes inside the original text cell", () => {
  const value = '=1+1",=2+2\r\n=3+3';
  expect(
    parseCsv(
      toCsv([
        [value, "safe"],
        ["Next row", 2],
      ]),
    ),
  ).toEqual([
    [`'${value}`, "safe"],
    ["Next row", "2"],
  ]);
  expect(parseCsv(toCsv([['ordinary",=2+2', "safe"]]))).toEqual([
    ['ordinary",=2+2', "safe"],
  ]);
});
