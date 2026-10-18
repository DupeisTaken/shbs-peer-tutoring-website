import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import type * as Nodemailer from "nodemailer";
import type { Session } from "next-auth";
import type * as Environment from "~/env";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

type Mail = { to: string; text: string };
type Acceptance = { accepted: string[]; rejected: string[] };
const smtp = vi.hoisted(() => {
  const env: Record<string, unknown> = {};
  return {
    env,
    send: vi.fn<(message: Mail) => Promise<Acceptance>>(),
    close: vi.fn(),
  };
});
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/env", async (importOriginal) => {
  const actual = await importOriginal<typeof Environment>();
  // Retain the real database, authentication and application configuration. Only
  // transport identity/availability changes, so this exercises the real sender.
  Object.assign(smtp.env, actual.env, { NODE_ENV: "production" });
  return { ...actual, env: smtp.env };
});
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: smtp.send, close: smtp.close }),
  },
}));

import { createCaller } from "./api/root";
import { ApprovalQueued } from "./approvals";
import { db } from "./db";
import { approvalScope, databaseScope } from "./db-scope";
import { currentPolicy } from "./policy-acceptance";
import {
  confirmSurvey,
  inspectSurvey,
  submitSurvey,
  surveyInput,
} from "./student-survey";
import { VERIFICATION_WEEK_MS } from "./student-request-state";
import { prepareStudentAction } from "./student-workflow";

const actor = (id = "delivery-admin", role: Session["role"] = "ADMIN") =>
  createCaller({
    db,
    headers: new Headers(),
    session: { user: { id }, role, tutorId: null, expires: "2099-01-01" },
  });
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const accepted = (message: Mail): Acceptance => ({
  accepted: [message.to],
  rejected: [],
});
const rejected = (message: Mail): Acceptance => ({
  accepted: [],
  rejected: [message.to],
});
const mailToken = (message: Mail) => {
  const token = /token=([a-f0-9]{64})/.exec(message.text)?.[1];
  if (!token) throw new Error("Expected a signup verification link");
  return token;
};
let email: string;
let revision: string;
const observedScopes: Array<{ database: unknown; approval: unknown }> = [];
const commitCheckErrors: unknown[] = [];

function transport(handler: (message: Mail) => Promise<Acceptance>) {
  smtp.send.mockImplementation(async (message) => {
    // The real sender must reach the provider after all transaction owners exit.
    // Assert these observations outside sender catches as well: a rejection must
    // not accidentally conceal a failed test assertion as ordinary SMTP failure.
    observedScopes.push({
      database: databaseScope.getStore(),
      approval: approvalScope.getStore(),
    });
    return handler(message);
  });
}

async function ready(userId: string, target: string) {
  const ticket = await prepareStudentAction(db, userId, "ASSIGN", target);
  await db.studentActionConfirmation.update({
    where: { id: ticket.id },
    data: { readyAt: new Date(0) },
  });
  return ticket.id;
}

async function signup() {
  await submitSurvey(
    db,
    surveyInput.parse({
      englishName: "Delivery Student",
      email,
      preferredContact: email,
      firstChoiceId: "delivery-subject",
      secondChoiceId: "delivery-second-subject",
      slotIds: ["delivery-slot"],
      signatureName: "Delivery Student",
      agreed: true,
      policyRevision: revision,
    }),
  );
  const token = mailToken(smtp.send.mock.calls.at(-1)![0]);
  const survey = await db.studentSurvey.findFirstOrThrow({ where: { email } });
  // Nonzero guessing metadata makes failure-preservation assertions meaningful.
  await db.studentSurvey.update({
    where: { id: survey.id },
    data: { verificationAttempts: 2 },
  });
  smtp.send.mockClear();
  return { survey, token };
}

const assignment = (id: string, ticket: string) => ({
  id,
  ticket,
  subjectId: "delivery-subject",
  tutorId: "delivery-tutor",
});
const row = (id: string) =>
  db.studentSurvey.findUniqueOrThrow({ where: { id } });
async function challenge(id: string) {
  const value = await row(id);
  return {
    tokenHash: value.tokenHash,
    expiresAt: value.expiresAt,
    verificationAttempts: value.verificationAttempts,
    lastLinkSentAt: value.lastLinkSentAt,
  };
}
async function durableAudit(operation: string) {
  expect(
    await db.auditLog.count({ where: { operation, kind: { not: "ATTEMPT" } } }),
  ).toBeGreaterThan(0);
}

// Explicit gates model overlapping SMTP without timers or parallel test files.
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}
async function entered(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("SMTP did not start")), 4000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((table) => '"' + table.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  Object.assign(smtp.env, {
    NODE_ENV: "production",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: 465,
    EMAIL_PROGRAM_FROM: "program@example.test",
    SMTP_PROGRAM_PASSWORD: "synthetic-program-secret",
    SMTP_PROGRAM_USER: undefined,
    EMAIL_FROM: undefined,
    SMTP_PASSWORD: undefined,
    SMTP_USER: undefined,
  });
  smtp.send.mockReset();
  smtp.close.mockClear();
  observedScopes.length = 0;
  commitCheckErrors.length = 0;
  transport(async (message) => accepted(message));
  email = `delivery-${randomUUID()}@example.test`;
  await db.user.createMany({
    data: [
      {
        id: "delivery-admin",
        email: "delivery-admin@example.test",
        role: "ADMIN",
      },
      {
        id: "delivery-coordinator",
        email: "delivery-coordinator@example.test",
        role: "COORDINATOR",
      },
    ],
  });
  await db.term.create({
    data: {
      id: "delivery-term",
      name: "Delivery Intake",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  await db.subject.create({
    data: { id: "delivery-subject", name: "Mathematics", active: true },
  });
  await db.subject.create({
    data: { id: "delivery-second-subject", name: "Physics", active: true },
  });
  await db.timeSlot.create({
    data: {
      id: "delivery-slot",
      label: "After school",
      dayOfWeek: 1,
      startMin: 930,
      endMin: 990,
      active: true,
    },
  });
  await db.tutor.create({
    data: {
      id: "delivery-tutor",
      englishName: "Delivery Tutor",
      status: "ACTIVE",
    },
  });
  await db.tutorQualification.create({
    data: {
      tutorId: "delivery-tutor",
      subjectId: "delivery-subject",
      approvedById: "delivery-admin",
      grants: { create: { subjectId: "delivery-subject" } },
    },
  });
  await db.policyDocument.create({
    data: {
      slug: "tutee-policy",
      locale: "en",
      title: "Tutee policy",
      body: "Attend and respect one another.",
    },
  });
  revision = (await currentPolicy(db, "tutee-policy")).revision;
});
afterEach(() => {
  for (const scope of observedScopes) {
    expect(scope.database).toBeUndefined();
    expect(scope.approval).toBeUndefined();
  }
  expect(commitCheckErrors).toEqual([]);
});
afterAll(() => db.$disconnect());

const outcomes = ["accepted", "rejected", "throwing", "unavailable"] as const;
type Outcome = (typeof outcomes)[number];
function deliveryOutcome(
  outcome: Outcome,
  checkCommitted: () => Promise<void>,
) {
  if (outcome === "unavailable") {
    smtp.env.EMAIL_PROGRAM_FROM = undefined;
    smtp.env.SMTP_PROGRAM_PASSWORD = undefined;
  }
  transport(async (message) => {
    try {
      await checkCommitted();
    } catch (error) {
      commitCheckErrors.push(error);
      throw error;
    }
    if (outcome === "throwing") throw new Error("Synthetic provider failure");
    return outcome === "rejected" ? rejected(message) : accepted(message);
  });
}

describe("audited student signup delivery receipts", () => {
  it("keeps the committed assignment after a real loopback SMTP connection refusal", async () => {
    const { survey } = await signup();
    const previous = await challenge(survey.id);
    // Reserve then close our own ephemeral loopback port. No external recipient
    // or credentials are used; this case delegates to actual Nodemailer I/O.
    const listener = createServer();
    await new Promise<void>((resolve) =>
      listener.listen(0, "127.0.0.1", resolve),
    );
    const address = listener.address();
    if (!address || typeof address === "string")
      throw new Error("Expected loopback port");
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    const { default: nodemailer } =
      await vi.importActual<typeof Nodemailer>("nodemailer");
    const local = nodemailer.createTransport({
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      connectionTimeout: 500,
      greetingTimeout: 500,
      socketTimeout: 500,
    });
    let attempted = false;
    transport(async (message) => {
      attempted = true;
      const value = await local.sendMail(message);
      return {
        accepted: value.accepted.map(String),
        rejected: value.rejected.map(String),
      };
    });
    try {
      await expect(
        actor().studentWorkflow.assign(
          assignment(survey.id, await ready("delivery-admin", survey.id)),
        ),
      ).resolves.toEqual({ ok: true, emailSent: false });
    } finally {
      local.close();
    }
    expect(attempted).toBe(true);
    expect(await db.pairingTutee.count()).toBe(1);
    expect(await challenge(survey.id)).toEqual(previous);
    await durableAudit("studentWorkflow.assign");
  });

  it.each(outcomes)(
    "assignment reports %s SMTP after assignment and evidence commit",
    async (outcome) => {
      const { survey } = await signup();
      const previous = await challenge(survey.id);
      deliveryOutcome(outcome, async () => {
        await durableAudit("studentWorkflow.assign");
        expect(await db.pairingTutee.count()).toBe(1);
        expect((await row(survey.id)).firstAssignedAt).not.toBeNull();
      });
      const result = await actor().studentWorkflow.assign(
        assignment(survey.id, await ready("delivery-admin", survey.id)),
      );
      expect(result).toEqual({ ok: true, emailSent: outcome === "accepted" });
      expect(smtp.send).toHaveBeenCalledTimes(
        outcome === "unavailable" ? 0 : 1,
      );
      await durableAudit("studentWorkflow.assign");
      expect(await db.pairingTutee.count()).toBe(1);
      const current = await row(survey.id);
      expect(current.submittedAt).toEqual(survey.submittedAt);
      expect(+current.verificationDueAt! - +current.firstAssignedAt!).toBe(
        VERIFICATION_WEEK_MS,
      );
      if (outcome === "accepted") {
        expect(current.tokenHash).toBe(
          digest(mailToken(smtp.send.mock.calls[0]![0])),
        );
        expect(current.verificationAttempts).toBe(0);
      } else expect(await challenge(survey.id)).toEqual(previous);
    },
  );

  it.each(outcomes)(
    "resend reports %s SMTP and preserves failed challenge metadata",
    async (outcome) => {
      const { survey, token } = await signup();
      const previous = await challenge(survey.id);
      deliveryOutcome(outcome, async () =>
        durableAudit("studentWorkflow.resend"),
      );
      const result = await actor().studentWorkflow.resend({ id: survey.id });
      expect(result).toEqual({ emailSent: outcome === "accepted" });
      expect(smtp.send).toHaveBeenCalledTimes(
        outcome === "unavailable" ? 0 : 1,
      );
      await durableAudit("studentWorkflow.resend");
      if (outcome === "accepted") {
        expect((await challenge(survey.id)).tokenHash).toBe(
          digest(mailToken(smtp.send.mock.calls[0]![0])),
        );
        expect((await challenge(survey.id)).verificationAttempts).toBe(0);
      } else {
        expect(await challenge(survey.id)).toEqual(previous);
        // Existing recipients keep a usable link after a failed management retry.
        await expect(inspectSurvey(db, token)).resolves.toBeDefined();
      }
      expect(await db.pairing.count()).toBe(0);
      expect((await row(survey.id)).submittedAt).toEqual(survey.submittedAt);
    },
  );

  it("does not contact SMTP or consume the confirmation when assignment audit rolls back", async () => {
    const { survey } = await signup();
    const previous = await challenge(survey.id);
    const ticket = await ready("delivery-admin", survey.id);
    // Isolated PostgreSQL only: reject the enclosing audit, after the resolver has
    // staged its assignment and delivery effect. Always remove our own DDL.
    await db.$executeRawUnsafe(
      `CREATE FUNCTION delivery_fail_assignment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation = 'studentWorkflow.assign' AND NEW.kind <> 'ATTEMPT' THEN RAISE EXCEPTION 'Injected assignment audit failure'; END IF; RETURN NEW; END $$`,
    );
    try {
      await db.$executeRawUnsafe(
        `CREATE TRIGGER delivery_fail_assignment_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION delivery_fail_assignment_audit()`,
      );
      try {
        await expect(
          actor().studentWorkflow.assign(assignment(survey.id, ticket)),
        ).rejects.toBeDefined();
      } finally {
        await db.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS delivery_fail_assignment_audit ON "AuditLog"`,
        );
      }
    } finally {
      await db.$executeRawUnsafe(
        `DROP FUNCTION delivery_fail_assignment_audit()`,
      );
    }
    expect(smtp.send).not.toHaveBeenCalled();
    expect(await db.pairing.count()).toBe(0);
    expect(await challenge(survey.id)).toEqual(previous);
    expect((await row(survey.id)).firstAssignedAt).toBeNull();
    expect(
      (
        await db.studentActionConfirmation.findUniqueOrThrow({
          where: { id: ticket },
        })
      ).usedAt,
    ).toBeNull();
    // A retry with the same still-unused ticket succeeds after the rollback cause is removed.
    await expect(
      actor().studentWorkflow.assign(assignment(survey.id, ticket)),
    ).resolves.toEqual({ ok: true, emailSent: true });
    expect(smtp.send).toHaveBeenCalledTimes(1);
  });

  it.each(["closed", "invalidated"] as const)(
    "reports no delivery when the request becomes %s before the deferred snapshot",
    async (state) => {
      const { survey } = await signup();
      const previous = await challenge(survey.id);
      // The audit insertion follows resolver validation and precedes commit. Its
      // trigger changes the request before the queued delivery reads its snapshot.
      await db.$executeRawUnsafe(
        `CREATE FUNCTION delivery_change_before_resend() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation = 'studentWorkflow.resend' AND NEW.kind <> 'ATTEMPT' THEN IF TG_ARGV[1] = 'closed' THEN UPDATE "StudentSurvey" SET state = 'RECALLED' WHERE id = TG_ARGV[0]; ELSE UPDATE "StudentSurvey" SET "invalidatedAt" = clock_timestamp() WHERE id = TG_ARGV[0]; END IF; END IF; RETURN NEW; END $$`,
      );
      try {
        await db.$executeRawUnsafe(
          `CREATE TRIGGER delivery_change_before_resend BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION delivery_change_before_resend('${survey.id.replaceAll("'", "''")}', '${state}')`,
        );
        try {
          await expect(
            actor().studentWorkflow.resend({ id: survey.id }),
          ).resolves.toEqual({ emailSent: false });
        } finally {
          await db.$executeRawUnsafe(
            `DROP TRIGGER IF EXISTS delivery_change_before_resend ON "AuditLog"`,
          );
        }
      } finally {
        await db.$executeRawUnsafe(
          `DROP FUNCTION delivery_change_before_resend()`,
        );
      }
      await durableAudit("studentWorkflow.resend");
      expect(smtp.send).not.toHaveBeenCalled();
      expect(await challenge(survey.id)).toEqual(previous);
      const current = await row(survey.id);
      if (state === "closed") expect(current.state).toBe("RECALLED");
      else expect(current.invalidatedAt).not.toBeNull();
    },
  );
});

describe("overlapping real-sender retries", () => {
  it.each(["confirmed", "invalidated", "closed", "expired"] as const)(
    "does not publish a replacement when the request becomes %s during SMTP",
    async (state) => {
      const { survey, token } = await signup();
      const previous = await challenge(survey.id);
      transport(async (message) => {
        if (state === "confirmed")
          await confirmSurvey(db, token, "DeliveryStudentPassword42");
        else
          await db.studentSurvey.update({
            where: { id: survey.id },
            data:
              state === "invalidated"
                ? { invalidatedAt: new Date() }
                : state === "closed"
                  ? { state: "RECALLED" }
                  : { verificationDueAt: new Date(0) },
          });
        return accepted(message);
      });
      expect(await actor().studentWorkflow.resend({ id: survey.id })).toEqual({
        emailSent: false,
      });
      expect(await challenge(survey.id)).toEqual(previous);
      expect(smtp.send).toHaveBeenCalledTimes(1);
    },
  );

  it("leaves the previous link redeemable when concurrent recipients are rejected", async () => {
    const { survey, token } = await signup();
    const previous = await challenge(survey.id);
    const started = gate();
    const release = gate();
    let calls = 0;
    transport(async (message) => {
      if (++calls === 2) started.open();
      await release.promise;
      return rejected(message);
    });
    const requests = [
      actor().studentWorkflow.resend({ id: survey.id }),
      actor().studentWorkflow.resend({ id: survey.id }),
    ];
    const work = Promise.all(requests);
    const settled = Promise.allSettled([...requests, work]);
    try {
      await entered(started.promise);
    } finally {
      release.open();
      await settled;
    }
    expect(await work).toEqual([{ emailSent: false }, { emailSent: false }]);
    expect(await challenge(survey.id)).toEqual(previous);
    await confirmSurvey(db, token, "DeliveryStudentPassword42");
    expect((await row(survey.id)).confirmedAt).not.toBeNull();
  });

  it("publishes only the accepted replacement when concurrent delivery is mixed", async () => {
    const { survey, token } = await signup();
    const started = gate();
    const release = gate();
    let calls = 0;
    let winner = "";
    transport(async (message) => {
      const index = ++calls;
      if (index === 1) winner = mailToken(message);
      if (index === 2) started.open();
      await release.promise;
      return index === 1 ? accepted(message) : rejected(message);
    });
    const requests = [
      actor().studentWorkflow.resend({ id: survey.id }),
      actor().studentWorkflow.resend({ id: survey.id }),
    ];
    const work = Promise.all(requests);
    const settled = Promise.allSettled([...requests, work]);
    try {
      await entered(started.promise);
    } finally {
      release.open();
      await settled;
    }
    expect((await work).map((result) => result.emailSent).sort()).toEqual([
      false,
      true,
    ]);
    expect((await challenge(survey.id)).tokenHash).toBe(digest(winner));
    await expect(inspectSurvey(db, token)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await confirmSurvey(db, winner, "DeliveryStudentPassword42");
    expect((await row(survey.id)).confirmedAt).not.toBeNull();
  });

  it("reports a slow accepted resend as superseded without overwriting the winner", async () => {
    const { survey } = await signup();
    const started = gate();
    const release = gate();
    let calls = 0;
    let stale = "";
    let winner = "";
    transport(async (message) => {
      if (++calls === 1) {
        stale = mailToken(message);
        started.open();
        await release.promise;
      } else winner = mailToken(message);
      return accepted(message);
    });
    let receiptReturned = false;
    const slow = actor()
      .studentWorkflow.resend({ id: survey.id })
      .then((result) => {
        receiptReturned = true;
        return result;
      });
    const settled = Promise.allSettled([slow]);
    let winningChallenge: Awaited<ReturnType<typeof challenge>>;
    try {
      await entered(started.promise);
      // The database audit has committed, but the API must still wait for its
      // owner's queued send/publication rather than exposing a pending receipt.
      await durableAudit("studentWorkflow.resend");
      expect(receiptReturned).toBe(false);
      await expect(
        actor().studentWorkflow.resend({ id: survey.id }),
      ).resolves.toEqual({ emailSent: true });
      winningChallenge = await challenge(survey.id);
      expect(winningChallenge.tokenHash).toBe(digest(winner));
    } finally {
      release.open();
      await settled;
    }
    await expect(slow).resolves.toEqual({ emailSent: false });
    expect(await challenge(survey.id)).toEqual(winningChallenge);
    await expect(inspectSurvey(db, stale)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await confirmSurvey(db, winner, "DeliveryStudentPassword42");
    expect((await row(survey.id)).confirmedAt).not.toBeNull();
  });
});

it.each(outcomes)(
  "approval reports %s delivery only after the decision commits and rejects replay",
  async (outcome) => {
    const { survey } = await signup();
    const ticket = await ready("delivery-coordinator", survey.id);
    await expect(
      actor("delivery-coordinator", "COORDINATOR").studentWorkflow.assign(
        assignment(survey.id, ticket),
      ),
    ).rejects.toMatchObject({ cause: expect.any(ApprovalQueued) as unknown });
    const proposal = await db.approvalRequest.findFirstOrThrow();
    expect(smtp.send).not.toHaveBeenCalled();
    expect(await db.pairing.count()).toBe(0);
    expect(
      (
        await db.studentActionConfirmation.findUniqueOrThrow({
          where: { id: ticket },
        })
      ).usedAt,
    ).not.toBeNull();
    await expect(
      actor().approval.decide({
        id: proposal.id,
        approve: true,
        note: "Reviewed assignment",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      actor().approval.decide({
        id: proposal.id,
        approve: true,
        note: "Reviewed assignment",
        ticket,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    deliveryOutcome(outcome, async () => {
      expect(
        (
          await db.approvalRequest.findUniqueOrThrow({
            where: { id: proposal.id },
          })
        ).state,
      ).toBe("APPROVED");
      expect(await db.pairingTutee.count()).toBe(1);
      expect(
        await db.auditLog.count({
          where: { approvalId: proposal.id, kind: "DECISION" },
        }),
      ).toBe(1);
    });
    const reviewTicket = await ready("delivery-admin", survey.id);
    const result = await actor().approval.decide({
      id: proposal.id,
      approve: true,
      note: "Reviewed assignment",
      ticket: reviewTicket,
    });
    expect(result).toMatchObject({
      state: "APPROVED",
      emailSent: outcome === "accepted",
    });
    expect(smtp.send).toHaveBeenCalledTimes(outcome === "unavailable" ? 0 : 1);
    expect(
      (
        await db.studentActionConfirmation.findUniqueOrThrow({
          where: { id: reviewTicket },
        })
      ).usedAt,
    ).not.toBeNull();
    await expect(
      actor().approval.decide({
        id: proposal.id,
        approve: true,
        note: "Repeat decision",
        ticket: reviewTicket,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.pairing.count()).toBe(1);
    expect(smtp.send).toHaveBeenCalledTimes(outcome === "unavailable" ? 0 : 1);
    expect((await row(survey.id)).submittedAt).toEqual(survey.submittedAt);
  },
);

it("retains an applied approval when its post-commit delivery lookup fails", async () => {
  const { survey } = await signup();
  const previous = await challenge(survey.id);
  const ticket = await ready("delivery-coordinator", survey.id);
  await expect(
    actor("delivery-coordinator", "COORDINATOR").studentWorkflow.assign(
      assignment(survey.id, ticket),
    ),
  ).rejects.toMatchObject({ cause: expect.any(ApprovalQueued) as unknown });
  const proposal = await db.approvalRequest.findFirstOrThrow();
  const reviewTicket = await ready("delivery-admin", survey.id);
  const original = db.studentSurvey.findUnique.bind(db.studentSurvey);
  let outsideLookups = 0;
  // Transaction-scoped replay keeps its real Prisma reads. Only delivery's root
  // client lookup fails, after the decision and its assignment have committed.
  const lookup = vi
    .spyOn(db.studentSurvey, "findUnique")
    .mockImplementation((...args) => {
      if (!databaseScope.getStore()) {
        outsideLookups += 1;
        throw new Error("Synthetic post-commit lookup outage");
      }
      return original(...args);
    });
  try {
    await expect(
      actor().approval.decide({
        id: proposal.id,
        approve: true,
        note: "Reviewed assignment",
        ticket: reviewTicket,
      }),
    ).resolves.toMatchObject({ state: "APPROVED", emailSent: false });
  } finally {
    lookup.mockRestore();
  }
  expect(outsideLookups).toBe(1);
  expect(smtp.send).not.toHaveBeenCalled();
  expect(await db.pairingTutee.count()).toBe(1);
  expect(await challenge(survey.id)).toEqual(previous);
  expect(
    (await db.approvalRequest.findUniqueOrThrow({ where: { id: proposal.id } }))
      .state,
  ).toBe("APPROVED");
  expect(
    await db.auditLog.count({
      where: { approvalId: proposal.id, kind: "DECISION" },
    }),
  ).toBe(1);
  expect(
    (
      await db.studentActionConfirmation.findUniqueOrThrow({
        where: { id: reviewTicket },
      })
    ).usedAt,
  ).not.toBeNull();
  await expect(
    actor().approval.decide({
      id: proposal.id,
      approve: true,
      note: "Repeat decision",
      ticket: reviewTicket,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.pairingTutee.count()).toBe(1);
  expect(smtp.send).not.toHaveBeenCalled();
});
