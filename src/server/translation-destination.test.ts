import { beforeEach, afterAll, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "./db";
import { createCaller } from "./api/root";
import { databaseScope } from "./db-scope";
import { TRANSLATION_BASELINE } from "./translation-destination";

const user = (id: string, role: Session["role"]) =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, name: "Translation Review" },
      role,
      tutorId: null,
      expires: "2099-01-01",
    },
  });
const admin = () => user("translation-admin", "ADMIN");
const translator = () => user("translation-author", "VIEWER");
const targets = ["message", "content", "news", "section", "page"] as const;
type Target = (typeof targets)[number];
const write = (target: Target, value: string, staff = false) => {
  const caller = staff ? admin() : translator();
  switch (target) {
    case "message":
      return caller.localization.setString({
        locale: "en",
        key: "common.save",
        value,
      });
    case "content":
      return caller.home.setContent({ locale: "en", key: "tagline", value });
    case "news":
      return caller.home.setNewsTranslation({
        postId: "translation-news",
        locale: "en",
        title: value,
        body: "Body",
      });
    case "section":
      return caller.home.setSectionTranslation({
        sectionId: "translation-section",
        locale: "en",
        title: value,
        body: "Body",
      });
    case "page":
      return caller.home.setPageTitle({
        id: "translation-page",
        locale: "en",
        value,
      });
  }
};
const read = async (target: Target) => {
  switch (target) {
    case "message":
      return (
        await db.messageOverride.findUnique({
          where: { locale_key: { locale: "en", key: "common.save" } },
        })
      )?.value;
    case "content":
      return (
        await db.homeContent.findUnique({
          where: { key_locale: { locale: "en", key: "tagline" } },
        })
      )?.value;
    case "news":
      return (
        await db.newsTranslation.findUniqueOrThrow({
          where: {
            postId_locale: { postId: "translation-news", locale: "en" },
          },
        })
      ).title;
    case "section":
      return (
        await db.landingSectionTranslation.findUniqueOrThrow({
          where: {
            sectionId_locale: {
              sectionId: "translation-section",
              locale: "en",
            },
          },
        })
      ).title;
    case "page":
      return (
        await db.customPage.findUniqueOrThrow({
          where: { id: "translation-page" },
        })
      ).title;
  }
};
const latest = () =>
  db.translationDraft.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
const approve = (draft: { id: string; updatedAt: Date }) =>
  admin().translationReview.decide({
    id: draft.id,
    approve: true,
    expectedUpdatedAt: draft.updatedAt,
  });

beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.pathname.endsWith("_test")
  )
    throw Error("Translation tests need an isolated local test database");
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((t) => '"' + t.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.user.createMany({
    data: [
      {
        id: "translation-admin",
        email: "translation-admin@example.test",
        role: "ADMIN",
      },
      {
        id: "translation-author",
        email: "translation-author@example.test",
        role: "VIEWER",
        canTranslate: true,
      },
    ],
  });
  await db.newsPost.create({
    data: {
      id: "translation-news",
      translations: {
        create: { locale: "en", title: "Original", body: "Body" },
      },
    },
  });
  await db.landingSection.create({
    data: {
      id: "translation-section",
      translations: {
        create: { locale: "en", title: "Original", body: "Body" },
      },
    },
  });
  await db.customPage.create({
    data: {
      id: "translation-page",
      slug: "translation-test",
      title: { en: "Original" },
    },
  });
});
afterAll(() => db.$disconnect());

for (const target of targets) {
  it(
    target +
      ": a concurrent staff save cannot be overwritten by the older draft",
    async () => {
      await write(target, "Proposal");
      const draft = await latest();
      const results = await Promise.allSettled([
        approve(draft),
        write(target, "Staff revision", true),
      ]);
      expect(results[1].status).toBe("fulfilled");
      expect(await read(target)).toEqual(
        target === "page" ? { en: "Staff revision" } : "Staff revision",
      );
    },
  );
  it(
    target + ": approval does not overwrite staff changes after submission",
    async () => {
      await write(target, "Proposed");
      const draft = await latest();
      await write(target, "New live text", true);
      const before = await read(target);
      await expect(approve(draft)).rejects.toThrow("destination text changed");
      expect(await read(target)).toEqual(before);
      expect((await latest()).state).toBe("PENDING");
      expect(
        await db.auditLog.count({ where: { entity: "TranslationDraft" } }),
      ).toBe(0);
    },
  );
  it(
    target + ": concurrent draft approvals publish only one version",
    async () => {
      await write(target, "First proposal");
      const first = await latest();
      await write(target, "Second proposal");
      const second = await latest();
      const results = await Promise.allSettled([
        approve(first),
        approve(second),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        await db.translationDraft.count({ where: { state: "APPROVED" } }),
      ).toBe(1);
      expect(
        await db.translationDraft.count({ where: { state: "PENDING" } }),
      ).toBe(1);
    },
  );
}

it("legacy proposals retain evidence, hide internal metadata and require explicit resubmission", async () => {
  const draft = await db.translationDraft.create({
    data: {
      authorId: "translation-author",
      operation: "localization.setString",
      payload: { locale: "en", key: "common.save", value: "Legacy" },
    },
  });
  await expect(approve(draft)).rejects.toThrow("older draft");
  const rows = await admin().translationReview.list({ page: 0 });
  expect(rows[0]!.needsResubmission).toBe(true);
  await admin().translationReview.decide({
    id: draft.id,
    approve: false,
    expectedUpdatedAt: draft.updatedAt,
  });
  expect((await latest()).state).toBe("REJECTED");
  await write("message", "New proposal");
  const fresh = (await admin().translationReview.list({ page: 0 }))[0]!;
  expect(fresh.payload).not.toHaveProperty(TRANSLATION_BASELINE);
  expect(fresh.needsResubmission).toBe(false);
  await approve(fresh);
});

it("a deleted custom locale cannot redirect a proposal into English", async () => {
  await db.language.create({ data: { code: "zz", label: "Demo language" } });
  await translator().localization.setString({
    locale: "zz",
    key: "common.save",
    value: "Proposal",
  });
  const draft = await latest();
  await admin().i18n.deleteLanguage({ code: "zz" });
  await expect(approve(draft)).rejects.toThrow("destination text changed");
  expect(await db.messageOverride.count()).toBe(0);
});

it("deleting a translated parent invalidates its proposal without losing evidence", async () => {
  await write("news", "Proposal");
  const draft = await latest();
  await admin().home.deleteNews({ id: "translation-news" });
  await expect(approve(draft)).rejects.toThrow("destination text changed");
  expect((await latest()).state).toBe("PENDING");
});

it("a later approval failure rolls back both text and draft decision", async () => {
  await write("content", "Proposal");
  const draft = await latest();
  await expect(
    db.$transaction((tx) =>
      databaseScope.run(tx, async () => {
        await approve(draft);
        throw Error("later approval audit failure");
      }),
    ),
  ).rejects.toThrow("later approval audit failure");
  expect(await read("content")).toBeUndefined();
  expect((await latest()).state).toBe("PENDING");
  expect(
    await db.auditLog.count({ where: { entity: "TranslationDraft" } }),
  ).toBe(0);
  await approve(draft);
});
