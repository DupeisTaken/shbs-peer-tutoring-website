import type { Session } from "next-auth";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "./database-guard";

export const intentAccounts = {
  author: { id: "intent-author", role: "STUDENT" },
  coordinator: { id: "intent-coordinator", role: "COORDINATOR" },
  publisher: { id: "intent-publisher", role: "ADMIN" },
  other: { id: "intent-other", role: "STUDENT" },
} as const;
export type IntentActor = keyof typeof intentAccounts;
export type IntentEnvelope = {
  version: 1;
  id: string;
  actorId: string;
  mode: "DRAFT" | "PUBLISH";
};

export function intentCaller(
  actor: IntentActor,
  generations: Partial<
    Pick<Session, "sessionVersion" | "historyAccessRevision">
  > = {},
) {
  const account = intentAccounts[actor];
  const session: Session = {
    user: { id: account.id, name: "Synthetic intent actor" },
    role: account.role,
    tutorId: null,
    expires: "2099-01-01T00:00:00Z",
    sessionVersion: 0,
    historyAccessRevision: 0,
    ...generations,
  };
  return createCaller({ db, headers: new Headers(), session });
}

export async function resetTranslationIntentFixture() {
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
    data: Object.entries(intentAccounts).map(([actor, account]) => ({
      ...account,
      email: `intent-${actor}@example.test`,
      name: "Synthetic intent actor",
      canTranslate: true,
    })),
  });
  await db.newsPost.create({
    data: {
      id: "intent-news",
      translations: {
        create: {
          locale: "en",
          title: "Original synthetic news",
          body: "Original synthetic body",
        },
      },
    },
  });
  await db.landingSection.create({
    data: {
      id: "intent-section",
      translations: {
        create: {
          locale: "en",
          title: "Original synthetic section",
          body: "Original synthetic body",
        },
      },
    },
  });
  await db.customPage.create({
    data: {
      id: "intent-page",
      slug: "intent-page",
      title: { en: "Original synthetic page" },
    },
  });
  await db.language.create({
    data: { code: "xx-intent", label: "Synthetic", enabled: true },
  });
}

type Caller = ReturnType<typeof intentCaller>;
// Fixed parsed business fixtures cover each real setter, including distinct
// parent identities. Overrides deliberately exercise the real route schemas.
export const intentWrites = [
  {
    operation: "localization.setString",
    run: (
      caller: Caller,
      intent?: IntentEnvelope,
      change: Record<string, unknown> = {},
    ) =>
      caller.localization.setString({
        locale: "en",
        key: "common.save",
        value: "Save synthetic intent",
        intent,
        ...change,
      }),
  },
  {
    operation: "home.setContent",
    run: (
      caller: Caller,
      intent?: IntentEnvelope,
      change: Record<string, unknown> = {},
    ) =>
      caller.home.setContent({
        locale: "en",
        key: "heroTitle",
        value: "Synthetic intent title",
        intent,
        ...change,
      }),
  },
  {
    operation: "home.setNewsTranslation",
    run: (
      caller: Caller,
      intent?: IntentEnvelope,
      change: Record<string, unknown> = {},
    ) =>
      caller.home.setNewsTranslation({
        locale: "en",
        postId: "intent-news",
        title: "Synthetic intent news",
        body: "Synthetic intent body",
        intent,
        ...change,
      }),
  },
  {
    operation: "home.setSectionTranslation",
    run: (
      caller: Caller,
      intent?: IntentEnvelope,
      change: Record<string, unknown> = {},
    ) =>
      caller.home.setSectionTranslation({
        locale: "en",
        sectionId: "intent-section",
        title: "Synthetic intent section",
        body: "Synthetic intent body",
        intent,
        ...change,
      }),
  },
  {
    operation: "home.setPageTitle",
    run: (
      caller: Caller,
      intent?: IntentEnvelope,
      change: Record<string, unknown> = {},
    ) =>
      caller.home.setPageTitle({
        locale: "en",
        id: "intent-page",
        value: "Synthetic intent page",
        intent,
        ...change,
      }),
  },
] as const;

export async function intentBusinessSnapshot() {
  return {
    drafts: await db.translationDraft.findMany({ orderBy: { id: "asc" } }),
    overrides: await db.messageOverride.findMany({ orderBy: { id: "asc" } }),
    home: await db.homeContent.findMany({
      orderBy: [{ key: "asc" }, { locale: "asc" }],
    }),
    news: await db.newsTranslation.findMany({ orderBy: { id: "asc" } }),
    sections: await db.landingSectionTranslation.findMany({
      orderBy: { id: "asc" },
    }),
    pages: await db.customPage.findMany({ orderBy: { id: "asc" } }),
    notices: await db.notification.findMany({ orderBy: { id: "asc" } }),
    approvals: await db.approvalRequest.findMany({ orderBy: { id: "asc" } }),
    receipts: await db.translationIntentReceipt.findMany({
      orderBy: [{ actorId: "asc" }, { intentId: "asc" }],
    }),
  };
}
