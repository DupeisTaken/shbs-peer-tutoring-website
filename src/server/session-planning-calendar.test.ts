import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DomainDb } from "./transactions";

const ownership = vi.hoisted(() => ({ ids: vi.fn() }));
vi.mock("~/server/student-ownership", () => ({ ownedStudentIds: ownership.ids }));
import { revokeSessionCalendarTokens, rotateSessionCalendarToken, sessionCalendarFeed, sessionCalendarStatus } from "./session-planning-calendar";

const now = new Date("2026-10-29T04:00:00Z");
const token = "S".repeat(43);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_URL", "https://school.example.test");
  ownership.ids.mockResolvedValue(["owned-student"]);
});
afterEach(() => vi.unstubAllEnvs());

function fixture(tutor = false) {
  const user = {
    id: "user-1", role: tutor ? "TUTOR" : "STUDENT", tutorId: tutor ? "owned-tutor" : null,
    tutor: tutor ? { status: "ACTIVE" } : null, tutorAccessRevoked: false,
    tuteeMember: !tutor, suspendedAt: null as Date | null, mergedIntoId: null as string | null, schoolDeparture: null,
  };
  type Token = { id: string; userId: string; tokenHash: string; revokedAt: Date | null; createdAt: Date };
  const tokens: Token[] = [{ id: "token-1", userId: user.id, tokenHash: digest(token), revokedAt: null, createdAt: now }];
  const cohort = {
    id: "cohort-1", roomId: "room-1", online: false, status: "SCHEDULED", version: 1,
    startsAt: new Date("2026-11-02T04:00:00Z"), endsAt: new Date("2026-11-02T04:45:00Z"), updatedAt: now,
  };
  const participant = { id: "participant-1", tuteeId: "owned-student", status: "SCHEDULED", version: 1, updatedAt: now, cohort };
  const database = {
    $executeRaw: vi.fn(async () => 1),
    user: { findUnique: vi.fn(async () => user) },
    tutee: { findMany: vi.fn(async () => [{ id: "owned-student" }]) },
    auditLog: { create: vi.fn(async () => ({})) },
    sessionCalendarToken: {
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => tokens.find(item => item.tokenHash === where.tokenHash) ?? null),
      findFirst: vi.fn(async () => tokens.find(item => !item.revokedAt) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: { userId: string }; data: { revokedAt: Date } }) => {
        const matches = tokens.filter(item => item.userId === where.userId && !item.revokedAt);
        for (const item of matches) item.revokedAt = data.revokedAt;
        return { count: matches.length };
      }),
      create: vi.fn(async ({ data }: { data: { userId: string; tokenHash: string } }) => {
        const created = { ...data, id: `token-${tokens.length + 1}`, createdAt: now, revokedAt: null };
        tokens.push(created);
        return created;
      }),
    },
    sessionPlanCohort: { findMany: vi.fn(async () => [cohort]) },
    sessionPlanParticipant: { findMany: vi.fn(async () => [participant]) },
    room: { findMany: vi.fn(async () => [{ id: "room-1", name: "Room 101" }]) },
  };
  return { user, tokens, cohort, participant, raw: database, database: database as unknown as DomainDb };
}

it("stores only a token digest, rotates the previous URL and exposes no recoverable secret in status/audit", async () => {
  const f = fixture();
  const result = await rotateSessionCalendarToken(f.database, f.user.id);
  const plaintext = result.url.split("/").at(-1)!;
  expect(plaintext).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(f.tokens[0]?.revokedAt).toBeInstanceOf(Date);
  expect(f.tokens[1]?.tokenHash).toBe(digest(plaintext));
  expect(f.tokens[1]?.tokenHash).not.toBe(plaintext);
  expect(JSON.stringify(f.raw.auditLog.create.mock.calls)).not.toContain(plaintext);
  expect(await sessionCalendarFeed(f.database, token, now)).toBeNull();
  expect(await sessionCalendarFeed(f.database, plaintext, now)).toContain("BEGIN:VCALENDAR");
  expect(await sessionCalendarStatus(f.database, f.user.id)).toEqual({ active: true, createdAt: now, available: true });
});

it("revokes all subscriptions and denies valid tokens after live access/ownership loss", async () => {
  const f = fixture();
  expect(await sessionCalendarFeed(f.database, token, now)).toContain("UID:commitment-participant-1@");
  f.user.suspendedAt = now;
  expect(await sessionCalendarFeed(f.database, token, now)).toBeNull();
  f.user.suspendedAt = null;
  ownership.ids.mockResolvedValue([]);
  expect(await sessionCalendarFeed(f.database, token, now)).toBeNull();
  ownership.ids.mockResolvedValue(["owned-student"]);
  expect(await revokeSessionCalendarTokens(f.database, f.user.id)).toEqual({ revoked: 1 });
  expect(await sessionCalendarFeed(f.database, token, now)).toBeNull();
  expect(await sessionCalendarFeed(f.database, "malformed", now)).toBeNull();
});

it("uses ownership-scoped commitment UIDs and preserves identity when moved or cancelled", async () => {
  const f = fixture();
  const before = await sessionCalendarFeed(f.database, token, now);
  expect(f.raw.sessionPlanParticipant.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ tuteeId: { in: ["owned-student"] } }) as unknown,
  }));
  expect(before).not.toContain("owned-student");
  expect(before).not.toContain("ATTENDEE");
  f.cohort.startsAt = new Date("2026-11-03T04:00:00Z");
  f.cohort.endsAt = new Date("2026-11-03T04:45:00Z");
  f.participant.version++;
  const moved = await sessionCalendarFeed(f.database, token, now);
  expect(moved).toContain("UID:commitment-participant-1@shbs-session\r\nSEQUENCE:2");
  expect(moved).not.toContain("DTSTART:20261102");
  f.participant.status = "CANCELLED";
  f.participant.version++;
  const cancelled = await sessionCalendarFeed(f.database, token, now);
  expect(cancelled).toContain("UID:commitment-participant-1@shbs-session\r\nSEQUENCE:3");
  expect(cancelled).toContain("STATUS:CANCELLED");
});

it("exports separate stable tutor cohort identities and no peer roster data", async () => {
  const f = fixture(true);
  const calendar = await sessionCalendarFeed(f.database, token, now);
  expect(f.raw.sessionPlanCohort.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ plan: { tutorId: "owned-tutor" } }) as unknown,
  }));
  expect(calendar).toContain("UID:cohort-cohort-1@shbs-session");
  expect(calendar).not.toContain("commitment-participant");
  expect(f.raw.sessionPlanParticipant.findMany).not.toHaveBeenCalled();
  expect(calendar).toContain("LOCATION:Room 101");
  expect(calendar).not.toContain("owned-tutor");
});

it("keeps original tutor identity for remaining students when another confirmed cohort splits off", async () => {
  const f = fixture(true);
  const moved = { ...f.cohort, id: "cohort-split", startsAt: new Date("2026-11-03T05:00:00Z"), endsAt: new Date("2026-11-03T05:45:00Z") };
  f.raw.sessionPlanCohort.findMany.mockResolvedValue([f.cohort, moved]);
  const calendar = await sessionCalendarFeed(f.database, token, now);
  expect(calendar?.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  expect(calendar).toContain("UID:cohort-cohort-1@shbs-session");
  expect(calendar).toContain("UID:cohort-cohort-split@shbs-session");
  expect(calendar).toContain("DTSTART:20261102T040000Z");
  expect(calendar).toContain("DTSTART:20261103T050000Z");
});

it("retains a recorded lesson as a confirmed calendar event after attendance", async () => {
  const f = fixture();
  f.cohort.status = "RECORDED";
  const calendar = await sessionCalendarFeed(f.database, token, now);
  expect(calendar).toContain("UID:commitment-participant-1@shbs-session");
  expect(calendar).toContain("STATUS:CONFIRMED");
});

it("excludes pending extra cohorts from the feed instead of presenting proposed times as confirmed", async () => {
  const f = fixture();
  f.cohort.status = "PENDING";
  expect(await sessionCalendarFeed(f.database, token, now)).not.toContain("BEGIN:VEVENT");
});
