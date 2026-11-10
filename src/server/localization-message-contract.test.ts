import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Session } from "next-auth";
import type { Prisma } from "../../generated/prisma";
import superjson from "superjson";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import { getMessageFallback, onIntlError } from "~/i18n/fallback";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { queueProposal } from "~/server/approvals";

const accounts = {
  publisher: { id: "audit-icu-publisher", role: "ADMIN" },
  author: { id: "audit-icu-author", role: "STUDENT" },
  coordinator: { id: "contract-icu-coordinator", role: "COORDINATOR" },
} as const;
type Actor = keyof typeof accounts;
const caller = (actor: Actor) => {
  const account = accounts[actor];
  return createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: account.id, name: "Synthetic ICU audit" },
      role: account.role as Session["role"],
      tutorId: null,
      sessionVersion: 0,
      historyAccessRevision: 0,
      expires: "2099-01-01",
    },
  });
};

beforeEach(async () => {
  // No fixed port/database name: root owns an isolated local *_test target.
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.user.createMany({
    data: Object.entries(accounts).map(([actor, account]) => ({
      ...account,
      email: `audit-icu-${actor}@example.test`,
      name: "Synthetic ICU audit",
      canTranslate: true,
    })),
  });
});
afterAll(() => db.$disconnect());

// implementation.md:165 requires ICU arguments/plural branches to survive
// display-text edits. Syntax-only parsing does not enforce the caller contract.
const invalidEdits = [
  {
    scenario: "adds an unsupplied variable",
    key: "common.save",
    value: "Save {auditVariable}",
  },
  {
    scenario: "drops the required deadline",
    key: "sessionPlanning.respondBy",
    value: "Respond promptly",
  },
  {
    scenario: "renames the required deadline",
    key: "sessionPlanning.respondBy",
    value: "Respond by {auditDeadline}",
  },
  {
    scenario: "adds an unsupplied rich-text callback",
    key: "common.save",
    value: "Save <auditTag>changes</auditTag>",
  },
  {
    scenario: "changes a deadline string to a numeric formatter",
    key: "sessionPlanning.respondBy",
    value: "Respond by {deadline, number}",
  },
  {
    scenario: "changes a deadline string to a numeric plural",
    key: "sessionPlanning.respondBy",
    value: "{deadline, plural, one {One day} other {# days}}",
  },
  {
    scenario: "replaces a supplied rich callback with an ordinary value",
    key: "public.signup.agree",
    value: "Accept {appTitle} {policy}",
  },
] as const;

it.each(
  (["publisher", "author", "coordinator"] as const).flatMap((actor) =>
    invalidEdits.map((edit) => ({ actor, ...edit })),
  ),
)(
  "$actor rejects an override that $scenario before storing or proposing it",
  async ({ actor, key, value }) => {
    await expect(
      caller(actor).localization.setString({ locale: "en", key, value }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.messageOverride.count()).toBe(0);
    expect(await db.translationDraft.count()).toBe(0);
    expect(await db.notification.count()).toBe(0);
  },
);

it("the real publisher stores a literal replacement and it renders without formatting errors", async () => {
  await caller("publisher").localization.setString({
    locale: "en",
    key: "common.save",
    value: "Save reviewed changes",
  });
  const saved = await db.messageOverride.findUniqueOrThrow({
    where: { locale_key: { locale: "en", key: "common.save" } },
  });
  const onError = vi.fn();
  const translate = createTranslator({
    locale: "en",
    messages: { ...en, common: { ...en.common, save: saved.value } },
    onError,
    getMessageFallback,
  });
  // /admin/landing -> Main Page Content uses this exact zero-values call.
  expect(translate("common.save")).toBe("Save reviewed changes");
  expect(onError).not.toHaveBeenCalled();
  expect(await db.translationDraft.count()).toBe(0);
});

it("a Translator's compatible draft publishes through the real review caller", async () => {
  const value = "Please respond before {deadline}";
  await caller("author").localization.setString({
    locale: "en",
    key: "sessionPlanning.respondBy",
    value,
  });
  expect(await db.messageOverride.count()).toBe(0);
  const draft = await db.translationDraft.findFirstOrThrow();
  expect(draft).toMatchObject({
    authorId: accounts.author.id,
    state: "PENDING",
    operation: "localization.setString",
  });
  await caller("publisher").translationReview.decide({
    id: draft.id,
    approve: true,
    expectedUpdatedAt: draft.updatedAt,
  });
  const saved = await db.messageOverride.findUniqueOrThrow({
    where: { locale_key: { locale: "en", key: "sessionPlanning.respondBy" } },
  });
  expect(saved.value).toBe(value);
  expect(
    (await db.translationDraft.findUniqueOrThrow({ where: { id: draft.id } }))
      .state,
  ).toBe("APPROVED");
  const onError = vi.fn();
  const translate = createTranslator({
    locale: "en",
    messages: {
      ...en,
      sessionPlanning: { ...en.sessionPlanning, respondBy: saved.value },
    },
    onError,
    getMessageFallback,
  });
  expect(
    translate("sessionPlanning.respondBy", { deadline: "Synthetic Monday" }),
  ).toBe("Please respond before Synthetic Monday");
  expect(onError).not.toHaveBeenCalled();
});

it("reviewing a historical incompatible pending draft cannot publish it or finalize its decision", async () => {
  await caller("author").localization.setString({
    locale: "en",
    key: "common.save",
    value: "Save reviewed changes",
  });
  const draft = await db.translationDraft.findFirstOrThrow();
  // Model a pending draft accepted by an older syntax-only writer. Preserve the
  // real caller's current destination fingerprint so staleness cannot mask ICU validation.
  const legacy = await db.translationDraft.update({
    where: { id: draft.id },
    data: {
      payload: {
        ...(draft.payload as Prisma.InputJsonObject),
        value: "Save {auditVariable}",
      },
    },
  });
  const before = {
    notifications: await db.notification.count(),
    appliedAudits: await db.auditLog.count({
      where: { kind: { not: "ATTEMPT" } },
    }),
    attempts: await db.auditLog.count({
      where: { kind: "ATTEMPT", operation: "translationReview.decide" },
    }),
  };
  await expect(
    caller("publisher").translationReview.decide({
      id: legacy.id,
      approve: true,
      expectedUpdatedAt: legacy.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.messageOverride.count()).toBe(0);
  expect(
    (await db.translationDraft.findUniqueOrThrow({ where: { id: legacy.id } }))
      .state,
  ).toBe("PENDING");
  expect(await db.notification.count()).toBe(before.notifications);
  expect(await db.auditLog.count({ where: { kind: { not: "ATTEMPT" } } })).toBe(
    before.appliedAudits,
  );
  expect(
    await db.auditLog.count({
      where: { kind: "ATTEMPT", operation: "translationReview.decide" },
    }),
  ).toBe(before.attempts + 1);
  expect(
    await db.auditLog.findFirst({
      where: { kind: "ATTEMPT", operation: "translationReview.decide" },
      orderBy: { createdAt: "desc" },
    }),
  ).toMatchObject({
    details: { outcome: "FAILED", applied: false, errorCode: "BAD_REQUEST" },
  });
  // Refusing publication does not prevent the reviewer from rejecting unsafe
  // retained evidence through the ordinary decision path.
  await caller("publisher").translationReview.decide({
    id: legacy.id,
    approve: false,
    expectedUpdatedAt: legacy.updatedAt,
  });
  expect(
    (await db.translationDraft.findUniqueOrThrow({ where: { id: legacy.id } }))
      .state,
  ).toBe("REJECTED");
  expect(await db.messageOverride.count()).toBe(0);
});

it.each(["{count, plural, other {# 门已审核科目}}", "{count} 门已审核科目"])(
  "publishes a compatible Chinese numeric message: %s",
  async (value) => {
    await caller("publisher").localization.setString({
      locale: "zh",
      key: "workflows.qualificationCount",
      value,
    });
    const saved = await db.messageOverride.findUniqueOrThrow({
      where: {
        locale_key: { locale: "zh", key: "workflows.qualificationCount" },
      },
    });
    const onError = vi.fn();
    const translate = createTranslator({
      locale: "zh",
      messages: {
        ...zh,
        workflows: { ...zh.workflows, qualificationCount: saved.value },
      },
      onError,
      getMessageFallback,
    });
    expect(translate("workflows.qualificationCount", { count: 1 })).toBe(
      "1 门已审核科目",
    );
    expect(translate("workflows.qualificationCount", { count: 3 })).toBe(
      "3 门已审核科目",
    );
    expect(onError).not.toHaveBeenCalled();
  },
);

it("publishes compatible rich policy text using only the real caller's callbacks", async () => {
  const value = "<policy>{appTitle} policy</policy> reviewed and accepted";
  await caller("publisher").localization.setString({
    locale: "en",
    key: "public.signup.agree",
    value,
  });
  const saved = await db.messageOverride.findUniqueOrThrow({
    where: { locale_key: { locale: "en", key: "public.signup.agree" } },
  });
  const onError = vi.fn();
  const translate = createTranslator({
    locale: "en",
    messages: {
      ...en,
      public: {
        ...en.public,
        signup: { ...en.public.signup, agree: saved.value },
      },
    },
    onError,
    getMessageFallback,
  });
  const rendered = translate.rich("public.signup.agree", {
    appTitle: "Synthetic",
    policy: (chunks) =>
      createElement("a", { href: "/synthetic-policy" }, chunks),
  });
  expect(renderToStaticMarkup(createElement("div", null, rendered))).toBe(
    '<div><a href="/synthetic-policy">Synthetic policy</a> reviewed and accepted</div>',
  );
  expect(onError).not.toHaveBeenCalled();
});

it.each(["", "   ", zh.workflows.qualificationCount])(
  "keeps explicit clear/default repair available for a legacy unsafe override: %j",
  async (value) => {
    await db.messageOverride.create({
      data: {
        locale: "zh",
        key: "workflows.qualificationCount",
        value: "Unsafe {unexpected}",
      },
    });
    expect(
      await caller("publisher").localization.setString({
        locale: "zh",
        key: "workflows.qualificationCount",
        value,
      }),
    ).toEqual({ ok: true, cleared: true });
    expect(await db.messageOverride.count()).toBe(0);
    expect(await db.translationDraft.count()).toBe(0);
  },
);

it("leaves the stored override unchanged after an incompatible attempted correction", async () => {
  const old = await db.messageOverride.create({
    data: {
      locale: "en",
      key: "sessionPlanning.respondBy",
      value: "Legacy unsafe {oldArgument}",
    },
  });
  await expect(
    caller("publisher").localization.setString({
      locale: "en",
      key: "sessionPlanning.respondBy",
      value: "Respond by {deadline, number}",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    await db.messageOverride.findUniqueOrThrow({ where: { id: old.id } }),
  ).toEqual(old);
  expect(await db.translationDraft.count()).toBe(0);
  expect(await db.notification.count()).toBe(0);
});

it("keeps a Translator clear as a reviewed draft rather than clearing the live override immediately", async () => {
  await caller("publisher").localization.setString({
    locale: "en",
    key: "sessionPlanning.respondBy",
    value: "Reply before {deadline}",
  });
  await caller("author").localization.setString({
    locale: "en",
    key: "sessionPlanning.respondBy",
    value: "",
  });
  expect(await db.messageOverride.count()).toBe(1);
  const draft = await db.translationDraft.findFirstOrThrow();
  await caller("publisher").translationReview.decide({
    id: draft.id,
    approve: true,
    expectedUpdatedAt: draft.updatedAt,
  });
  expect(await db.messageOverride.count()).toBe(0);
  expect(
    (await db.translationDraft.findUniqueOrThrow({ where: { id: draft.id } }))
      .state,
  ).toBe("APPROVED");
});

it("revalidates a compatible Coordinator draft during the real queued approval replay", async () => {
  const value = "Respond no later than {deadline}";
  await caller("coordinator").localization.setString({
    locale: "en",
    key: "sessionPlanning.respondBy",
    value,
  });
  const draft = await db.translationDraft.findFirstOrThrow();
  await expect(
    caller("coordinator").translationReview.decide({
      id: draft.id,
      approve: true,
      expectedUpdatedAt: draft.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const approval = await db.approvalRequest.findFirstOrThrow();
  // Review publication grants only the validated draft operation, never an
  // independent translator assignment to the reviewing management account.
  await db.user.update({
    where: { id: accounts.publisher.id },
    data: { canTranslate: false },
  });
  await caller("publisher").approval.decide({
    id: approval.id,
    approve: true,
    note: "Checked the unchanged deadline contract",
  });
  expect(
    (await db.translationDraft.findUniqueOrThrow({ where: { id: draft.id } }))
      .state,
  ).toBe("APPROVED");
  expect(
    (await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } }))
      .state,
  ).toBe("APPROVED");
  expect(
    (
      await db.messageOverride.findUniqueOrThrow({
        where: {
          locale_key: { locale: "en", key: "sessionPlanning.respondBy" },
        },
      })
    ).value,
  ).toBe(value);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: accounts.publisher.id } }))
      .canTranslate,
  ).toBe(false);
});

it("atomically refuses an unsafe historical draft during queued approval replay", async () => {
  await caller("coordinator").localization.setString({
    locale: "en",
    key: "common.save",
    value: "Save reviewed changes",
  });
  const draft = await db.translationDraft.findFirstOrThrow();
  const legacy = await db.translationDraft.update({
    where: { id: draft.id },
    data: {
      payload: {
        ...(draft.payload as Prisma.InputJsonObject),
        value: "Save {unsupported}",
      },
    },
  });
  // Reproduce a request stored by the old admission boundary. Current HTTP
  // review requests now reject this payload before creating an ApprovalRequest.
  const coordinatorSession: Session = {
    user: {
      id: accounts.coordinator.id,
      name: "Synthetic ICU review requester",
    },
    role: "COORDINATOR",
    tutorId: null,
    sessionVersion: 0,
    historyAccessRevision: 0,
    expires: "2099-01-01",
  };
  const approval = await queueProposal(
    coordinatorSession,
    "translationReview.decide",
    {
      id: legacy.id,
      approve: true,
      expectedUpdatedAt: legacy.updatedAt,
    },
  );
  const before = {
    notifications: await db.notification.count(),
    appliedAudits: await db.auditLog.count({
      where: { kind: { not: "ATTEMPT" } },
    }),
    attempts: await db.auditLog.count({
      where: { kind: "ATTEMPT", operation: "approval.decide" },
    }),
  };
  await expect(
    caller("publisher").approval.decide({
      id: approval.id,
      approve: true,
      note: "Validate retained draft before publication",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.messageOverride.count()).toBe(0);
  expect(
    (await db.translationDraft.findUniqueOrThrow({ where: { id: legacy.id } }))
      .state,
  ).toBe("PENDING");
  expect(
    (await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } }))
      .state,
  ).toBe("PENDING");
  expect(await db.notification.count()).toBe(before.notifications);
  expect(await db.auditLog.count({ where: { kind: { not: "ATTEMPT" } } })).toBe(
    before.appliedAudits,
  );
  expect(
    await db.auditLog.count({
      where: { kind: "ATTEMPT", operation: "approval.decide" },
    }),
  ).toBe(before.attempts + 1);
  expect(
    await db.auditLog.findFirst({
      where: { kind: "ATTEMPT", operation: "approval.decide" },
      orderBy: { createdAt: "desc" },
    }),
  ).toMatchObject({
    details: { outcome: "FAILED", applied: false, errorCode: "BAD_REQUEST" },
  });
});

it("refuses an unsafe historical ICU approval intent before creating a Coordinator request or notices", async () => {
  await caller("author").localization.setString({
    locale: "en",
    key: "common.save",
    value: "Save reviewed changes",
  });
  const draft = await db.translationDraft.findFirstOrThrow();
  const unsafe = await db.translationDraft.update({
    where: { id: draft.id },
    data: {
      payload: {
        ...(draft.payload as Prisma.InputJsonObject),
        value: "Save {unsupported}",
      },
    },
  });
  const notifications = await db.notification.count();
  const appliedAudits = await db.auditLog.count({
    where: { kind: { not: "ATTEMPT" } },
  });
  await expect(
    caller("coordinator").translationReview.decide({
      id: unsafe.id,
      approve: true,
      expectedUpdatedAt: unsafe.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.approvalRequest.count()).toBe(0);
  expect(await db.notification.count()).toBe(notifications);
  expect(
    await db.translationDraft.findUniqueOrThrow({ where: { id: unsafe.id } }),
  ).toEqual(unsafe);
  expect(await db.messageOverride.count()).toBe(0);
  expect(await db.auditLog.count({ where: { kind: { not: "ATTEMPT" } } })).toBe(
    appliedAudits,
  );
  expect(
    await db.auditLog.findFirst({
      where: { kind: "ATTEMPT", operation: "translationReview.decide" },
    }),
  ).toMatchObject({
    details: { outcome: "FAILED", applied: false, errorCode: "BAD_REQUEST" },
  });
});

it.each(["stale version", "APPROVED", "REJECTED"] as const)(
  "refuses %s review intent before a Coordinator queue write",
  async (scenario) => {
    await caller("author").localization.setString({
      locale: "en",
      key: "common.save",
      value: "Save reviewed changes",
    });
    let draft = await db.translationDraft.findFirstOrThrow();
    if (scenario !== "stale version")
      draft = await db.translationDraft.update({
        where: { id: draft.id },
        data: { state: scenario },
      });
    const notifications = await db.notification.count();
    await expect(
      caller("coordinator").translationReview.decide({
        id: draft.id,
        approve: true,
        expectedUpdatedAt:
          scenario === "stale version"
            ? new Date(draft.updatedAt.getTime() - 1)
            : draft.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.approvalRequest.count()).toBe(0);
    expect(await db.notification.count()).toBe(notifications);
    expect(await db.messageOverride.count()).toBe(0);
    expect(
      await db.translationDraft.findUniqueOrThrow({ where: { id: draft.id } }),
    ).toEqual(draft);
  },
);

it("refuses a stale destination baseline before queuing a compatible approval intent", async () => {
  await caller("author").localization.setString({
    locale: "en",
    key: "sessionPlanning.respondBy",
    value: "Reply before {deadline}",
  });
  const draft = await db.translationDraft.findFirstOrThrow();
  await caller("publisher").localization.setString({
    locale: "en",
    key: "sessionPlanning.respondBy",
    value: "Current response deadline: {deadline}",
  });
  const notifications = await db.notification.count();
  await expect(
    caller("coordinator").translationReview.decide({
      id: draft.id,
      approve: true,
      expectedUpdatedAt: draft.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.approvalRequest.count()).toBe(0);
  expect(await db.notification.count()).toBe(notifications);
  expect(
    (await db.translationDraft.findUniqueOrThrow({ where: { id: draft.id } }))
      .state,
  ).toBe("PENDING");
});

it("queues one compatible current review intent under concurrent retries with its original immutable input", async () => {
  await caller("author").localization.setString({
    locale: "en",
    key: "sessionPlanning.respondBy",
    value: "Reply before {deadline}",
  });
  const draft = await db.translationDraft.findFirstOrThrow();
  // Reviewing a draft is management authority, independent of Translator assignment.
  await db.user.update({
    where: { id: accounts.coordinator.id },
    data: { canTranslate: false },
  });
  const input = {
    id: draft.id,
    approve: true,
    expectedUpdatedAt: draft.updatedAt,
  };
  const notices = await db.notification.count();
  const outcomes = await Promise.allSettled([
    caller("coordinator").translationReview.decide(input),
    caller("coordinator").translationReview.decide(input),
  ]);
  for (const outcome of outcomes) {
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected")
      expect(outcome.reason).toMatchObject({ code: "PRECONDITION_FAILED" });
  }
  expect(await db.approvalRequest.count()).toBe(1);
  const approval = await db.approvalRequest.findFirstOrThrow();
  expect(
    superjson.deserialize(
      approval.payload as unknown as Parameters<
        typeof superjson.deserialize
      >[0],
    ),
  ).toEqual(input);
  expect(approval).toMatchObject({
    requesterId: accounts.coordinator.id,
    operation: "translationReview.decide",
    state: "PENDING",
  });
  expect(await db.notification.count()).toBe(notices + 1);
  expect(
    await db.auditLog.count({
      where: {
        entity: "ApprovalRequest",
        entityId: approval.id,
        kind: "SUBMISSION",
      },
    }),
  ).toBe(1);
  expect(await db.messageOverride.count()).toBe(0);
  expect(
    await db.translationDraft.findUniqueOrThrow({ where: { id: draft.id } }),
  ).toEqual(draft);
});

it("preserves rejection of unsafe legacy drafts through Coordinator review without validating their publication content", async () => {
  await caller("author").localization.setString({
    locale: "en",
    key: "common.save",
    value: "Save reviewed changes",
  });
  const draft = await db.translationDraft.findFirstOrThrow();
  const unsafe = await db.translationDraft.update({
    where: { id: draft.id },
    data: {
      payload: {
        ...(draft.payload as Prisma.InputJsonObject),
        value: "Save {unsupported}",
      },
    },
  });
  await expect(
    caller("coordinator").translationReview.decide({
      id: unsafe.id,
      approve: false,
      expectedUpdatedAt: unsafe.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const approval = await db.approvalRequest.findFirstOrThrow();
  await caller("publisher").approval.decide({
    id: approval.id,
    approve: true,
    note: "Reject the unsafe historical translation",
  });
  expect(
    (await db.translationDraft.findUniqueOrThrow({ where: { id: unsafe.id } }))
      .state,
  ).toBe("REJECTED");
  expect(
    (await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } }))
      .state,
  ).toBe("APPROVED");
  expect(await db.messageOverride.count()).toBe(0);
});

it("does not let a stale Coordinator session queue a review after the account loses management authority", async () => {
  await caller("author").localization.setString({
    locale: "en",
    key: "common.save",
    value: "Save reviewed changes",
  });
  const draft = await db.translationDraft.findFirstOrThrow();
  await db.user.update({
    where: { id: accounts.coordinator.id },
    data: { role: "STUDENT" },
  });
  const notifications = await db.notification.count();
  await expect(
    caller("coordinator").translationReview.decide({
      id: draft.id,
      approve: true,
      expectedUpdatedAt: draft.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.approvalRequest.count()).toBe(0);
  expect(await db.notification.count()).toBe(notifications);
});

it("the syntax-valid unsafe common.save payload produces the repository error fallback", () => {
  const reported = vi.fn();
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const unsafeValue = "Save {auditVariable}";
    const messages: typeof en = {
      ...en,
      common: { ...en.common, save: unsafeValue },
    };
    const translate = createTranslator({
      locale: "en",
      messages,
      onError: (error) => {
        reported(error);
        onIntlError(error);
      },
      getMessageFallback,
    });
    // Same zero-values call as the real ContentField Save button. This proves
    // a broken label plus formatting error, not a whole-page rendering crash.
    expect(translate("common.save")).toBe("⟦common.save⟧");
    expect(reported).toHaveBeenCalledWith(
      expect.objectContaining({ code: "FORMATTING_ERROR" }),
    );
    expect(logged).toHaveBeenCalledOnce();
  } finally {
    logged.mockRestore();
  }
});
