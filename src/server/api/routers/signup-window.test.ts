import type { Session } from "next-auth";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/audit/log", () => ({ recordAudit: vi.fn() }));

import type { PrismaClient } from "../../../../generated/prisma";
import { createCallerFactory } from "~/server/api/trpc";
import { programRouter } from "./program";
import { tuteeRouter } from "./tutee";
import { applicationRouter } from "./application";

const createProgramCaller = createCallerFactory(programRouter);
const createTuteeCaller = createCallerFactory(tuteeRouter);

const adminSession: Session = {
  user: {
    id: "signup-window-admin",
    name: "Signup Admin",
    email: "signup-admin@example.com",
  },
  role: "ADMIN",
  tutorId: null,
  expires: "2099-01-01T00:00:00.000Z",
};

const coordinatorSession: Session = {
  ...adminSession,
  role: "COORDINATOR",
};

function context(db: unknown, session: Session | null) {
  return {
    db: {
      $executeRaw: vi.fn(),
      ...(db as object),
      user: {
        findUnique: vi.fn().mockResolvedValue(
          session
            ? {
                role: session.role,
                tutorId: session.tutorId,
                suspendedAt: null,
                name: session.user.name,
                username: null,
              }
            : null,
        ),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient,
    session,
    headers: new Headers(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("tutee signup window procedures", () => {
  it("rejects a direct signup mutation before the configured opening time", async () => {
    // Keep real timers running because the shared tRPC middleware may include an opt-in
    // development delay. A relative future timestamp makes the gate deterministic without
    // freezing unrelated asynchronous work.
    const opensAt = new Date(Date.now() + 60_000);
    const findFirst = vi.fn().mockResolvedValue({
      signupOpensAt: opensAt,
    });
    const caller = createTuteeCaller(
      context(
        {
          $executeRaw: vi.fn(),
          $queryRaw: vi.fn(),
          studentSurvey: { findMany: vi.fn().mockResolvedValue([]) },
          term: { findFirst },
        },
        null,
      ),
    );

    await expect(
      caller.requestSignup({
        englishName: "Early Student",
        email: "early-student@example.test",
        policyRevision: "test-revision",
        preferredContact: "student@example.com",
        firstChoiceId: "subject-1",
        slotIds: ["slot-1"],
        signatureName: "Early Student",
        agreed: true,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(findFirst).toHaveBeenCalledOnce();
  });

  it("lets an administrator save the active quarter's opening time and preview link", async () => {
    const opensAt = new Date("2026-09-01T00:00:00Z");
    const update = vi.fn().mockResolvedValue({
      signupOpensAt: opensAt,
      signupPreviewUrl: "https://example.com/preview",
    });
    const caller = createProgramCaller(
      context(
        {
          term: {
            findFirst: vi
              .fn()
              .mockResolvedValue({ id: "term-q3", quarter: "Q3" }),
            update,
          },
        },
        adminSession,
      ),
    );

    await expect(
      caller.setSignupWindow({
        opensAt,
        previewUrl: "https://example.com/preview",
      }),
    ).resolves.toEqual({
      signupOpensAt: opensAt,
      signupPreviewUrl: "https://example.com/preview",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "term-q3" },
        data: {
          signupOpensAt: opensAt,
          signupPreviewUrl: "https://example.com/preview",
        },
      }),
    );
  });

  it("allows scheduling without an external preview link", async () => {
    const update = vi.fn().mockResolvedValue({ id: "term" });
    const caller = createProgramCaller(
      context(
        {
          term: {
            findFirst: vi.fn().mockResolvedValue({ id: "term" }),
            update,
          },
        },
        adminSession,
      ),
    );
    await caller.setSignupWindow({
      opensAt: new Date("2099-01-01"),
      previewUrl: null,
    });
    expect(update).toHaveBeenCalled();
  });

  it("does not let coordinators change program-wide signup timing", async () => {
    const caller = createProgramCaller(
      context({ term: { findFirst: vi.fn() } }, coordinatorSession),
    );
    await expect(
      caller.setSignupWindow({ opensAt: null, previewUrl: null }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

const createTutorCaller = createCallerFactory(applicationRouter);
it.each(["paused", "scheduled", "ended", "no-period"])(
  "rejects both submission APIs when recruitment is %s",
  async (state) => {
    const term =
      state === "no-period"
        ? null
        : {
            signupEnabled: state !== "paused",
            tutorSignupEnabled: state !== "paused",
            signupOpensAt:
              state === "scheduled" ? new Date(Date.now() + 60_000) : null,
            tutorSignupOpensAt:
              state === "scheduled" ? new Date(Date.now() + 60_000) : null,
            signupClosesAt:
              state === "ended" ? new Date(Date.now() - 60_000) : null,
            tutorSignupClosesAt:
              state === "ended" ? new Date(Date.now() - 60_000) : null,
          };
    const create = vi.fn();
    const ctx = context(
      {
        term: { findFirst: vi.fn().mockResolvedValue(term) },
        $queryRaw: vi.fn(),
        studentSurvey: { findMany: vi.fn().mockResolvedValue([]), create },
        tutorApplication: { create },
      },
      null,
    );
    await expect(
      createTutorCaller(ctx).submit({
        name: "Test Tutor",
        email: "closed-tutor@example.test",
        agreed: true,
        policyRevision: "r1",
        subjects: [{ subjectId: "math" }],
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      createTuteeCaller(ctx).submitSurvey({
        englishName: "Test Student",
        email: `closed-${state}@example.test`,
        agreed: true,
        policyRevision: "r1",
        firstChoiceId: "math",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(create).not.toHaveBeenCalled();
  },
);
it.each(["tutor", "tutee"] as const)(
  "saves only the %s schedule and prevents invalid/stale writes",
  async (audience) => {
    const update = vi.fn().mockResolvedValue({ id: "current" });
    const caller = createProgramCaller(
      context(
        {
          term: {
            findFirst: vi.fn().mockResolvedValue({ id: "current" }),
            update,
          },
        },
        adminSession,
      ),
    );
    const input = {
      audience,
      expectedTermId: "current",
      enabled: false,
      opensAt: new Date("2090-01-01"),
      closesAt: new Date("2090-02-01"),
      previewUrl: null,
    };
    await caller.setSignupWindow(input);
    const data = (update.mock.calls[0]![0] as {data: Record<string, unknown>}).data;
    expect(
      Object.keys(data).every((key) =>
        audience === "tutor"
          ? key.startsWith("tutorSignup")
          : key.startsWith("signup"),
      ),
    ).toBe(true);
    expect(Object.values(data)).toContain(false);
    update.mockClear();
    await expect(
      caller.setSignupWindow({ ...input, closesAt: input.opensAt }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.setSignupWindow({ ...input, expectedTermId: "previous" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(update).not.toHaveBeenCalled();
  },
);
it("rejects anonymous management writes", async () => {
  await expect(
    createProgramCaller(context({}, null)).setSignupWindow({
      opensAt: null,
      previewUrl: null,
    }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
