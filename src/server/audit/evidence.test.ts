import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../generated/prisma";
import { databaseScope, deferUntilCommit, scopedDatabase } from "~/server/db-scope";
import { inTransaction } from "~/server/transactions";
import { runAuditedMutation, safeAuditSnapshot } from "./evidence";

const actor = { id: "head", name: "Head", role: "HEAD" };
type State = { status: string; reviewNote: string | null; attempts: number; consumedAt: Date | null; audits: Array<Record<string, unknown>> };

/** A rollback-capable double, rather than a no-op transaction mock, proves the
 * evidence failure cannot leave a committed domain change behind. */
function fixture(failAudit = false) {
  const state: State = { status: "ACTIVE", reviewNote: null, attempts: 0, consumedAt: null, audits: [] };
  let transactions = 0;
  const client = (current: State) => ({
    tutee: {
      findUnique: vi.fn(async () => ({ id: "student", status: current.status, passwordHash: "NEVER_STORE" })),
      findMany: vi.fn(async () => [{ id: "student", status: current.status }]),
      update: vi.fn(async (input: { data: { status: string } }) => {
        current.status = input.data.status;
        return { id: "student", status: current.status };
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (failAudit && data.kind !== "ATTEMPT") throw new Error("Private provider failure");
      current.audits.push(data); return { id: "audit", ...data };
    }) },
    emailVerificationCode: {
      findMany: async () => [{ id: "proof", attempts: current.attempts, consumedAt: current.consumedAt }],
      updateMany: async ({ data }: { data: { attempts?: { increment: number }; consumedAt?: Date } }) => {
        if (data.attempts) current.attempts += data.attempts.increment;
        if (data.consumedAt) current.consumedAt = data.consumedAt;
        return { count: 1 };
      },
    },
    sessionTutee: { createMany: async ({ data }: { data: unknown[] }) => ({ count: data.length }) },
    disciplinaryCard: {
      findUnique: async () => ({ id: "card", reason: "Repeated missed sessions", reviewNote: current.reviewNote }),
      update: async ({ data }: { data: { reviewNote: string } }) => {
        current.reviewNote = data.reviewNote;
        return { id: "card" }; // Evidence must reread even a partial return projection.
      },
    },
  });
  const base = { ...client(state), $transaction: async (work: (tx: PrismaClient) => Promise<unknown>) => {
    transactions++;
    const draft: State = structuredClone(state);
    const value = await work(client(draft) as unknown as PrismaClient);
    Object.assign(state, draft);
    return value;
  } } as unknown as PrismaClient;
  return { state, base, shared: scopedDatabase(base), transactions: () => transactions };
}

describe("transactional mutation evidence", () => {
  it("rolls back domain writes when evidence cannot be persisted", async () => {
    const f = fixture(true);
    await expect(runAuditedMutation(f.shared, actor, "admin.reviewCard", async tx => {
      await tx.tutee.update({ where: { id: "student" }, data: { status: "INACTIVE" } });
      return { ok: true };
    })).rejects.toThrow("Private provider failure");
    expect(f.state.status).toBe("ACTIVE");
    expect(f.state.audits).toMatchObject([{ kind: "ATTEMPT", details: { outcome: "FAILED", applied: false } }]);
    expect(JSON.stringify(f.state.audits)).not.toContain("Private provider failure");
  });

  it("captures safe before/after from imported shared db and composes helper transactions", async () => {
    const f = fixture();
    await runAuditedMutation(f.shared, actor, "admin.setTuteeStatus", async () => {
      await inTransaction(f.shared, async tx => {
        await tx.tutee.update({ where: { id: "student" }, data: { status: "INACTIVE" } });
      });
      return { ok: true };
    });
    expect(f.transactions()).toBe(1);
    expect(f.state.status).toBe("INACTIVE");
    expect(f.state.audits).toMatchObject([{ details: { actorRole: "HEAD", outcome: "APPLIED", changes: [
      { entity: "Tutee", before: [{ status: "ACTIVE" }], after: [{ status: "INACTIVE" }], affectedCount: 1 },
    ] } }]);
    expect(JSON.stringify(f.state.audits)).not.toContain("NEVER_STORE");
  });

  it("preserves failed resolver responses while rollback and denied evidence remain independent", async () => {
    const f = fixture();
    const error = { code: "FORBIDDEN", message: "PRIVATE_INPUT" };
    const result = await runAuditedMutation(f.shared, actor, "admin.setTuteeStatus", async tx => {
      await tx.tutee.update({ where: { id: "student" }, data: { status: "INACTIVE" } });
      return { ok: false, error };
    });
    expect(result).toEqual({ ok: false, error });
    expect(f.state.status).toBe("ACTIVE");
    expect(f.state.audits).toMatchObject([{ details: { outcome: "DENIED", errorCode: "FORBIDDEN", applied: false } }]);
    expect(JSON.stringify(f.state.audits)).not.toContain("PRIVATE_INPUT");
  });

  it("discards queued external effects on rollback and runs effects only after success commits", async () => {
    const failed = fixture(true);
    const delivery = vi.fn(async () => undefined);
    await expect(runAuditedMutation(failed.shared, actor, "admin.setTuteeStatus", async tx => {
      await tx.tutee.update({ where: { id: "student" }, data: { status: "INACTIVE" } });
      expect(deferUntilCommit(delivery)).toBe(true);
      return { ok: true };
    })).rejects.toThrow();
    expect(delivery).not.toHaveBeenCalled();
    const passed = fixture();
    await runAuditedMutation(passed.shared, actor, "admin.setTuteeStatus", async tx => {
      await tx.tutee.update({ where: { id: "student" }, data: { status: "INACTIVE" } });
      deferUntilCommit(async () => {
        expect(passed.state.status).toBe("INACTIVE");
        expect(databaseScope.getStore()).toBeUndefined();
        await delivery();
      });
      return { ok: true };
    });
    expect(delivery).toHaveBeenCalledOnce();
  });

  it("keeps compound unique selectors on findUnique", async () => {
    const f = fixture();
    const unique = vi.fn(async () => ({ status: f.state.status }));
    const many = vi.fn(async () => { throw new Error("Compound selectors must not use findMany"); });
    (f.base as unknown as { $transaction: unknown }).$transaction = async (work: (tx: unknown) => Promise<unknown>) => work({
      tutorQualification: { findUnique: unique, findMany: many, update: async () => ({ status: "APPROVED" }) },
      auditLog: { create: async () => ({}) },
    });
    await runAuditedMutation(f.shared, actor, "admin.setQualification", async tx => {
      await tx.tutorQualification.update({ where: { tutorId_subjectId: { tutorId: "t", subjectId: "s" } }, data: {} });
      return { ok: true };
    });
    expect(unique).toHaveBeenCalledTimes(2); expect(many).not.toHaveBeenCalled();
  });

  it("retains every safe before/after record and submitted relationship in bulk writes exceeding fifty rows", async () => {
    const f = fixture();
    const records = Array.from({ length: 75 }, (_, index) => ({ id: `subject-${index}`, name: `Subject ${index}`, active: true }));
    const expectedBefore = records.map(row => ({ ...row }));
    const expectedAfter = records.map(row => ({ ...row, active: false }));
    const finder = vi.fn(async (args: { where: { active?: boolean; id?: { in: string[] } }; take?: number }) =>
      records.filter(row => args.where.id ? args.where.id.in.includes(row.id) : args.where.active === undefined || row.active === args.where.active)
        .slice(0, args.take).map(row => ({ ...row, body: "PRIVATE_CATALOGUE_TEXT" })),
    );
    (f.base as unknown as { $transaction: unknown }).$transaction = async (work: (tx: unknown) => Promise<unknown>) => work({
      subject: { findMany: finder, updateMany: async () => {
        for (const row of records) row.active = false;
        return { count: records.length };
      }, deleteMany: async () => {
        const count = records.length;
        records.length = 0;
        return { count };
      } },
      sessionTutee: { createMany: async ({ data }: { data: unknown[] }) => ({ count: data.length }) },
      auditLog: f.base.auditLog,
    });
    const relationships = records.map(row => ({ sessionId: "session", tuteeId: row.id, status: "PRESENT" as const,
      absenceReason: "PRIVATE_ABSENCE_REASON" }));
    await runAuditedMutation(f.shared, actor, "admin.updateSubjects", async tx => {
      // Omitted where intentionally means every catalogue row, as in refresh flows.
      await tx.subject.updateMany({ data: { active: false } });
      await tx.sessionTutee.createMany({ data: relationships });
      await tx.subject.deleteMany();
      return { ok: true };
    });
    expect(f.state.audits).toMatchObject([{ details: { changes: [
      { entity: "Subject", affectedCount: 75,
        before: expectedBefore, after: expectedAfter },
      { entity: "SessionTutee", affectedCount: 75,
        submittedSafeFields: relationships.map(({ sessionId, tuteeId, status }) => ({ sessionId, tuteeId, status })) },
      { entity: "Subject", affectedCount: 75, before: expectedAfter, after: [] },
    ] } }]);
    expect(finder).toHaveBeenCalledTimes(3);
    expect(finder.mock.calls.every(([args]) => args.take === undefined)).toBe(true);
    expect(JSON.stringify(f.state.audits)).not.toContain("PRIVATE_");
    expect(JSON.stringify(f.state.audits)).not.toContain("truncated");
  });

  it("uses an allowlist for sensitive payloads and ignores nested private data", () => {
    expect(safeAuditSnapshot({ id: "code", role: "ADMIN", code: "RAW_CODE", password: "PASSWORD",
      token: "TOKEN", ticket: "TICKET", body: "MESSAGE", email: "PRIVATE_EMAIL", payload: { id: "nested" },
      expiresAt: new Date("2026-10-09T00:00:00Z") })).toEqual({ id: "code", role: "ADMIN", expiresAt: "2026-10-09T00:00:00.000Z" });
  });

  it("records established roster contact changes while excluding challenge recipients", () => {
    const contact = { email: "student@example.test", phone: "12345", preferredContact: "Phone", codeHash: "PRIVATE_HASH", body: "PRIVATE_MESSAGE" };
    expect(safeAuditSnapshot(contact, "Tutee")).toEqual({ email: "student@example.test", phone: "12345", preferredContact: "Phone" });
    expect(safeAuditSnapshot(contact, "RegistrationCode")).toEqual({});
    expect(safeAuditSnapshot(contact, "EmailVerificationCode")).toEqual({});
  });

  it("captures exact management decision notes without exposing participant or credential text", async () => {
    const reviewNote = "Invalidated after reviewing the corrected attendance record.";
    const f = fixture();
    await runAuditedMutation(f.shared, actor, "admin.reviewCard", async tx => {
      await tx.disciplinaryCard.update({ where: { id: "card" }, data: { reviewNote }, select: { id: true } });
      return { ok: true };
    });
    expect(f.state.audits).toMatchObject([{ details: { changes: [{ entity: "DisciplinaryCard",
      before: [{ reason: "Repeated missed sessions", reviewNote: null }],
      after: [{ reason: "Repeated missed sessions", reviewNote }],
    }] } }]);
    expect(safeAuditSnapshot({ decisionNote: reviewNote }, "SessionFlag")).toEqual({ decisionNote: reviewNote });
    expect(safeAuditSnapshot({ decision: reviewNote, body: "PRIVATE_APPEAL" }, "StudentAppeal")).toEqual({ decision: reviewNote });
    expect(safeAuditSnapshot({ reason: reviewNote, excusedAt: null }, "MeetingAttendance")).toEqual({ reason: reviewNote, excusedAt: null });
    expect(safeAuditSnapshot({ reason: "PRIVATE_EXCUSE", excusedAt: new Date("2026-10-09T00:00:00Z") }, "MeetingAttendance"))
      .toEqual({ excusedAt: "2026-10-09T00:00:00.000Z" });
    const privateText = { body: "PRIVATE_MESSAGE", reason: "PRIVATE_REASON", decisionNote: "PRIVATE_NOTE",
      reviewNote: "PRIVATE_NOTE", code: "PRIVATE_CODE", codeHash: "PRIVATE_HASH", email: "PRIVATE_RECIPIENT" };
    expect(safeAuditSnapshot(privateText, "DirectMessage")).toEqual({});
    expect(safeAuditSnapshot(privateText, "EmailVerificationCode")).toEqual({});
  });

  it("retains attendance relationships, actual clock and hours without private commentary", async () => {
    expect(safeAuditSnapshot({ sessionId: "session", roomId: "room", timeSlotId: "slot", mergeGroupId: "primary",
      startMin: 600, endMin: 660, durationMin: 60, shCount: 1, tutorStatus: "PRESENT", comments: "PRIVATE_COMMENT" }))
      .toEqual({ sessionId: "session", roomId: "room", timeSlotId: "slot", mergeGroupId: "primary",
        startMin: 600, endMin: 660, durationMin: 60, shCount: 1, tutorStatus: "PRESENT" });
    const f = fixture();
    await runAuditedMutation(f.shared, actor, "tutor.submitAttendance", async tx => {
      await tx.sessionTutee.createMany({ data: [{ sessionId: "session", tuteeId: "student", status: "PRESENT", absenceReason: "PRIVATE_REASON" }] });
      return { ok: true };
    });
    expect(f.state.audits).toMatchObject([{ details: { changes: [{ entity: "SessionTutee", affectedCount: 1,
      submittedSafeFields: [{ sessionId: "session", tuteeId: "student", status: "PRESENT" }] }] } }]);
    expect(JSON.stringify(f.state.audits)).not.toContain("PRIVATE_REASON");
  });

  it("retains incorrect credential proof counters despite a rejected resolver result", async () => {
    const f = fixture();
    const result = await runAuditedMutation(f.shared, actor, "account.confirmSecondaryEmail", async tx => {
      await tx.$transaction(async owned => {
        await owned.emailVerificationCode.updateMany({ where: { id: "proof" }, data: { attempts: { increment: 1 } } });
      });
      return { ok: false, error: { code: "BAD_REQUEST" } };
    });
    expect(result.ok).toBe(false); expect(f.state.attempts).toBe(1);
    expect(f.state.audits).toMatchObject([
      { details: { outcome: "AUTH_STATE_RECORDED", change: { before: [{ attempts: 0 }], after: [{ attempts: 1 }] } } },
      { kind: "ATTEMPT", details: { applied: false } },
    ]);
  });

  it("keeps a consumed credential proof burned when the later password write fails", async () => {
    const f = fixture();
    const now = new Date();
    await expect(runAuditedMutation(f.shared, actor, "account.changePassword", async tx => {
      await tx.emailVerificationCode.updateMany({ where: { id: "proof" }, data: { consumedAt: now } });
      throw Object.assign(new Error("Credentials changed"), { code: "CONFLICT" });
    })).rejects.toThrow("Credentials changed");
    expect(f.state.consumedAt).toEqual(now);
    expect(f.state.audits).toMatchObject([
      { details: { outcome: "AUTH_STATE_RECORDED", change: { after: [{ consumedAt: now.toISOString() }] } } },
      { kind: "ATTEMPT", details: { errorCode: "CONFLICT", applied: false } },
    ]);
    expect(f.transactions()).toBe(1);
  });

  it("flushes replay effects at an owned decision commit before its post-commit delivery code", async () => {
    const f = fixture();
    const effect = vi.fn(async () => { expect(f.state.status).toBe("INACTIVE"); });
    await runAuditedMutation(f.shared, actor, "approval.decide", async tx => {
      await tx.$transaction(async owned => {
        await owned.tutee.update({ where: { id: "student" }, data: { status: "INACTIVE" } });
        await owned.auditLog.create({ data: { userId: "head", action: "Applied decision", entity: "ApprovalRequest" } });
        expect(deferUntilCommit(effect)).toBe(true);
        expect(effect).not.toHaveBeenCalled();
      });
      expect(effect).toHaveBeenCalledOnce();
      expect(deferUntilCommit(effect)).toBe(false);
      return { ok: true };
    });
    expect(f.transactions()).toBe(1);
    expect(f.state.audits).toMatchObject([{ details: { actorRole: "HEAD", outcome: "APPLIED" } }]);
  });
});
