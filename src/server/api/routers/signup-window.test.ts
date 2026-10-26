import type { Session } from "next-auth";
import { randomUUID } from "node:crypto";
import type * as SignupAdmission from "~/server/signup-admission";
import type * as SignupCaptcha from "~/server/captcha";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/audit/log", () => ({ recordAudit: vi.fn() }));
// These procedure-unit tests isolate recruitment windows. Durable admission and
// its ordering are exercised against PostgreSQL in signup-admission.test.ts.
vi.mock("~/server/signup-admission", async (importOriginal) => ({
  ...(await importOriginal<typeof SignupAdmission>()),
  withSignupAdmission: (_db: unknown, _headers: Headers, _lane: unknown, _identity: unknown, work: () => Promise<unknown>) => work(),
  withSignupLease: (_db: unknown, _lane: string, work: () => Promise<unknown>) => work(),
}));
// CAPTCHA has its own direct-API integration suite; keep this fixture focused on windows.
vi.mock("~/server/captcha", async (importOriginal) => ({
  ...(await importOriginal<typeof SignupCaptcha>()),
  withProtectedSignup: (_db: unknown, _headers: Headers, _action: unknown, _email: string, _grant: unknown, work: () => Promise<unknown>) => work(),
}));

import type { PrismaClient } from "../../../../generated/prisma";
import { createCallerFactory } from "~/server/api/trpc";
import { programRouter } from "./program";
import { tuteeRouter } from "./tutee";
import { applicationRouter } from "./application";

const createProgramCaller = createCallerFactory(programRouter);
const createTuteeCaller = createCallerFactory(tuteeRouter);

const headSession: Session = {
  user: {
    id: "signup-window-admin",
    name: "Signup Admin",
    email: "signup-admin@example.com",
  },
  role: "HEAD",
  tutorId: null,
  expires: "2099-01-01T00:00:00.000Z",
};

const coordinatorSession: Session = {
  ...headSession,
  role: "COORDINATOR",
};

function context(db: unknown, session: Session | null) {
  const actor = session ? {
    id: session.user.id,
    role: session.role,
    tutorId: session.tutorId,
    suspendedAt: null,
    mergedIntoId: null,
    name: session.user.name,
    username: null,
  } : null;
  const findUser = vi.fn().mockResolvedValue(actor);
  const lockActor = vi.fn().mockResolvedValue(actor ? [{ id: actor.id }] : []);
  return {
    db: {
      $executeRaw: vi.fn(),
      // Window saves retain the actor row after the period barrier. Return the
      // locked row identity, then let the separate User read supply live authority.
      $queryRaw: lockActor,
      studentSignupIntent: { findUnique: vi.fn().mockResolvedValue(null) },
      signupLease: { findFirst: vi.fn().mockResolvedValue(null) },
      ...(db as object),
      user: { findUnique: findUser },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient,
    session,
    headers: new Headers(),
    fixtures: { actor, findUser, lockActor },
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
        clientKey: randomUUID(),
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

  it.each(["ADMIN", "HEAD"] as const)("lets %s save the active quarter's opening time and preview link", async (role) => {
    const opensAt = new Date("2026-09-01T00:00:00Z");
    const update = vi.fn().mockResolvedValue({
      signupOpensAt: opensAt,
      signupPreviewUrl: "https://example.com/preview",
    });
    const ctx = context(
      {
        term: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: "term-q3", quarter: "Q3" }),
          update,
        },
      },
      { ...headSession, role },
    );
    const caller = createProgramCaller(ctx);

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
    expect(ctx.db.$queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("FOR SHARE")]),
      headSession.user.id,
    );
    expect(ctx.db.user.findUnique).toHaveBeenCalledWith({
      where: { id: headSession.user.id },
      select: { id: true, name: true, username: true, role: true, suspendedAt: true, mergedIntoId: true },
    });
    expect(ctx.fixtures.lockActor.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.fixtures.findUser.mock.invocationCallOrder[1]!,
    );
  });

  it.each(["ADMIN", "HEAD"] as const)("allows %s to schedule without an external preview link", async (role) => {
    const update = vi.fn().mockResolvedValue({ id: "term" });
    const caller = createProgramCaller(
      context(
        {
          term: {
            findFirst: vi.fn().mockResolvedValue({ id: "term" }),
            update,
          },
        },
        { ...headSession, role },
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

  it.each(["demoted", "suspended", "retired", "deleted"] as const)(
    "rejects an admitted Admin whose current account becomes %s before the actor lock",
    async (state) => {
      const findFirst = vi.fn().mockResolvedValue({ id: "current" });
      const update = vi.fn();
      const ctx = context({ term: { findFirst, update } }, { ...headSession, role: "ADMIN" });
      // Model a change committed during the barrier wait. Admission still sees
      // the original Admin; the real post-lock User read must reject the new state.
      ctx.fixtures.lockActor.mockImplementationOnce(() => {
        const current = state === "deleted" ? null : {
          ...ctx.fixtures.actor,
          ...(state === "demoted" ? { role: "COORDINATOR" } : {}),
          ...(state === "suspended" ? { suspendedAt: new Date() } : {}),
          ...(state === "retired" ? { mergedIntoId: "surviving-login" } : {}),
        };
        ctx.fixtures.findUser.mockResolvedValue(current);
        return Promise.resolve(current ? [{ id: headSession.user.id }] : []);
      });
      await expect(createProgramCaller(ctx).setSignupWindow({
        audience: "tutee", expectedTermId: "current", opensAt: null, previewUrl: null,
      })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(ctx.fixtures.lockActor).toHaveBeenCalledOnce();
      expect(findFirst).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    },
  );
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
        clientKey: randomUUID(),
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
it.each((["ADMIN", "HEAD"] as const).flatMap((role) =>
  (["tutor", "tutee"] as const).map((audience) => ({ role, audience })),
))(
  "lets $role save only the $audience schedule and prevents invalid/stale writes",
  async ({ role, audience }) => {
    const update = vi.fn().mockResolvedValue({ id: "current" });
    const caller = createProgramCaller(
      context(
        {
          term: {
            findFirst: vi.fn().mockResolvedValue({ id: "current" }),
            update,
          },
        },
        { ...headSession, role },
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
