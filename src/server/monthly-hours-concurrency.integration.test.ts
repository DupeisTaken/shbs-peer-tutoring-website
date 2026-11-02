import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import type { MockInstance } from "vitest";
import type {
  MonthlyHoursSchedule,
  ProgramFeature,
  ProgramSettings,
} from "../../generated/prisma";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { ApprovalQueued } from "~/server/approvals";
import { emailSender, type EmailSender } from "~/server/email/sender";
import { lockEntity } from "~/server/transactions";
import { databaseScope } from "~/server/db-scope";
import { monthlyHoursLock, sweepMonthlyHours } from "./monthly-hours";
import { admitMonthlyHoursDelivery } from "./monthly-hours-delivery";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const prefix = "monthly-hours-concurrency-";
const adminId = `${prefix}admin`;
const coordinatorId = `${prefix}coordinator`;
const reportId = `${prefix}saved-report`;
const deliveryId = `${prefix}delivery`;
const automaticMonth = "1987-10";
const automaticKey = `automatic:${automaticMonth}`;
const preservedAutomaticReports = new Set<string>();
let savedSchedule: MonthlyHoursSchedule | null;
let savedSettings: ProgramSettings | null;
let savedFeature: ProgramFeature | null;
let sendSpy: MockInstance<EmailSender["send"]>;

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A missing production lock fails promptly instead of leaving a transaction
 * or the local database waiting after the test completes. */
async function deadline<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label}`)),
          5_000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type SqlObservation = {
  sql: string;
  parameters: readonly unknown[];
  phase: "before" | "after";
};

/** Observe real PostgreSQL operations without replacing their lock, transaction,
 * isolation or result. Hooks provide deterministic overlap rather than sleeps. */
function observedDatabase(
  observe: (query: SqlObservation) => Promise<void> | void,
): typeof db {
  const transaction = (tx: TransactionDb): TransactionDb =>
    new Proxy(tx, {
      get(target, key) {
        // Audited API transactions can pass a scope-aware client here. Read its
        // underlying delegate outside that scope before wrapping it, otherwise
        // replay would resolve this observing proxy through itself recursively.
        const value = databaseScope.exit(() => {
          const delegate: unknown = Reflect.get(target, key);
          return delegate;
        });
        if (key === "$executeRaw" || key === "$queryRaw") {
          return async (
            query: TemplateStringsArray | { text: string; values: unknown[] },
            ...values: unknown[]
          ) => {
            // Approval reference capture also uses Prisma.sql objects. Observe
            // their text/values while passing the original query through intact.
            const sql = "text" in query ? query.text : query.join("?");
            const parameters = "text" in query ? query.values : values;
            await observe({ sql, parameters, phase: "before" });
            const result: unknown = await Reflect.apply(
              value as (...args: unknown[]) => Promise<unknown>,
              target,
              [query, ...values],
            );
            await observe({ sql, parameters, phase: "after" });
            return result;
          };
        }
        return typeof value === "function"
          ? (value.bind(target) as unknown)
          : value;
      },
    });
  return new Proxy(db, {
    get(target, key) {
      if (key === "$transaction")
        return (
          work: (tx: TransactionDb) => Promise<unknown>,
          options?: {
            isolationLevel?:
              "ReadCommitted" | "RepeatableRead" | "Serializable";
            timeout?: number;
            maxWait?: number;
          },
        ) =>
          target.$transaction((tx) => work(transaction(tx)), {
            timeout: 12_000,
            ...options,
          });
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function"
        ? (value.bind(target) as unknown)
        : value;
    },
  });
}

const advisory = (query: SqlObservation, key: string) =>
  query.sql.includes("pg_advisory_xact_lock") &&
  (query.parameters.includes(key) || query.sql.includes(`'${key}'`));
const actor = (role: "ADMIN" | "COORDINATOR" = "ADMIN", database = db) =>
  createCaller({
    db: database,
    headers: new Headers(),
    session: {
      user: {
        id: role === "ADMIN" ? adminId : coordinatorId,
        name: `Synthetic ${role}`,
      },
      role,
      tutorId: null,
      expires: "2099-01-01T00:00:00Z",
    },
  });

async function cleanup() {
  const proposals = await db.approvalRequest.findMany({
    where: { requesterId: coordinatorId },
    select: { id: true },
  });
  const links = proposals.map(
    (proposal) => `/admin/approvals?request=${proposal.id}`,
  );
  const automatic = await db.monthlyHoursReport.findMany({
    where: { generationKey: automaticKey },
    select: { id: true },
  });
  const reportIds = [
    reportId,
    ...automatic
      .filter((report) => !preservedAutomaticReports.has(report.id))
      .map((report) => report.id),
  ];
  await db.emailDelivery.deleteMany({
    where: {
      OR: [
        { monthlyHoursReportId: { in: reportIds } },
        { userId: { in: [adminId, coordinatorId] } },
        { destination: { in: links } },
      ],
    },
  });
  await db.notification.deleteMany({
    where: {
      OR: [
        { userId: { in: [adminId, coordinatorId] } },
        { link: { in: links } },
      ],
    },
  });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { userId: { in: [adminId, coordinatorId] } },
        { entityId: { in: reportIds } },
        { approvalId: { in: proposals.map((proposal) => proposal.id) } },
      ],
    },
  });
  await db.approvalRequest.deleteMany({
    where: { requesterId: coordinatorId },
  });
  await db.monthlyHoursReport.deleteMany({ where: { id: { in: reportIds } } });
}

beforeAll(async () => {
  [savedSchedule, savedSettings, savedFeature] = await Promise.all([
    db.monthlyHoursSchedule.findUnique({ where: { id: "program" } }),
    db.programSettings.findUnique({ where: { id: "program" } }),
    db.programFeature.findUnique({ where: { key: "SERVICE_HOURS" } }),
  ]);
  for (const report of await db.monthlyHoursReport.findMany({
    where: { generationKey: automaticKey },
    select: { id: true },
  }))
    preservedAutomaticReports.add(report.id);
  await db.user.createMany({
    data: [
      {
        id: adminId,
        role: "ADMIN",
        name: "Synthetic report reviewer",
        email: `${adminId}@example.test`,
        emailInfo: true,
        emailVerifiedAt: new Date("1987-01-01T00:00:00Z"),
      },
      {
        id: coordinatorId,
        role: "COORDINATOR",
        name: "Synthetic proposer",
        email: `${coordinatorId}@example.test`,
      },
    ],
  });
});

beforeEach(async () => {
  await cleanup();
  sendSpy = vi.spyOn(emailSender, "send").mockResolvedValue(undefined);
  await db.user.update({ where: { id: adminId }, data: { emailInfo: true } });
  await db.programSettings.upsert({
    where: { id: "program" },
    create: { id: "program", emailNotificationsEnabled: true },
    update: { emailNotificationsEnabled: true },
  });
  await db.programFeature.upsert({
    where: { key: "SERVICE_HOURS" },
    create: { key: "SERVICE_HOURS", enabled: true },
    update: { enabled: true },
  });
  const config = {
    enabled: true,
    recipientUserIds: [adminId],
    version: 1,
    dayOfMonth: 3,
    localTime: "09:00",
    timeZone: "Asia/Shanghai",
    firstReportMonth: automaticMonth,
    nextReportMonth: automaticMonth,
    nextDueAt: new Date("1987-11-03T01:00:00Z"),
    lastGenerationError: null,
  };
  await db.monthlyHoursSchedule.upsert({
    where: { id: "program" },
    create: { id: "program", ...config },
    update: config,
  });
  await db.monthlyHoursReport.create({
    data: {
      id: reportId,
      scheduleId: "program",
      month: "1987-09",
      revision: 1,
      configVersion: 1,
      timeZone: "Asia/Shanghai",
      contentHash: "a".repeat(64),
      generationKey: `${prefix}saved`,
      generationHash: "b".repeat(64),
      generatedById: adminId,
      intendedRecipients: [
        {
          userId: adminId,
          name: "Synthetic report reviewer",
          role: "ADMIN",
          email: `${adminId}@example.test`,
          status: "QUEUED",
          reason: null,
        },
      ],
      snapshot: {
        schemaVersion: 1,
        month: "1987-09",
        rows: [],
        totals: {
          tutors: 0,
          sessions: 0,
          earned: 0,
          extras: 0,
          punishments: 0,
          total: 0,
        },
      },
    },
  });
  await db.emailDelivery.create({
    data: {
      id: deliveryId,
      userId: adminId,
      monthlyHoursReportId: reportId,
      recipient: `${adminId}@example.test`,
      category: "monthly_hours",
      event: "monthly_hours_report",
      leaseUntil: new Date(Date.now() + 300_000),
    },
  });
});

afterEach(() => {
  expect(sendSpy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
afterAll(async () => {
  try {
    await cleanup();
    await db.user.deleteMany({
      where: { id: { in: [adminId, coordinatorId] } },
    });
    if (savedSchedule)
      await db.monthlyHoursSchedule.update({
        where: { id: "program" },
        data: savedSchedule,
      });
    else await db.monthlyHoursSchedule.deleteMany({ where: { id: "program" } });
    if (savedSettings)
      await db.programSettings.update({
        where: { id: "program" },
        data: {
          emailNotificationsEnabled: savedSettings.emailNotificationsEnabled,
        },
      });
    else await db.programSettings.deleteMany({ where: { id: "program" } });
    if (savedFeature)
      await db.programFeature.update({
        where: { key: "SERVICE_HOURS" },
        data: savedFeature,
      });
    else
      await db.programFeature.deleteMany({ where: { key: "SERVICE_HOURS" } });
  } finally {
    await db.$disconnect();
  }
});

async function admission(database = db) {
  const row = await db.emailDelivery.findUniqueOrThrow({
    where: { id: deliveryId },
  });
  return admitMonthlyHoursDelivery(
    database,
    deliveryId,
    row.leaseUntil,
    row.attemptId,
  );
}

it("a concurrent preference opt-out completes before the waiting report is admitted", async () => {
  const preferenceLocked = gate<void>();
  const admissionRequestsGlobal = gate<void>();
  const preferenceDatabase = observedDatabase(async (query) => {
    if (
      query.phase === "after" &&
      advisory(query, "email-notifications-setting")
    ) {
      preferenceLocked.resolve();
      await deadline(
        admissionRequestsGlobal.promise,
        "admission's email fence",
      );
    }
  });
  const admissionDatabase = observedDatabase((query) => {
    if (
      query.phase === "before" &&
      advisory(query, "email-notifications-setting")
    )
      admissionRequestsGlobal.resolve();
  });
  const preference = actor(
    "ADMIN",
    preferenceDatabase,
  ).account.setEmailPreferences({
    emailMessages: false,
    emailInfo: false,
    emailSecondaryRecipients: false,
  });
  void preference.catch(() => undefined);
  let pending: ReturnType<typeof admission> | undefined;
  try {
    await deadline(
      preferenceLocked.promise,
      "preference transaction's email fence",
    );
    pending = admission(admissionDatabase);
    void pending.catch(() => undefined);
    await expect(preference).resolves.toEqual({ ok: true });
    await expect(pending).resolves.toBeNull();
    expect(
      await db.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } }),
    ).toMatchObject({ status: "SKIPPED", lastError: "OPTED_OUT" });
  } finally {
    admissionRequestsGlobal.resolve();
    await Promise.allSettled([preference, ...(pending ? [pending] : [])]);
  }
}, 20_000);

it("waits for an effective feature change under the program-period fence before admission", async () => {
  const periodLocked = gate<void>();
  const requestedFence = gate<string>();
  const admissionDatabase = observedDatabase((query) => {
    if (
      query.phase === "before" &&
      query.sql.includes("pg_advisory_xact_lock")
    ) {
      const key = query.parameters.find(
        (value): value is string => typeof value === "string",
      );
      if (key) requestedFence.resolve(key);
    }
  });
  const featureChange = db.$transaction(
    async (tx) => {
      await lockEntity(tx, "program:period");
      periodLocked.resolve();
      expect(
        await deadline(requestedFence.promise, "admission's period fence"),
      ).toBe("program:period");
      await tx.programFeature.update({
        where: { key: "SERVICE_HOURS" },
        data: { enabled: false },
      });
    },
    { timeout: 12_000 },
  );
  void featureChange.catch(() => undefined);
  let pending: ReturnType<typeof admission> | undefined;
  try {
    await deadline(periodLocked.promise, "feature writer's period fence");
    pending = admission(admissionDatabase);
    void pending.catch(() => undefined);
    await featureChange;
    await expect(pending).resolves.toBeNull();
    expect(
      await db.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } }),
    ).toMatchObject({ status: "SKIPPED", lastError: "FEATURE_OFF" });
  } finally {
    requestedFence.resolve("cancelled");
    await Promise.allSettled([featureChange, ...(pending ? [pending] : [])]);
  }
}, 20_000);

/** Pause actual admission after its recipient lock. The competing operation
 * releases it when requesting its outer fence; old schedule-first code instead
 * releases it only after owning the schedule, reproducing the former cycle. */
function overlappingAdmission() {
  const accountLocked = gate<void>();
  const proceed = gate<void>();
  const admissionDatabase = observedDatabase(async (query) => {
    if (
      query.phase === "after" &&
      query.sql.includes('FROM "User"') &&
      query.sql.includes("FOR UPDATE") &&
      query.parameters.includes(adminId)
    ) {
      accountLocked.resolve();
      await deadline(proceed.promise, "competing operation's outer fence");
    }
  });
  const competingDatabase = observedDatabase((query) => {
    if (
      (query.phase === "before" &&
        (advisory(query, "program:period") ||
          advisory(query, "identity:username-namespace"))) ||
      (query.phase === "after" && advisory(query, monthlyHoursLock))
    )
      proceed.resolve();
  });
  return { accountLocked, proceed, admissionDatabase, competingDatabase };
}

it("an approving report recipient and their in-flight admission do not invert account and schedule locks", async () => {
  const failure: unknown = await actor("COORDINATOR")
    .monthlyHours.save({
      enabled: true,
      recipientUserIds: [adminId],
      expectedVersion: 1,
      dayOfMonth: 4,
      localTime: "09:00",
      timeZone: "Asia/Shanghai",
    })
    .catch((error: unknown) => error);
  expect((failure as { cause?: unknown }).cause).toBeInstanceOf(ApprovalQueued);
  const proposalId = (failure as { cause: ApprovalQueued }).cause.approvalId;
  const overlap = overlappingAdmission();
  const pending = admission(overlap.admissionDatabase);
  void pending.catch(() => undefined);
  let review: Promise<unknown> | undefined;
  try {
    await deadline(overlap.accountLocked.promise, "admission's recipient lock");
    review = actor("ADMIN", overlap.competingDatabase).approval.decide({
      id: proposalId,
      approve: true,
      note: "Synthetic concurrent report configuration review",
    });
    void review.catch(() => undefined);
    const [admitted] = await Promise.all([pending, review]);
    expect(admitted).not.toBeNull();
    expect(
      (
        await db.approvalRequest.findUniqueOrThrow({
          where: { id: proposalId },
        })
      ).state,
    ).toBe("APPROVED");
    expect(
      await db.monthlyHoursSchedule.findUniqueOrThrow({
        where: { id: "program" },
      }),
    ).toMatchObject({ version: 2, dayOfMonth: 4 });
  } finally {
    overlap.proceed.resolve();
    await Promise.allSettled([pending, ...(review ? [review] : [])]);
  }
}, 20_000);

it("automatic snapshot insertion and an admitted recipient do not invert schedule and delivery foreign-key locks", async () => {
  const overlap = overlappingAdmission();
  const pending = admission(overlap.admissionDatabase);
  void pending.catch(() => undefined);
  let generation: ReturnType<typeof sweepMonthlyHours> | undefined;
  try {
    await deadline(overlap.accountLocked.promise, "admission's recipient lock");
    generation = sweepMonthlyHours(
      overlap.competingDatabase,
      new Date("1987-11-04T00:00:00Z"),
    );
    expect(await pending).not.toBeNull();
    await expect(generation).resolves.toEqual({ generated: 1 });
    const report = await db.monthlyHoursReport.findUniqueOrThrow({
      where: { generationKey: automaticKey },
    });
    expect(
      await db.emailDelivery.count({
        where: { monthlyHoursReportId: report.id, userId: adminId },
      }),
    ).toBe(1);
  } finally {
    overlap.proceed.resolve();
    await Promise.allSettled([pending, ...(generation ? [generation] : [])]);
  }
}, 20_000);
