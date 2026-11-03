import { describe, expect, it } from "vitest";
import { Client, types } from "pg";
import { configureUtcPgTimestamps, utcDatabaseUrl } from "./database-url";

describe("UTC database connection policy", () => {
  it("preserves credentials, database and unrelated driver options", () => {
    const source = new URL(
      "postgresql://user:p%40ss%3Aword@localhost:5433/school?sslmode=require&application_name=school+admin&schema=public",
    );
    const result = new URL(utcDatabaseUrl(source.href));
    expect(result.username).toBe(source.username);
    expect(result.password).toBe(source.password);
    expect(result.host).toBe(source.host);
    expect(result.pathname).toBe(source.pathname);
    for (const [key, value] of source.searchParams)
      expect(result.searchParams.get(key)).toBe(value);
    expect(result.searchParams.get("options")).toBe("-c timezone=UTC");
  });

  it.each(["Asia/Shanghai", "America/New_York", "UTC"])(
    "preserves other startup settings and overrides %s last",
    (zone) => {
      const source = new URL("postgres://user:pass@localhost/school");
      source.searchParams.set(
        "options",
        `-c statement_timeout=5000 -c timezone=${zone}`,
      );
      const result = new URL(utcDatabaseUrl(source.href));
      expect(result.searchParams.get("options")).toBe(
        `-c statement_timeout=5000 -c timezone=${zone} -c timezone=UTC`,
      );
    },
  );
});

describe("raw operator timestamp decoding", () => {
  it.each(["Asia/Shanghai", "America/New_York"])(
    "decodes UTC-naive timestamps on a %s host without changing shared parsers",
    (zone) => {
      const previousZone = process.env.TZ;
      const globalParser = types.getTypeParser(
        types.builtins.TIMESTAMP,
        "text",
      ) as (value: string) => Date | number | null;
      try {
        process.env.TZ = zone;
        expect(
          new Date("2026-11-03T02:38:00.123Z").getTimezoneOffset(),
        ).not.toBe(0);
        const ordinary = new Client();
        const operator = new Client();
        configureUtcPgTimestamps(operator);
        const parse = operator.getTypeParser(
          types.builtins.TIMESTAMP,
          "text",
        ) as (value: string) => Date | number | null;
        const baseline = ordinary.getTypeParser(
          types.builtins.TIMESTAMP,
          "text",
        ) as (value: string) => Date;
        const value = "2026-11-03 02:38:00.123";
        expect(baseline(value).toISOString()).not.toBe(
          "2026-11-03T02:38:00.123Z",
        );
        expect(parse(value)).toEqual(new Date("2026-11-03T02:38:00.123Z"));
        expect(parse("0001-01-01 00:00:00 BC")).toEqual(
          new Date("0000-01-01T00:00:00.000Z"),
        );
        expect(parse("infinity")).toBe(Infinity);
        expect(parse("-infinity")).toBe(-Infinity);
        expect(types.getTypeParser(types.builtins.TIMESTAMP, "text")).toBe(
          globalParser,
        );
        expect(ordinary.getTypeParser(types.builtins.TIMESTAMP, "text")).toBe(
          globalParser,
        );
        expect(operator.getTypeParser(types.builtins.TIMESTAMPTZ, "text")).toBe(
          ordinary.getTypeParser(types.builtins.TIMESTAMPTZ, "text"),
        );
        expect(operator.getTypeParser(types.builtins.JSONB, "text")).toBe(
          ordinary.getTypeParser(types.builtins.JSONB, "text"),
        );
      } finally {
        if (previousZone === undefined) delete process.env.TZ;
        else process.env.TZ = previousZone;
      }
    },
  );
});
