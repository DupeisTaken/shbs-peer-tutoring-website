import { describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { db as database } from "~/server/db";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
// These read/authorization tests never instantiate a live database or issue mail.
vi.mock("~/server/db", () => ({ db: {} }));
import { createCaller } from "~/server/api/root";

const future = new Date("2099-01-01");
const past = new Date("2000-01-01");
const code = (patch = {}) => ({
  id: "application-code",
  code: "ABCDE",
  tutorId: "exact-tutor",
  email: "applicant@example.test",
  expiresAt: future,
  usedAt: null,
  attempts: 0,
  ...patch,
});
const linkedUser = (patch = {}) => ({
  name: "Exact account",
  username: "exact-account",
  role: "TUTOR",
  emailVerifiedAt: past,
  tutorAccessRevoked: false,
  suspendedAt: null,
  mergedIntoId: null,
  schoolDeparture: null,
  ...patch,
});
function fixture(role: Session["role"] = "HEAD") {
  const actor = {
    role,
    name: "Staff",
    username: "staff",
    tutorId: null,
    suspendedAt: null,
    mergedIntoId: null,
    tutorAccessRevoked: false,
    schoolDeparture: null as {
      reason: string;
      observerRevoked: boolean;
      tutorDerived: boolean;
    } | null,
  };
  const application: {
    type: string;
    status: string;
    invalidatedAt: Date | null;
    promotedTutorId: string | null;
    email: string;
  } = {
    type: "INITIAL",
    status: "ACCEPTED",
    invalidatedAt: null,
    promotedTutorId: "exact-tutor",
    email: "applicant@example.test",
  };
  const mock = {
    user: { findUnique: vi.fn().mockResolvedValue(actor) },
    tutorApplication: { findUnique: vi.fn().mockResolvedValue(application) },
    registrationCode: { findMany: vi.fn().mockResolvedValue([code()]) },
    tutor: {
      findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE", user: null }),
    },
  };
  const caller = createCaller({
    db: mock as unknown as typeof database,
    headers: new Headers(),
    // Deliberately stale role: the live account remains authoritative.
    session: {
      user: { id: "staff", name: "Staff" },
      role: "HEAD",
      tutorId: null,
      expires: "2099-01-01",
    },
  });
  return {
    actor,
    application,
    mock,
    read: () =>
      caller.admin.applicationAccountSetup({
        applicationId: "exact-application",
      }),
  };
}

it.each<Session["role"]>(["HEAD", "ADMIN", "COORDINATOR"])(
  "%s reads only this application's existing tutor code",
  async (role) => {
    const { read, mock } = fixture(role);
    expect(await read()).toEqual({
      state: "active",
      tutorId: "exact-tutor",
      account: null,
      invitation: { id: "application-code", code: "ABCDE", expiresAt: future },
    });
    expect(mock.registrationCode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { applicationId: "exact-application", kind: "TUTOR" },
      }),
    );
    expect(mock.tutor.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "exact-tutor" } }),
    );
    // The database surface deliberately provides no write operation.
    expect(mock.user.findUnique).toHaveBeenCalledTimes(1);
  },
);

it.each<Session["role"]>(["VIEWER", "TUTOR", "STUDENT", "CREW"])(
  "%s cannot read invitation data despite a stale Head session",
  async (role) => {
    const { read, mock } = fixture(role);
    await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mock.tutorApplication.findUnique).not.toHaveBeenCalled();
    expect(mock.registrationCode.findMany).not.toHaveBeenCalled();
  },
);

it("departure observers cannot read the popup", async () => {
  const { read, actor, mock } = fixture("TUTOR");
  actor.schoolDeparture = {
    reason: "GRADUATED",
    observerRevoked: false,
    tutorDerived: false,
  };
  await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mock.registrationCode.findMany).not.toHaveBeenCalled();
});

it.each([
  { status: "PENDING" },
  { status: "REJECTED" },
  { status: "RECALLED" },
  { type: "ADDITIONAL_SUBJECT" },
  { type: "HIGHER_LEVEL" },
  { invalidatedAt: past },
])("withholds codes for an ineligible application %j", async (patch) => {
  const { read, application, mock } = fixture();
  Object.assign(application, patch);
  expect(await read()).toEqual({
    state: "notEligible",
    tutorId: null,
    account: null,
    invitation: null,
  });
  expect(mock.registrationCode.findMany).not.toHaveBeenCalled();
});

it("confirms only a verified exact current tutor/account link and returns no code", async () => {
  const { read, mock } = fixture();
  mock.tutor.findUnique.mockResolvedValue({
    status: "ACTIVE",
    user: linkedUser(),
  });
  expect(await read()).toEqual({
    state: "linked",
    tutorId: "exact-tutor",
    account: { name: "Exact account", username: "exact-account" },
    invitation: null,
  });
});

it("can display the existing code while an exact account still needs verification", async () => {
  const { read, mock } = fixture();
  mock.tutor.findUnique.mockResolvedValue({
    status: "ACTIVE",
    user: linkedUser({ emailVerifiedAt: null }),
  });
  expect((await read()).state).toBe("active");
  mock.registrationCode.findMany.mockResolvedValue([]);
  expect(await read()).toMatchObject({
    state: "accountPending",
    invitation: null,
  });
});

it.each([
  { tutorAccessRevoked: true },
  { suspendedAt: past },
  { mergedIntoId: "merged-account" },
  { role: "VIEWER" },
  { schoolDeparture: { reason: "GRADUATED" } },
])(
  "does not present a restricted account as completed or share a code %j",
  async (patch) => {
    const { read, mock } = fixture();
    mock.tutor.findUnique.mockResolvedValue({
      status: "ACTIVE",
      user: linkedUser(patch),
    });
    expect(await read()).toMatchObject({
      state: "accountRestricted",
      invitation: null,
    });
  },
);

it("withholds invitation sharing for an inactive tutor", async () => {
  const { read, mock } = fixture();
  mock.tutor.findUnique.mockResolvedValue({ status: "ARCHIVED", user: null });
  expect(await read()).toMatchObject({
    state: "accountRestricted",
    invitation: null,
  });
});

describe("legacy and invalid invitation provenance", () => {
  it.each([
    { tutorId: null },
    { email: "different@example.test" },
    { email: null },
  ])(
    "withholds an active code with an incomplete or mismatched binding %j",
    async (patch) => {
      const { read, mock } = fixture();
      mock.registrationCode.findMany.mockResolvedValue([code(patch)]);
      expect(await read()).toEqual({
        state: "conflict",
        tutorId: null,
        account: null,
        invitation: null,
      });
    },
  );
  it("does not turn an application-only invitation into a guessed tutor binding", async () => {
    const { read, application, mock } = fixture();
    application.promotedTutorId = null;
    mock.registrationCode.findMany.mockResolvedValue([code({ tutorId: null })]);
    expect(await read()).toMatchObject({ state: "conflict", invitation: null });
    expect(mock.tutor.findUnique).not.toHaveBeenCalled();
  });
  it("compares exact invitation contact case-insensitively without looking up a user by email", async () => {
    const { read, application, mock } = fixture();
    application.email = " Applicant@Example.Test ";
    mock.registrationCode.findMany.mockResolvedValue([
      code({ email: "applicant@example.test" }),
    ]);
    expect((await read()).state).toBe("active");
    expect(mock.user.findUnique).toHaveBeenCalledTimes(1);
  });
  it("uses one exact code-bound tutor, including reissued codes, without email/name lookup", async () => {
    const { read, application, mock } = fixture();
    application.promotedTutorId = null;
    mock.registrationCode.findMany.mockResolvedValue([
      code(),
      code({ id: "old-code", usedAt: past }),
    ]);
    expect(await read()).toMatchObject({
      state: "active",
      tutorId: "exact-tutor",
    });
    expect(application.promotedTutorId).toBeNull();
    expect(mock.user.findUnique).toHaveBeenCalledTimes(1);
  });
  it("rejects disagreement between promoted and code-bound tutor IDs", async () => {
    const { read, mock } = fixture();
    mock.registrationCode.findMany.mockResolvedValue([
      code({ tutorId: "different-tutor" }),
    ]);
    expect(await read()).toEqual({
      state: "conflict",
      tutorId: null,
      account: null,
      invitation: null,
    });
    expect(mock.tutor.findUnique).not.toHaveBeenCalled();
  });
  it("rejects conflicting legacy bindings and a deleted explicit tutor", async () => {
    const { read, application, mock } = fixture();
    application.promotedTutorId = null;
    mock.registrationCode.findMany.mockResolvedValue([
      code(),
      code({ tutorId: "different-tutor" }),
    ]);
    expect((await read()).state).toBe("conflict");
    mock.registrationCode.findMany.mockResolvedValue([code()]);
    mock.tutor.findUnique.mockResolvedValue(null);
    expect((await read()).state).toBe("conflict");
  });
  it.each([
    { rows: [], state: "missing" },
    { rows: [code({ code: null })], state: "missing" },
    { rows: [code({ code: "" })], state: "missing" },
    { rows: [code({ code: "   " })], state: "missing" },
    { rows: [code({ attempts: 10 })], state: "missing" },
    { rows: [code({ expiresAt: past })], state: "expired" },
    { rows: [code({ usedAt: past })], state: "used" },
  ])(
    "reports $state without returning an invalid secret",
    async ({ rows, state }) => {
      const { read, mock } = fixture();
      mock.registrationCode.findMany.mockResolvedValue(rows);
      expect(await read()).toMatchObject({ state, invitation: null });
    },
  );
  it("reports a missing application instead of inspecting codes", async () => {
    const { read, mock } = fixture();
    mock.tutorApplication.findUnique.mockResolvedValueOnce(null);
    await expect(read()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mock.registrationCode.findMany).not.toHaveBeenCalled();
  });
});
