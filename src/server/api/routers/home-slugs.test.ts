import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { slugify } from "~/server/home/slugs";
import { databaseScope } from "~/server/db-scope";

const actor = "slug-review-admin";
const author = "Slug Review";
const session: Session = {
  user: { id: actor, name: author, email: "slug-review@example.test" },
  role: "ADMIN",
  tutorId: null,
  expires: "2099-01-01T00:00:00Z",
};
const caller = () => createCaller({ db, session, headers: new Headers() });

/** Only remove this suite's synthetic content; never touch a running demonstration database. */
async function clean() {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.pathname.endsWith("_test")
  )
    throw Error("Slug tests require an explicitly named local test database");
  await db.customPage.deleteMany({ where: { createdByName: author } });
  await db.landingSection.deleteMany({ where: { createdByName: author } });
}
beforeEach(async () => {
  await clean();
  await db.user.upsert({
    where: { id: actor },
    update: {},
    create: {
      id: actor,
      name: author,
      email: session.user.email!,
      role: "ADMIN",
      emailVerifiedAt: new Date(),
    },
  });
});
afterAll(async () => {
  await clean();
  await db.user.deleteMany({ where: { id: actor } });
  await db.$disconnect();
});

it("concurrent custom pages get separate stable URLs", async () => {
  const pages = await Promise.all([
    caller().home.createPage({ title: "Slug review shared" }),
    caller().home.createPage({ title: "Slug review shared" }),
  ]);
  const rows = await db.customPage.findMany({
    where: { id: { in: pages.map((p) => p.id) } },
  });
  expect(rows.map((p) => p.slug).sort()).toEqual([
    "slug-review-shared",
    "slug-review-shared-2",
  ]);
});

it("a page and a converted section cannot concurrently claim the same route", async () => {
  const section = await caller().home.createSection({
    title: "Slug review cross table",
    body: "Demonstration section",
  });
  const [page] = await Promise.all([
    caller().home.createPage({ title: "Slug review cross table" }),
    caller().home.updateSection({
      id: section.id,
      mode: "PAGE",
      published: true,
    }),
  ]);
  const pageRow = await db.customPage.findUniqueOrThrow({
    where: { id: page.id },
  });
  const sectionRow = await db.landingSection.findUniqueOrThrow({
    where: { id: section.id },
  });
  expect([pageRow.slug, sectionRow.slug].sort()).toEqual([
    "slug-review-cross-table",
    "slug-review-cross-table-2",
  ]);
});

it("simultaneous page and section renames preserve the shared namespace", async () => {
  const page = await caller().home.createPage({
    title: "Slug review initial page",
  });
  const section = await caller().home.createSection({
    title: "Slug review initial section",
    body: "Section",
  });
  await Promise.all([
    caller().home.updatePage({ id: page.id, slug: "slug-review-renamed" }),
    caller().home.updateSection({
      id: section.id,
      mode: "PAGE",
      slug: "slug-review-renamed",
    }),
  ]);
  const a = await db.customPage.findUniqueOrThrow({ where: { id: page.id } });
  const b = await db.landingSection.findUniqueOrThrow({
    where: { id: section.id },
  });
  expect([a.slug, b.slug].sort()).toEqual([
    "slug-review-renamed",
    "slug-review-renamed-2",
  ]);
});

it("long colliding titles remain editable under the 60-character slug validator", async () => {
  const title = "x".repeat(60);
  const pages = await Promise.all([
    caller().home.createPage({ title }),
    caller().home.createPage({ title }),
  ]);
  const rows = await db.customPage.findMany({
    where: { id: { in: pages.map((p) => p.id) } },
  });
  expect(new Set(rows.map((p) => p.slug)).size).toBe(2);
  for (const row of rows) {
    expect(row.slug.length).toBeLessThanOrEqual(60);
    await expect(
      caller().home.updatePage({ id: row.id, slug: row.slug }),
    ).resolves.toEqual({ ok: true });
    expect(
      (await db.customPage.findUniqueOrThrow({ where: { id: row.id } })).slug,
    ).toBe(row.slug);
  }
});

it("title truncation never creates a trailing hyphen", async () => {
  const title = "x".repeat(59) + " word";
  expect(slugify(title)).toBe("x".repeat(59));
  const page = await caller().home.createPage({ title });
  const row = await db.customPage.findUniqueOrThrow({ where: { id: page.id } });
  await expect(
    caller().home.updatePage({ id: page.id, slug: row.slug }),
  ).resolves.toEqual({ ok: true });
});

it("unpublished pages reserve URLs and self-renames keep their own URL", async () => {
  const page = await caller().home.createPage({
    title: "Slug review reserved",
  });
  const section = await caller().home.createSection({
    title: "Slug review reserved",
    body: "Section",
  });
  await caller().home.updateSection({ id: section.id, mode: "PAGE" });
  await caller().home.updatePage({ id: page.id, slug: "slug-review-reserved" });
  const row = await db.landingSection.findUniqueOrThrow({
    where: { id: section.id },
  });
  expect(row.slug).toBe("slug-review-reserved-2");
});

it("slug allocation rolls back with the enclosing approval transaction", async () => {
  // Coordinator approval replays install this database scope before calling the same routers.
  await expect(
    db.$transaction((tx) =>
      databaseScope.run(tx, async () => {
        await caller().home.createPage({
          title: "Slug review approval rollback",
        });
        throw new Error("later approval audit failed");
      }),
    ),
  ).rejects.toThrow("later approval audit failed");
  expect(
    await db.customPage.count({
      where: { slug: "slug-review-approval-rollback" },
    }),
  ).toBe(0);
  const created = await caller().home.createPage({
    title: "Slug review approval rollback",
  });
  expect(
    (await db.customPage.findUniqueOrThrow({ where: { id: created.id } })).slug,
  ).toBe("slug-review-approval-rollback");
});
