import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  languageRead: vi.fn(),
  managerRead: vi.fn(),
  overrideRead: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  db: { language: { findMany: fixture.languageRead } },
}));

// Isolate the actual catalogue route/helper from unrelated session
// machinery. The route's own languageCatalogProcedure still checks this manager.
vi.mock("~/server/api/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return {
    createTRPCRouter: t.router,
    publicProcedure: t.procedure,
    protectedProcedure: t.procedure,
    adminProcedure: t.procedure,
    translatorProcedure: t.procedure,
  };
});
vi.mock("~/server/translation-destination", () => ({
  withTranslationWrite: vi.fn(),
}));
vi.mock("~/server/translation-drafts", () => ({ proposeTranslation: vi.fn() }));

import { i18nRouter } from "~/server/api/routers/i18n";
import { localizationRouter } from "~/server/api/routers/localization";

function caller() {
  return i18nRouter.createCaller({
    db: { user: { findUniqueOrThrow: fixture.managerRead } },
    session: { role: "ADMIN", user: { id: "audit-language-manager" } },
    headers: new Headers(),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.managerRead.mockResolvedValue({ role: "ADMIN", canTranslate: false });
  fixture.overrideRead.mockResolvedValue([]);
  fixture.languageRead.mockResolvedValue([
    { code: "zh", label: "中文", builtIn: true, enabled: false, sortOrder: 4 },
    {
      code: "fr",
      label: "Français",
      builtIn: true,
      enabled: true,
      sortOrder: 1,
    },
    {
      code: "pt-br",
      label: "Synthetic Portuguese",
      builtIn: false,
      enabled: true,
      sortOrder: 2,
    },
  ]);
});

describe("managed language reads distinguish unavailable settings from defaults", () => {
  it("reads the stored management catalogue, including hidden and custom languages", async () => {
    const rows = await caller().managedLanguages();
    expect(rows.find((row) => row.code === "zh")).toMatchObject({
      enabled: false,
    });
    expect(rows.find((row) => row.code === "fr")).toMatchObject({
      enabled: true,
    });
    expect(rows.find((row) => row.code === "pt-br")).toMatchObject({
      enabled: true,
    });
  });

  it("rejects an unavailable management catalogue instead of returning a successful fresh-install configuration", async () => {
    fixture.languageRead.mockRejectedValue(
      new Error("Synthetic catalogue unavailable"),
    );
    await expect(caller().managedLanguages()).rejects.toThrow();
  });

  it("retains the intended public-rendering fallback when the catalogue cannot be read", async () => {
    fixture.languageRead.mockRejectedValue(
      new Error("Synthetic catalogue unavailable"),
    );
    expect((await caller().languages()).map((row) => row.code)).toEqual([
      "en",
      "zh",
    ]);
  });

  it("only synthesizes managed defaults after a successful empty read", async () => {
    fixture.languageRead.mockResolvedValue([]);
    const rows = await caller().managedLanguages();
    expect(rows).toHaveLength(8);
    expect(rows.filter((row) => row.enabled).map((row) => row.code)).toEqual([
      "en",
      "zh",
    ]);
  });

  it("refuses a stale management session before disclosing stored languages", async () => {
    fixture.managerRead.mockResolvedValue({
      role: "VIEWER",
      canTranslate: false,
    });
    await expect(caller().managedLanguages()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fixture.languageRead).not.toHaveBeenCalled();
  });

  it("never silently redirects an unavailable custom-language editor to English", async () => {
    fixture.languageRead.mockRejectedValue(
      new Error("Synthetic catalogue unavailable"),
    );
    const localization = localizationRouter.createCaller({
      db: { messageOverride: { findMany: fixture.overrideRead } },
      session: { role: "ADMIN", user: { id: "language-manager" } },
      headers: new Headers(),
    } as never);
    await expect(localization.strings({ locale: "pt-br" })).rejects.toThrow();
    expect(fixture.overrideRead).not.toHaveBeenCalled();
  });

  it("retains unknown-locale English fallback after a successful catalogue read", async () => {
    const localization = localizationRouter.createCaller({
      db: { messageOverride: { findMany: fixture.overrideRead } },
      session: { role: "ADMIN", user: { id: "language-manager" } },
      headers: new Headers(),
    } as never);
    await localization.strings({ locale: "unknown" });
    expect(fixture.overrideRead).toHaveBeenCalledWith({
      where: { locale: "en" },
      select: { key: true, value: true },
    });
  });
});
