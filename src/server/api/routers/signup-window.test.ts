import type { Session } from "next-auth";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/audit/log", () => ({ recordAudit: vi.fn() }));

import type { PrismaClient } from "../../../../generated/prisma";
import { createCallerFactory } from "~/server/api/trpc";
import { programRouter } from "./program";
import { tuteeRouter } from "./tutee";

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
    db: db as PrismaClient,
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T00:00:00Z"));
    const findFirst = vi.fn().mockResolvedValue({
      signupOpensAt: new Date("2026-09-01T00:00:00Z"),
    });
    const caller = createTuteeCaller(context({ term: { findFirst } }, null));

    await expect(
      caller.requestSignup({
        englishName: "Early Student",
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

  it("requires a preview link for a scheduled opening", async () => {
    const caller = createProgramCaller(
      context({ term: { findFirst: vi.fn() } }, adminSession),
    );
    await expect(
      caller.setSignupWindow({
        opensAt: new Date("2026-09-01T00:00:00Z"),
        previewUrl: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
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
