import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";

const author = "Synthetic media retention audit";
const actor = "media-retention-audit-manager";
const locale = "zz-audit";
const ownerKey = "page:media-retention-audit";
const policySlug = "media-retention-audit-policy";
const session: Session = {
  user: { id: actor, name: author, email: "media-audit@example.test" },
  role: "ADMIN",
  tutorId: null,
  expires: "2099-01-01T00:00:00Z",
};
const caller = () => createCaller({ db, session, headers: new Headers() });

async function clean() {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  // Remove only this suite's synthetic ownership markers, never a fixture reset.
  await db.homeContent.deleteMany({ where: { locale, updatedByName: author } });
  await db.newsPost.deleteMany({ where: { createdByName: author } });
  await db.landingSection.deleteMany({ where: { createdByName: author } });
  await db.policyDocument.deleteMany({ where: { slug: policySlug } });
  await db.pageLayout.deleteMany({ where: { ownerKey } });
  await db.customPage.deleteMany({ where: { createdByName: author } });
  await db.homeImage.deleteMany({ where: { createdByName: author } });
}
beforeEach(async () => {
  await clean();
  await db.user.upsert({
    where: { id: actor },
    update: { role: "ADMIN", suspendedAt: null },
    create: {
      id: actor,
      role: "ADMIN",
      name: author,
      email: session.user.email!,
      emailVerifiedAt: new Date(),
    },
  });
});
afterAll(async () => {
  await clean();
  await db.user.deleteMany({ where: { id: actor } });
  await db.$disconnect();
});

it.each([
  "fixed",
  "draft-news",
  "archived-news",
  "hidden-section",
  "policy",
  "unpublished-layout",
] as const)(
  "audit: %s retains its image until the exact reference is removed",
  async (kind) => {
    const bytes = new Uint8Array(
      Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"),
    );
    const image = await db.homeImage.create({
      data: {
        data: bytes,
        mimeType: "image/gif",
        byteSize: bytes.byteLength,
        createdByName: author,
      },
    });
    const url = `/api/images/${image.id}`;
    const markdown = `![Synthetic pixel](${url})`;
    let release: () => Promise<unknown>;
    if (kind === "fixed") {
      await db.homeContent.create({
        data: {
          key: "heroImage",
          locale,
          value: image.id,
          updatedByName: author,
        },
      });
      release = () =>
        db.homeContent.deleteMany({ where: { locale, updatedByName: author } });
    } else if (kind === "draft-news" || kind === "archived-news") {
      const post = await db.newsPost.create({
        data: {
          status: kind === "draft-news" ? "DRAFT" : "ARCHIVED",
          createdByName: author,
          translations: {
            create: {
              locale: "en",
              title: "Synthetic retained news",
              body: markdown,
            },
          },
        },
      });
      release = () =>
        db.newsTranslation.updateMany({
          where: { postId: post.id },
          data: { body: "Synthetic text without image" },
        });
    } else if (kind === "hidden-section") {
      const section = await db.landingSection.create({
        data: {
          published: false,
          createdByName: author,
          translations: {
            create: {
              locale: "en",
              title: "Synthetic hidden section",
              body: markdown,
            },
          },
        },
      });
      release = () =>
        db.landingSectionTranslation.updateMany({
          where: { sectionId: section.id },
          data: { body: "Synthetic text without image" },
        });
    } else if (kind === "policy") {
      await db.policyDocument.create({
        data: {
          slug: policySlug,
          locale: "en",
          title: "Synthetic policy",
          body: markdown,
        },
      });
      release = () =>
        db.policyDocument.deleteMany({ where: { slug: policySlug } });
    } else {
      await db.customPage.create({
        data: {
          id: "media-retention-audit",
          slug: "media-retention-audit",
          title: { en: "Synthetic unpublished page" },
          published: false,
          createdByName: author,
        },
      });
      await db.pageLayout.create({
        data: {
          ownerKey,
          blocks: [
            { id: "synthetic-image-block", type: "IMAGE", imageId: image.id },
          ],
          updatedByName: author,
        },
      });
      release = () =>
        db.pageLayout.update({ where: { ownerKey }, data: { blocks: [] } });
    }
    await expect(
      caller().home.deleteImage({ id: image.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const retained = await db.homeImage.findUniqueOrThrow({
      where: { id: image.id },
    });
    expect(new Uint8Array(retained.data)).toEqual(bytes);
    expect(retained.byteSize).toBe(bytes.byteLength);
    await release();
    await caller().home.deleteImage({ id: image.id });
    expect(
      await db.homeImage.findUnique({ where: { id: image.id } }),
    ).toBeNull();
  },
);
