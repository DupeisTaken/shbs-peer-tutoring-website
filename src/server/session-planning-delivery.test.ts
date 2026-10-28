import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionNotice } from "../../generated/prisma";
import type { DomainDb } from "./transactions";

const transport = vi.hoisted(() => ({ send: vi.fn(), configured: vi.fn(), mark: vi.fn(), lock: vi.fn(), sweep: vi.fn(), owned: vi.fn() }));
vi.mock("~/server/email/sender", () => ({ emailSender: { send: transport.send }, isEmailConfigured: transport.configured }));
vi.mock("~/server/session-planning", () => ({ ensureSessionPlanningWindow: vi.fn(), lockSessionPlanning: transport.lock, markSessionResponseDelivered: transport.mark, sweepSessionPlanning: transport.sweep }));
vi.mock("~/server/student-ownership", () => ({ ownedStudentIds: transport.owned }));
import { admitSessionNotice, deliverSessionNotices, finishSessionNotice, retrySessionNotice } from "./session-planning-delivery";

const now = new Date("2026-10-29T04:00:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("AUTH_URL", "https://school.example.test");
  transport.configured.mockReturnValue(true);
  transport.send.mockResolvedValue(undefined);
  transport.owned.mockResolvedValue(["tutee-1"]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

function fixture() {
  const notice: SessionNotice = {
    id: "notice-1", dedupeKey: "offer-1:response-1", requestId: "request-1", offerId: "offer-1", responseId: "response-1",
    recipientUserId: "user-1", recipientEmail: "recipient@example.test", event: "proposed",
    context: { isActionable: true, stage: "A", startsAt: "2026-11-02T04:00:00.000Z", endsAt: "2026-11-02T04:45:00.000Z", timeZone: "Asia/Shanghai" },
    priority: 100, status: "PENDING", attempts: 0, availableAt: now, leaseUntil: new Date(now.getTime() + 300_000),
    attemptId: null, attemptStartedAt: null, acceptedAt: null, completedAt: null, lastError: null, createdAt: now, updatedAt: now,
  };
  const response = {
    id: "response-1", actorKey: "tutee:tutee-1", actorUserId: "user-1", state: "PENDING", offerId: "offer-1",
    offer: { requestId: "request-1", cutoffAt: new Date("2026-11-02T04:00:00Z"), request: { status: "PENDING", currentOfferId: "offer-1" } },
  };
  const user = {
    id: "user-1", email: notice.recipientEmail, role: "STUDENT", tuteeMember: true,
    tutorId: null as string | null, tutor: null as { status: string } | null,
    tutorAccessRevoked: false, suspendedAt: null, mergedIntoId: null, schoolDeparture: null,
    // Essential delivery must ignore all of these optional settings.
    emailInfo: false, emailSecondaryRecipients: false,
    emails: [{ email: notice.recipientEmail, verifiedAt: now }],
  };
  type Update = Omit<Partial<SessionNotice>, "attempts"> & { attempts?: number | { increment: number } };
  const update = vi.fn(async ({ data }: { data: Update }) => {
    const { attempts, ...rest } = data;
    Object.assign(notice, rest);
    if (typeof attempts === "number") notice.attempts = attempts;
    else if (attempts) notice.attempts += attempts.increment;
    return { ...notice };
  });
  const database = {
    $queryRaw: vi.fn(async () => [{ id: notice.id, leaseUntil: notice.leaseUntil, attemptId: notice.attemptId }]),
    sessionNotice: { findUnique: vi.fn(async () => ({ ...notice })), update },
    sessionPlanningResponse: { findUnique: vi.fn(async () => response) },
    user: { findUnique: vi.fn(async () => user) },
    tutee: { findUnique: vi.fn(async () => ({ status: "ACTIVE" })) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  return { notice, response, user, update, raw: database, database: database as unknown as DomainDb };
}

it("records SMTP acceptance before qualifying a responder, despite optional mail being off", async () => {
  const f = fixture();
  transport.send.mockImplementation(async () => {
    expect(f.notice.status).toBe("SENDING");
    expect(transport.mark).not.toHaveBeenCalled();
  });
  await deliverSessionNotices(10, f.database);
  expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({
    category: "PROGRAM", messageId: "<session-notice-notice-1@shbs-notifications>",
  }));
  expect(f.notice).toMatchObject({ status: "SENT", attempts: 1, acceptedAt: now });
  expect(transport.mark).toHaveBeenCalledWith(f.database, "response-1", now);
});

it("queued, unconfigured and failed mail cannot start a response clock", async () => {
  const f = fixture();
  transport.configured.mockReturnValue(false);
  await deliverSessionNotices(10, f.database);
  expect(f.notice).toMatchObject({ status: "PENDING", attempts: 0, acceptedAt: null });
  expect(f.notice.lastError).toContain("unavailable");
  expect(transport.send).not.toHaveBeenCalled();
  expect(transport.mark).not.toHaveBeenCalled();
  transport.configured.mockReturnValue(true);
  f.notice.leaseUntil = new Date(now.getTime() + 300_000);
  transport.send.mockRejectedValue(new Error("PRIVATE SMTP credential sentinel"));
  await deliverSessionNotices(10, f.database);
  expect(f.notice).toMatchObject({ status: "PENDING", attempts: 1, acceptedAt: null });
  expect(f.notice.lastError).not.toContain("PRIVATE");
  expect(transport.mark).not.toHaveBeenCalled();
});

it("fences stale leases and attempt completions from a newer delivery attempt", async () => {
  const f = fixture();
  expect(await admitSessionNotice(f.database, f.notice.id, new Date(now.getTime() + 1), null)).toBeNull();
  expect(await admitSessionNotice(f.database, f.notice.id, f.notice.leaseUntil!, "old-attempt")).toBeNull();
  const admitted = await admitSessionNotice(f.database, f.notice.id, f.notice.leaseUntil!, null);
  expect(admitted?.row.attemptId).toBeTruthy();
  await finishSessionNotice(f.database, f.notice.id, "old-attempt", now);
  expect(f.notice.status).toBe("SENDING");
  expect(transport.mark).not.toHaveBeenCalled();
});

it("keeps superseded transition email historical and never qualifies an obsolete offer", async () => {
  const f = fixture();
  f.response.offer.request.currentOfferId = "new-offer";
  await deliverSessionNotices(10, f.database);
  expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("no longer an actionable offer") as unknown }));
  expect(f.notice.status).toBe("SENT");
  expect(transport.mark).not.toHaveBeenCalled();
});

it("treats a passed short-notice cutoff as historical even if a deadline sweep was unavailable", async () => {
  const f = fixture();
  f.response.offer.cutoffAt = now;
  await deliverSessionNotices(10, f.database);
  expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("no longer an actionable offer") as unknown }));
  expect(transport.mark).not.toHaveBeenCalled();
});

it("qualifies the tutor's B response only through that tutor's delivery receipt", async () => {
  const f = fixture();
  f.response.actorKey = "tutor:tutor-1";
  f.user.tutorId = "tutor-1";
  f.user.tutor = { status: "ACTIVE" };
  f.user.role = "TUTOR";
  f.notice.context = { isActionable: true, stage: "B" };
  await deliverSessionNotices(10, f.database);
  expect(transport.mark).toHaveBeenCalledWith(f.database, "response-1", now);
  expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("%2Fdashboard%23sessions") as unknown }));
  expect(transport.owned).not.toHaveBeenCalled();
});

it("preserves acceptance evidence when a response changes while SMTP is in flight", async () => {
  const f = fixture();
  transport.send.mockImplementation(async () => { f.response.state = "ACCEPTED"; });
  await deliverSessionNotices(10, f.database);
  expect(f.notice).toMatchObject({ status: "SENT", acceptedAt: now });
  expect(transport.mark).not.toHaveBeenCalled();
});

it("never qualifies a cancelled proposal, before admission or during an admitted send", async () => {
  const before = fixture();
  before.response.offer.request.status = "CANCELLED";
  await deliverSessionNotices(10, before.database);
  expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringContaining("Earlier update") as unknown }));
  expect(transport.mark).not.toHaveBeenCalled();
  transport.send.mockClear();
  const during = fixture();
  transport.send.mockImplementation(async () => { during.response.offer.request.status = "CANCELLED"; });
  await deliverSessionNotices(10, during.database);
  expect(during.notice).toMatchObject({ status: "SENT", acceptedAt: now });
  expect(transport.mark).not.toHaveBeenCalled();
});

it("blocks removed address ownership and revoked respondent access", async () => {
  const f = fixture();
  f.user.emails = [];
  await deliverSessionNotices(10, f.database);
  expect(f.notice.status).toBe("BLOCKED");
  expect(transport.send).not.toHaveBeenCalled();
  const other = fixture();
  transport.owned.mockResolvedValue([]);
  await deliverSessionNotices(10, other.database);
  expect(other.notice.status).toBe("BLOCKED");
  expect(transport.mark).not.toHaveBeenCalled();
});

it("bounds retry exhaustion and uses priority order in a bounded claim", async () => {
  const f = fixture();
  f.notice.attempts = 4;
  transport.send.mockRejectedValue(new Error("transport unavailable"));
  await deliverSessionNotices(999, f.database);
  expect(f.notice).toMatchObject({ status: "FAILED", attempts: 5 });
  expect(f.raw.$queryRaw.mock.calls[0]).toContain(50);
  expect(String(f.raw.$queryRaw.mock.calls[0])).toContain("ORDER BY priority DESC");
  expect(transport.mark).not.toHaveBeenCalled();
});

it("retries a failed receipt once without replaying a schedule or resetting accepted evidence", async () => {
  const f = fixture();
  f.notice.status = "FAILED";
  f.notice.leaseUntil = null;
  f.notice.attempts = 5;
  f.notice.lastError = "previous failure";
  expect(await retrySessionNotice(f.database, f.notice.id, f.user.id)).toEqual({ queued: true, status: "PENDING" });
  expect(f.notice).toMatchObject({ id: "notice-1", attempts: 0, acceptedAt: null, responseId: "response-1" });
  expect(await retrySessionNotice(f.database, f.notice.id, f.user.id)).toEqual({ queued: false, status: "PENDING" });
  f.notice.status = "SENT";
  f.notice.acceptedAt = now;
  expect(await retrySessionNotice(f.database, f.notice.id, f.user.id)).toEqual({ queued: false, status: "SENT" });
  expect(f.notice.acceptedAt).toEqual(now);
  expect(transport.mark).not.toHaveBeenCalled();
  expect(transport.send).not.toHaveBeenCalled();
});

it("retains visible retry blockers and prevents another participant from retrying", async () => {
  const f = fixture();
  f.notice.status = "BLOCKED";
  f.notice.leaseUntil = null;
  f.user.emails = [];
  expect(await retrySessionNotice(f.database, f.notice.id, f.user.id)).toEqual({ queued: false, status: "BLOCKED" });
  f.user.emails = [{ email: f.user.email, verifiedAt: now }];
  transport.configured.mockReturnValue(false);
  expect(await retrySessionNotice(f.database, f.notice.id, f.user.id)).toEqual({ queued: false, status: "BLOCKED" });
  expect(f.notice.lastError).toContain("unavailable");
  f.raw.user.findUnique.mockResolvedValue({ ...f.user, id: "other-participant" });
  await expect(retrySessionNotice(f.database, f.notice.id, "other-participant")).rejects.toMatchObject({ code: "FORBIDDEN" });
});
