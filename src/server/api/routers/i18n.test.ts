import type { Session } from "next-auth";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The callers below provide explicit sessions, so Auth.js request discovery is unnecessary.
vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";

const LANGUAGE = "zz";
const adminSession: Session = {
  user: {
    id: "test-language-admin",
    name: "Language Admin",
    email: "language-admin@example.com",
  },
  role: "ADMIN",
  tutorId: null,
  expires: new Date(Date.now() + 3_600_000).toISOString(),
};

const admin = () =>
  createCaller({ db, session: adminSession, headers: new Headers() });
const publicCaller = () =>
  createCaller({ db, session: null, headers: new Headers() });

async function cleanup() {
  await db.approvalRequest.deleteMany({ where: { requesterId: adminSession.user.id } });
  await db.messageOverride.deleteMany({ where: { locale: LANGUAGE } });
  await db.language.deleteMany({ where: { code: LANGUAGE } });
}

/** Structural catalogue controls apply directly for both Admin and Head;
 * language text editing continues to require the explicit Translator badge. */
async function applyStructural(operation: string, apply: () => Promise<unknown>) {
  const before = await db.approvalRequest.count({ where: { requesterId: adminSession.user.id, operation } });
  const result = await apply();
  expect(await db.approvalRequest.count({ where: { requesterId: adminSession.user.id, operation } })).toBe(before);
  return result;
}

beforeEach(async () => {
  await cleanup();
  // Translation editing is an explicit membership, independent of management rank.
  await db.user.upsert({
    where: { id: adminSession.user.id },
    update: { role: "ADMIN", canTranslate: true },
    create: {
      id: adminSession.user.id,
      email: adminSession.user.email!,
      name: adminSession.user.name,
      role: "ADMIN",
      canTranslate: true,
    },
  });
});

afterAll(async () => {
  await cleanup();
  await db.user.deleteMany({ where: { id: adminSession.user.id } });
  await db.$disconnect();
});

describe("language publishing", () => {
  it.each(["ADMIN", "HEAD"] as const)(
    "allows unassigned %s to manage visibility and order without text editing",
    async (role) => {
      await db.user.update({
        where: { id: adminSession.user.id },
        data: { role, canTranslate: false },
      });
      await db.language.create({
        data: {
          code: LANGUAGE,
          label: "Test Language",
          enabled: false,
          builtIn: false,
          sortOrder: 2000,
        },
      });
      expect(await admin().i18n.canManageLanguages()).toBe(true);
      expect(
        (await admin().i18n.managedLanguages()).some(
          (l) => l.code === LANGUAGE,
        ),
      ).toBe(true);
      await applyStructural("i18n.setLanguageEnabled", () => admin().i18n.setLanguageEnabled({ code: LANGUAGE, enabled: true }));
      await applyStructural("i18n.reorderLanguages", () => admin().i18n.reorderLanguages({ codes: [LANGUAGE] }));
      expect(
        await db.language.findUnique({ where: { code: LANGUAGE } }),
      ).toMatchObject({ enabled: true, sortOrder: 0 });
      expect(
        (await publicCaller().i18n.languages()).some(
          (l) => l.code === LANGUAGE,
        ),
      ).toBe(true);
      await applyStructural("i18n.setLanguageEnabled", () => admin().i18n.setLanguageEnabled({ code: LANGUAGE, enabled: false }));
      expect(
        (await publicCaller().i18n.languages()).some(
          (l) => l.code === LANGUAGE,
        ),
      ).toBe(false);
      await expect(
        admin().localization.strings({ locale: "zh" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        admin().i18n.addLanguage({ code: "zx", label: "Restricted" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );

  it("allows an unassigned Coordinator to inspect and propose catalog changes while denying direct publishing and text editing", async () => {
    // The stale Admin cookie cannot turn proposals or text edits into direct writes.
    await db.user.update({ where: { id: adminSession.user.id }, data: { role: "COORDINATOR", canTranslate: false } });
    const language = await db.language.create({ data: { code: LANGUAGE, label: "Coordinator review", enabled: true, builtIn: false, sortOrder: 2000 } });
    expect((await admin().i18n.managedLanguages()).some((item) => item.code === LANGUAGE)).toBe(true);
    expect(await admin().i18n.canManageLanguages()).toBe(true);
    await expect(admin().localization.strings({ locale: LANGUAGE })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin().localization.setString({ locale: LANGUAGE, key: "common.save", value: "Unauthorized text" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin().i18n.addLanguage({ code: "zx", label: "Unauthorized language" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.approvalRequest.count({ where: { requesterId: adminSession.user.id } })).toBe(0);
    await expect(admin().i18n.setLanguageEnabled({ code: LANGUAGE, enabled: false })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(admin().i18n.reorderLanguages({ codes: [LANGUAGE] })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await db.language.findUniqueOrThrow({ where: { code: LANGUAGE } })).toEqual(language);
    const requests = await db.approvalRequest.findMany({ where: { requesterId: adminSession.user.id, state: "PENDING" } });
    expect(requests.map((request) => request.operation).sort()).toEqual(["i18n.reorderLanguages", "i18n.setLanguageEnabled"]);
    await expect(admin().approval.decide({ id: requests[0]!.id, approve: true, note: "Coordinator cannot publish directly" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.language.findUniqueOrThrow({ where: { code: LANGUAGE } })).toEqual(language);
  });

  it.each(["TUTOR", "STUDENT", "VIEWER"] as const)(
    "rejects catalog access and mutations after demotion to unassigned %s",
    async (role) => {
      // Keep the ADMIN session deliberately stale: live account permissions must win.
      await db.user.update({
        where: { id: adminSession.user.id },
        data: { role, canTranslate: false },
      });
      await expect(admin().i18n.managedLanguages()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(admin().i18n.canManageLanguages()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        admin().i18n.setLanguageEnabled({ code: "zh", enabled: false }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        admin().i18n.reorderLanguages({ codes: ["zh", "en"] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );

  it("lets assigned translators read hidden languages but not manage them", async () => {
    await db.user.update({
      where: { id: adminSession.user.id },
      data: { role: "TUTOR", canTranslate: true },
    });
    expect((await admin().i18n.managedLanguages()).length).toBeGreaterThan(0);
    expect(await admin().i18n.canManageLanguages()).toBe(false);
    await expect(
      admin().i18n.setLanguageEnabled({ code: "zh", enabled: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      admin().i18n.reorderLanguages({ codes: ["zh", "en"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects anonymous and suspended catalog requests", async () => {
    await expect(publicCaller().i18n.managedLanguages()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await db.user.update({
      where: { id: adminSession.user.id },
      data: { suspendedAt: new Date() },
    });
    try {
      await expect(admin().i18n.managedLanguages()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await db.user.update({
        where: { id: adminSession.user.id },
        data: { suspendedAt: null },
      });
    }
  });

  it("keeps a newly added language hidden until a manager enables it", async () => {
    await admin().i18n.addLanguage({ code: LANGUAGE, label: "Test Language" });

    expect(
      (await publicCaller().i18n.languages()).some(
        (language) => language.code === LANGUAGE,
      ),
    ).toBe(false);
    expect(
      (await admin().i18n.managedLanguages()).find(
        (language) => language.code === LANGUAGE,
      ),
    ).toMatchObject({ enabled: false, builtIn: false });

    await applyStructural("i18n.setLanguageEnabled", () => admin().i18n.setLanguageEnabled({ code: LANGUAGE, enabled: true }));
    expect(
      (await publicCaller().i18n.languages()).find(
        (language) => language.code === LANGUAGE,
      ),
    ).toMatchObject({ enabled: true });
  });

  it.each([
    ["ja", "言語"],
    ["ko", "언어"],
    ["el", "Γλώσσες"],
    ["de", "Sprachen"],
    ["fr", "Langues"],
  ])(
    "loads the bundled %s catalog in the translation editor",
    async (locale, heading) => {
      const strings = await admin().localization.strings({ locale });
      expect(
        strings.find((item) => item.key === "localization.languagesHeading")
          ?.base,
      ).toBe(heading);
    },
  );

  it("does not allow the required English fallback to be hidden", async () => {
    await db.user.update({ where: { id: adminSession.user.id }, data: { role: "HEAD" } });
    await expect(
      admin().i18n.setLanguageEnabled({ code: "en", enabled: false }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
