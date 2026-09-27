import { describe, expect, it } from "vitest";
import { utcDatabaseUrl } from "./database-url";

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
