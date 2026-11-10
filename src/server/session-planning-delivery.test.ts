import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ParticipantConsolidation, SessionNotice, SessionResponseExecution } from "../../generated/prisma";
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
  const responseExecutions = new Map<string, SessionResponseExecution>();
  const participantExecutions = new Map<string, ParticipantConsolidation>();
  const notice: SessionNotice = {
    id: "notice-1", dedupeKey: "offer-1:response-1", requestId: "request-1", offerId: "offer-1", responseId: "response-1",
    recipientUserId: "user-1", recipientEmail: "recipient@example.test", event: "proposed",
    context: { isActionable: true, stage: "A", startsAt: "2026-11-02T04:00:00.000Z", endsAt: "2026-11-02T04:45:00.000Z", timeZone: "Asia/Shanghai" },
    priority: 100, status: "PENDING", attempts: 0, availableAt: now, leaseUntil: new Date(now.getTime() + 300_000),
    attemptId: null, attemptStartedAt: null, acceptedAt: null, completedAt: null, lastError: null, createdAt: now, updatedAt: now,
  };
  const response = {
    id: "response-1", actorKey: "tutee:tutee-1", actorUserId: "user-1", state: "PENDING", offerId: "offer-1",
    offer: { requestId: "request-1", date: "2026-11-02", cutoffAt: new Date("2026-11-02T04:00:00Z"), request: { status: "PENDING", currentOfferId: "offer-1" } },
  };
  const user = {
    emailLocale: "en",
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
    sessionNotice: { findUnique: vi.fn(async () => ({ ...notice })), update, count: vi.fn(async () => 0) },
    sessionPlanningResponse: { findUnique: vi.fn(async () => response) },
    programCalendarDay: { count: vi.fn(async () => 0) },
    sessionResponseExecution: { findUnique: vi.fn(async ({ where }: { where: { responseId: string } }) => responseExecutions.get(where.responseId) ?? null) },
    participantConsolidation: { findUnique: vi.fn(async ({ where }: { where: { kind_sourceId: { kind: string; sourceId: string } } }) => participantExecutions.get(`${where.kind_sourceId.kind}:${where.kind_sourceId.sourceId}`) ?? null) },
    user: { findUnique: vi.fn(async () => user) },
    tutee: { findUnique: vi.fn(async () => ({ status: "ACTIVE" })) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  return { notice, response, user, update, responseExecutions, participantExecutions, raw: database, database: database as unknown as DomainDb };
}

it.each(["en", "zh"] as const)("composes queued essential notices using the current recipient %s preference without changing acceptance clocks", async (locale) => {
  const f = fixture();
  f.user.emailLocale = locale;
  await deliverSessionNotices(10, f.database);
  expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({
    subject: locale === "en" ? "Reply to a tutoring time proposal" : "请回复辅导时间提议",
    presentation: expect.objectContaining({ locale, action: expect.objectContaining({ label: locale === "en" ? "Respond to proposal" : "回复时间提议" }) as unknown }) as unknown,
  }));
  expect(transport.mark).toHaveBeenCalledWith(f.database, "response-1", now, false);
});

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
  expect(f.notice.context).not.toHaveProperty("requiresExplicitAcceptance");
  expect(transport.mark).toHaveBeenCalledWith(f.database, "response-1", now, false);
});

it("preserves ordinary stored context extensions while rendering only the safe notice copy", async () => {
  const f = fixture();
  f.notice.context = { isActionable: true, stage: "A", scope: "ONE", kind: "RESCHEDULE",
    extension: { synthetic: "UNRENDERED SYNTHETIC FIELD" } };
  const original = structuredClone(f.notice.context);
  await deliverSessionNotices(10, f.database);
  expect(f.notice.context).toEqual(original);
  expect(f.notice.context).not.toHaveProperty("requiresExplicitAcceptance");
  const sent: unknown = transport.send.mock.calls[0]?.[0];
  expect(typeof sent === "object" && sent !== null && "text" in sent ? sent.text : null).not.toContain("UNRENDERED SYNTHETIC FIELD");
});

it("rechecks a pause activated after a notice was queued before composing essential mail", async () => {
  const f = fixture();
  f.raw.programCalendarDay.count.mockResolvedValue(1);
  await deliverSessionNotices(10, f.database);
  expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({
    text: expect.stringContaining("Silence will not accept it") as unknown,
  }));
  const sent: unknown = transport.send.mock.calls[0]?.[0];
  expect(typeof sent === "object" && sent !== null && "text" in sent ? sent.text : null).not.toContain("Silence can mean acceptance");
  expect(f.notice.context).toMatchObject({ requiresExplicitAcceptance: true });
});

it("retains explicit-only SMTP admission guidance when the pause is removed before provider completion", async () => {
  const f = fixture();
  f.raw.programCalendarDay.count.mockResolvedValue(1);
  const admitted = await admitSessionNotice(f.database, f.notice.id, f.notice.leaseUntil!, null);
  expect(admitted?.row.context).toMatchObject({ requiresExplicitAcceptance: true });
  f.raw.programCalendarDay.count.mockResolvedValue(0);
  await finishSessionNotice(f.database, f.notice.id, admitted!.row.attemptId!, now);
  expect(transport.mark).toHaveBeenCalledWith(f.database, f.response.id, now, true);
  await finishSessionNotice(f.database, f.notice.id, admitted!.row.attemptId!, now);
  expect(transport.mark).toHaveBeenCalledTimes(1);
});

it("keeps earlier explicit-only guidance across a failed provider attempt and a retry after pause removal", async () => {
  const f = fixture();
  f.raw.programCalendarDay.count.mockResolvedValue(1);
  const first = await admitSessionNotice(f.database, f.notice.id, f.notice.leaseUntil!, null);
  await finishSessionNotice(f.database, f.notice.id, first!.row.attemptId!, null);
  f.raw.programCalendarDay.count.mockResolvedValue(0);
  f.notice.leaseUntil = new Date(now.getTime() + 300_000);
  const retry = await admitSessionNotice(f.database, f.notice.id, f.notice.leaseUntil, f.notice.attemptId);
  expect(retry?.row.context).toMatchObject({ requiresExplicitAcceptance: true });
  await finishSessionNotice(f.database, f.notice.id, retry!.row.attemptId!, now);
  expect(transport.mark).toHaveBeenCalledWith(f.database, f.response.id, now, true);
});

it("keeps another already-admitted receipt's explicit-only guidance when composing the same offer", async () => {
  const f = fixture();
  f.raw.sessionNotice.count.mockResolvedValue(1);
  const admitted = await admitSessionNotice(f.database, f.notice.id, f.notice.leaseUntil!, null);
  expect(admitted?.row.context).toMatchObject({ requiresExplicitAcceptance: true });
  await finishSessionNotice(f.database, f.notice.id, admitted!.row.attemptId!, now);
  expect(transport.mark).toHaveBeenCalledWith(f.database, f.response.id, now, true);
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
  expect(transport.mark).toHaveBeenCalledWith(f.database, "response-1", now, false);
  expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("%2Fschedule%23sessions") as unknown }));
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
  expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({
    subject: expect.stringContaining("Earlier tutoring update") as unknown,
    text: expect.stringContaining("no longer an actionable offer") as unknown,
    presentation: expect.objectContaining({
      action: expect.objectContaining({ label: "View current schedule" }) as unknown,
    }) as unknown,
  }));
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

it.each([false, true])("preserves actual explicit admission across manual retry without inventing it for a queued notice (attempted: %s)", async (attempted) => {
  const f = fixture();
  f.notice.context = { isActionable: true, requiresExplicitAcceptance: true };
  let oldAttempt: string | null = null;
  if (attempted) {
    f.raw.programCalendarDay.count.mockResolvedValue(1);
    const first = await admitSessionNotice(f.database, f.notice.id, f.notice.leaseUntil!, null);
    oldAttempt = first!.row.attemptId!;
    await finishSessionNotice(f.database, f.notice.id, oldAttempt, null);
  } else {
    // Queued guidance was never admitted to SMTP; it may use the live normal
    // policy after removal, unlike a failed or lost-acknowledgement attempt.
    f.notice.status = "BLOCKED";
    f.notice.leaseUntil = null;
    f.notice.lastError = "transport unavailable before admission";
  }
  f.raw.programCalendarDay.count.mockResolvedValue(0);
  const priorAdmission = f.notice.attemptStartedAt;
  expect(await retrySessionNotice(f.database, f.notice.id, f.user.id)).toEqual({ queued: true, status: "PENDING" });
  expect(f.notice).toMatchObject({ attemptId: null, leaseUntil: null, attemptStartedAt: priorAdmission });
  expect(await retrySessionNotice(f.database, f.notice.id, f.user.id)).toEqual({ queued: false, status: "PENDING" });
  f.notice.leaseUntil = new Date(now.getTime() + 300_000);
  const retry = await admitSessionNotice(f.database, f.notice.id, f.notice.leaseUntil, null);
  if (attempted) expect(retry?.row.context).toMatchObject({ requiresExplicitAcceptance: true });
  else expect(retry?.row.context).not.toHaveProperty("requiresExplicitAcceptance");
  if (oldAttempt) {
    await finishSessionNotice(f.database, f.notice.id, oldAttempt, now);
    expect(f.notice).toMatchObject({ status: "SENDING", attemptId: retry!.row.attemptId });
    expect(transport.mark).not.toHaveBeenCalled();
  }
  await finishSessionNotice(f.database, f.notice.id, retry!.row.attemptId!, now);
  expect(transport.mark).toHaveBeenCalledWith(f.database, f.response.id, now, attempted);
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


it("uses reviewed response execution for delivery while retaining the original actor evidence", async () => {
  const f = fixture();
  f.response.actorUserId = "original-user";
  f.response.actorKey = "tutee:original-profile";
  const original = structuredClone(f.response);
  f.participantExecutions.set("TUTEE:original-profile", { kind: "TUTEE", sourceId: "original-profile", targetId: "tutee-1", active: true, revision: 1, receiptId: "reviewed-transfer", effectiveAt: now });
  f.responseExecutions.set(f.response.id, { responseId: f.response.id, userId: f.user.id, profileKind: "TUTEE", profileId: "tutee-1", respondedByUserId: null, revision: 1, receiptId: "reviewed-transfer" });
  await deliverSessionNotices(10, f.database);
  expect(f.notice).toMatchObject({ status: "SENT", acceptedAt: now });
  expect(f.raw.tutee.findUnique).toHaveBeenCalledWith({ where: { id: "tutee-1" }, select: { status: true } });
  expect(transport.mark).toHaveBeenCalledWith(f.database, f.response.id, now, false);
  expect(f.response).toEqual(original);
});

it("does not qualify an old recipient after response execution moves during SMTP", async () => {
  const f = fixture();
  transport.send.mockImplementation(async () => {
    f.responseExecutions.set(f.response.id, { responseId: f.response.id, userId: "new-reader", profileKind: "TUTEE", profileId: "new-profile", respondedByUserId: null, revision: 1, receiptId: "concurrent-transfer" });
  });
  await deliverSessionNotices(10, f.database);
  expect(f.notice).toMatchObject({ status: "SENT", acceptedAt: now });
  expect(f.response).toMatchObject({ actorUserId: "user-1", actorKey: "tutee:tutee-1" });
  expect(transport.mark).not.toHaveBeenCalled();
});
