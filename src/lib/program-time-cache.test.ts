import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

describe("bounded program time reuse", () => {
  it("constructs the original formatter options once per reused valid zone", async () => {
    const NativeDateTimeFormat = Intl.DateTimeFormat;
    const constructor = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(function (locales, options) {
        return new NativeDateTimeFormat(locales, options);
      });
    const { parseProgramDateTime, programDateTimeInput } =
      await import("./program-time");
    for (let i = 0; i < 20; i++) {
      const parsed = parseProgramDateTime("2026-07-01T09:30", "America/New_York");
      expect(parsed.toISOString()).toBe("2026-07-01T13:30:00.000Z");
      expect(programDateTimeInput(parsed, "America/New_York")).toBe(
        "2026-07-01T09:30",
      );
    }
    expect(constructor).toHaveBeenCalledTimes(2);
    expect(constructor).toHaveBeenNthCalledWith(1, "en", {
      timeZone: "America/New_York",
    });
    expect(constructor).toHaveBeenNthCalledWith(2, "en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  });

  it("bounds both successful zone caches and evicts the least recently used zone", async () => {
    const NativeDateTimeFormat = Intl.DateTimeFormat;
    const constructor = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(function (locales, options) {
        return new NativeDateTimeFormat(locales, options);
      });
    const { isProgramTimeZone, programDateTimeInput } =
      await import("./program-time");
    const zones = Intl.supportedValuesOf("timeZone").slice(0, 65);
    expect(zones).toHaveLength(65);
    const visit = (zone: string) => {
      expect(isProgramTimeZone(zone)).toBe(true);
      return programDateTimeInput(new Date("2026-01-01T00:00:00Z"), zone);
    };
    for (const zone of zones.slice(0, 64)) visit(zone);
    expect(constructor).toHaveBeenCalledTimes(128);
    const first = visit(zones[0]!);
    visit(zones[64]!);
    expect(constructor).toHaveBeenCalledTimes(130);
    expect(visit(zones[0]!)).toBe(first);
    expect(constructor).toHaveBeenCalledTimes(130);
    visit(zones[1]!);
    expect(constructor).toHaveBeenCalledTimes(132);
  });

  it("never retains invalid zones and still rejects invalid dates with a warm formatter", async () => {
    const NativeDateTimeFormat = Intl.DateTimeFormat;
    const constructor = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(function (locales, options) {
        return new NativeDateTimeFormat(locales, options);
      });
    const { isProgramTimeZone, programDateTimeInput } =
      await import("./program-time");
    for (let i = 0; i < 2; i++)
      expect(isProgramTimeZone("Earth/Nowhere")).toBe(false);
    expect(constructor).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 2; i++) {
      expect(() => programDateTimeInput(new Date(), "Earth/Nowhere")).toThrow(
        RangeError,
      );
    }
    expect(constructor).toHaveBeenCalledTimes(4);
    programDateTimeInput(new Date("2026-01-01T00:00:00Z"), "UTC");
    expect(() => programDateTimeInput(new Date(NaN), "UTC")).toThrow(RangeError);
    expect(constructor).toHaveBeenCalledTimes(5);
  });
});

describe("operation-scoped program date parser", () => {
  it("memoizes successful inputs only in their explicit operation and returns fresh Dates", async () => {
    const { createProgramDateTimeParser, parseProgramDateTime } =
      await import("./program-time");
    const format = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    const parse = createProgramDateTimeParser();
    const first = parse("2026-01-01T09:30", "Asia/Kolkata");
    const calls = format.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    first.setUTCFullYear(1990);
    const second = parse("2026-01-01T09:30", "Asia/Kolkata");
    expect(second).not.toBe(first);
    expect(second.toISOString()).toBe("2026-01-01T04:00:00.000Z");
    expect(format).toHaveBeenCalledTimes(calls);
    second.setTime(0);
    expect(parse("2026-01-01T09:30", "Asia/Kolkata").toISOString()).toBe(
      "2026-01-01T04:00:00.000Z",
    );
    expect(format).toHaveBeenCalledTimes(calls);
    createProgramDateTimeParser()("2026-01-01T09:30", "Asia/Kolkata");
    expect(format.mock.calls.length).toBeGreaterThan(calls);
    const beforeUnscoped = format.mock.calls.length;
    parseProgramDateTime("2026-01-01T09:30", "Asia/Kolkata");
    expect(format.mock.calls.length).toBeGreaterThan(beforeUnscoped);
  });

  it("keeps zones distinct and preserves fractional and seasonal offsets", async () => {
    const { createProgramDateTimeParser } = await import("./program-time");
    const parse = createProgramDateTimeParser();
    for (let i = 0; i < 2; i++) {
      expect(parse("2026-01-01T09:30", "UTC").toISOString()).toBe(
        "2026-01-01T09:30:00.000Z",
      );
      expect(parse("2026-01-01T09:30", "Asia/Kolkata").toISOString()).toBe(
        "2026-01-01T04:00:00.000Z",
      );
      expect(parse("2026-01-01T09:30", "America/New_York").toISOString()).toBe(
        "2026-01-01T14:30:00.000Z",
      );
      expect(parse("2026-07-01T09:30", "America/New_York").toISOString()).toBe(
        "2026-07-01T13:30:00.000Z",
      );
      expect(parse("2026-01-01T09:30").toISOString()).toBe(
        "2026-01-01T01:30:00.000Z",
      );
    }
  });

  it("preserves parser errors and never memoizes DST failures", async () => {
    const { createProgramDateTimeParser, parseProgramDateTime } =
      await import("./program-time");
    const parse = createProgramDateTimeParser();
    const format = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    const errorMessage = (work: () => Date) => {
      try {
        work();
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error("Expected parsing to fail.");
    };
    for (const [value, zone] of [
      ["2026-03-08T02:30", "America/New_York"],
      ["2026-11-01T01:30", "America/New_York"],
      ["2026-02-30T12:30", "UTC"],
      ["2026-02-01T25:30", "UTC"],
      ["not-a-date", "UTC"],
      ["2026-01-01T09:30", "Earth/Nowhere"],
    ] as const) {
      const expected = errorMessage(() => parseProgramDateTime(value, zone));
      expect(errorMessage(() => parse(value, zone))).toBe(expected);
      expect(errorMessage(() => parse(value, zone))).toBe(expected);
    }
    const before = format.mock.calls.length;
    expect(() => parse("2026-03-08T02:30", "America/New_York")).toThrow(
      "does not exist",
    );
    expect(format.mock.calls.length).toBeGreaterThan(before);
    expect(parse("2026-03-08T03:30", "America/New_York").toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });

  it("bounds successful inputs while retaining the most recently reused conversion", async () => {
    const { createProgramDateTimeParser } = await import("./program-time");
    const parse = createProgramDateTimeParser();
    const format = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    const value = (minute: number) =>
      new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString().slice(0, 16);
    for (let i = 0; i < 1024; i++) parse(value(i), "UTC");
    const warmCalls = format.mock.calls.length;
    parse(value(0), "UTC");
    expect(format).toHaveBeenCalledTimes(warmCalls);
    parse(value(1024), "UTC");
    const afterInsertion = format.mock.calls.length;
    expect(afterInsertion).toBeGreaterThan(warmCalls);
    parse(value(0), "UTC");
    expect(format).toHaveBeenCalledTimes(afterInsertion);
    parse(value(1), "UTC");
    expect(format.mock.calls.length).toBeGreaterThan(afterInsertion);
  });
});
