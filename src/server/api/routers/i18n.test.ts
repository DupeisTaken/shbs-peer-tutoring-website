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
  await db.messageOverride.deleteMany({ where: { locale: LANGUAGE } });
  await db.language.deleteMany({ where: { code: LANGUAGE } });
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
      await admin().i18n.setLanguageEnabled({ code: LANGUAGE, enabled: true });
      await admin().i18n.reorderLanguages({ codes: [LANGUAGE] });
      expect(
        await db.language.findUnique({ where: { code: LANGUAGE } }),
      ).toMatchObject({ enabled: true, sortOrder: 0 });
      expect(
        (await publicCaller().i18n.languages()).some(
          (l) => l.code === LANGUAGE,
        ),
      ).toBe(true);
      await admin().i18n.setLanguageEnabled({ code: LANGUAGE, enabled: false });
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

  it.each(["COORDINATOR", "TUTOR", "STUDENT", "VIEWER"] as const)(
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

    await admin().i18n.setLanguageEnabled({ code: LANGUAGE, enabled: true });
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
    await expect(
      admin().i18n.setLanguageEnabled({ code: "en", enabled: false }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
