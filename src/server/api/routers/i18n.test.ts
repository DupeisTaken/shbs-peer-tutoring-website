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

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("language publishing", () => {
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
