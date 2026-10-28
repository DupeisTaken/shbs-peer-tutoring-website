import { expect, it } from "vitest";
import { renderSessionCalendar, type SessionCalendarEvent } from "./session-calendar";

const event = (overrides: Partial<SessionCalendarEvent> = {}): SessionCalendarEvent => ({
  uid: "commitment-opaque@shbs-session",
  revision: 1,
  startsAt: new Date("2026-11-02T04:00:00Z"),
  endsAt: new Date("2026-11-02T04:45:00Z"),
  updatedAt: new Date("2026-10-29T03:00:00Z"),
  cancelled: false,
  ...overrides,
});

it("moves one commitment with the same UID and newer sequence, preserving peers", () => {
  const peer = event({ uid: "peer@shbs-session" });
  const before = renderSessionCalendar([event(), peer]);
  const after = renderSessionCalendar([event({
    startsAt: new Date("2026-11-03T05:00:00Z"),
    endsAt: new Date("2026-11-03T05:45:00Z"), revision: 2,
  }), peer]);
  expect(before).toContain("UID:commitment-opaque@shbs-session\r\n");
  expect(after).toContain("UID:commitment-opaque@shbs-session\r\nSEQUENCE:2");
  expect(after.match(/DTSTART:20261102T040000Z/g)).toHaveLength(1);
  expect(after).toContain("DTSTART:20261103T050000Z");
});

it("publishes a cancellation tombstone without cancelling another event", () => {
  const calendar = renderSessionCalendar([event({ cancelled: true, revision: 3 }), event({ uid: "peer@shbs-session" })]);
  expect(calendar.match(/STATUS:CANCELLED/g)).toHaveLength(1);
  expect(calendar.match(/STATUS:CONFIRMED/g)).toHaveLength(1);
  expect(calendar).toContain("SEQUENCE:3");
  expect(calendar).not.toContain("METHOD:CANCEL");
});

it("escapes injection and folds multilingual values at 75 UTF-8 octets", () => {
  const calendar = renderSessionCalendar([event({ location: `楼${"中".repeat(80)}\\;room,1\r\nATTENDEE:private@example.test` })]);
  for (const line of calendar.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  const unfolded = calendar.replace(/\r\n /g, "");
  expect(unfolded).toContain("\\\\\\;room\\,1\\nATTENDEE:");
  expect(calendar).not.toMatch(/\r\nATTENDEE:/);
  expect(calendar).not.toContain("�");
  expect(calendar).toContain("CLASS:PRIVATE");
});

it("rejects duplicate identities, invalid dates and backwards intervals", () => {
  expect(() => renderSessionCalendar([event(), event()])).toThrow();
  expect(() => renderSessionCalendar([event({ updatedAt: new Date("invalid") })])).toThrow();
  expect(() => renderSessionCalendar([event({ endsAt: new Date("2026-11-02T03:00:00Z") })])).toThrow();
});
