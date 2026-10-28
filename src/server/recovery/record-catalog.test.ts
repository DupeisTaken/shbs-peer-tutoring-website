import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { $Enums, Prisma } from "../../../generated/prisma";
import { RECORD_PRIMARY_KEYS } from "./record-catalog";

const schema = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

it("keeps every explicit record identity aligned with the current Prisma schema", () => {
  // Only the repository-owned schema is parsed. This test guards the small explicit
  // runtime catalog because Prisma 7 deliberately strips DMMF primary-key metadata.
  const keys = Object.fromEntries(
    [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((match) => {
      const name = match[1]!;
      const body = match[2]!;
      const compound = /@@id\s*\(\s*\[([^\]]+)\]/s.exec(body);
      const fields = compound
        ? compound[1]!.split(",").map((field) => field.trim())
        : [...body.matchAll(/^\s*(\w+)\s+\S+[^\n]*\s@id\b/gm)].map(
            (field) => field[1]!,
          );
      expect(
        fields.length,
        `${name} must have an explicit primary key`,
      ).toBeGreaterThan(0);
      return [name, fields];
    }),
  );
  expect(RECORD_PRIMARY_KEYS).toEqual(keys);
  expect(
    Prisma.dmmf.datamodel.models.map((model) => model.name).sort(),
  ).toEqual(Object.keys(keys).sort());
  for (const model of Prisma.dmmf.datamodel.models) {
    for (const key of RECORD_PRIMARY_KEYS[model.name] ?? [])
      expect(
        model.fields.some(
          (field) => field.name === key && field.kind !== "object",
        ),
      ).toBe(true);
  }
});

it("uses generated enum values in the schema order for finite-domain pagination", () => {
  const generated = $Enums as Record<string, Record<string, string>>;
  for (const match of schema.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const values = [
      ...match[2]!.replace(/\/\/[^\n]*/g, "").matchAll(/^\s*(\w+)\b/gm),
    ].map((value) => value[1]!);
    expect(Object.values(generated[match[1]!] ?? {}), match[1]).toEqual(values);
  }
});
