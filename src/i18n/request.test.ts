import { afterEach, beforeEach, expect, it, vi } from "vitest";

import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import { getMessageFallback, onIntlError } from "./fallback";
import configure from "./request";

type Override = { key: string; value: string };
type OverrideRead = {
  where: { locale: string };
  select: { key: true; value: true };
};

const fixture = vi.hoisted(() => ({
  locale: undefined as string | undefined,
  languages: ["en", "zh", "qaa", "qab"],
  overrides: new Map<string, Override[]>(),
  findMany: vi.fn<(input: OverrideRead) => Promise<Override[]>>(),
  timeZone: vi.fn<() => Promise<string>>(),
}));

// The installed server helper returns its callback unchanged. Keep the real
// request loader and JSON imports cached; only external request inputs reset.
vi.mock("next-intl/server", () => ({
  getRequestConfig: <Config>(create: Config) => create,
}));
vi.mock("next/headers", () => ({
  cookies: async () => {
    const locale = fixture.locale;
    return {
      get: (name: string) =>
        name === "NEXT_LOCALE" && locale ? { value: locale } : undefined,
    };
  },
}));
vi.mock("~/server/db", () => ({
  db: { messageOverride: { findMany: fixture.findMany } },
}));
vi.mock("~/server/i18n/languages", () => ({
  listLanguages: async () => fixture.languages.map((code) => ({ code })),
}));
vi.mock("~/server/program/time-zone", () => ({
  getProgramTimeZone: fixture.timeZone,
}));

const original = { en: structuredClone(en), zh: structuredClone(zh) };

beforeEach(() => {
  fixture.locale = undefined;
  fixture.languages = ["en", "zh", "qaa", "qab"];
  fixture.overrides.clear();
  fixture.findMany.mockReset();
  fixture.findMany.mockImplementation(
    async ({ where }) => fixture.overrides.get(where.locale) ?? [],
  );
  fixture.timeZone.mockReset();
  fixture.timeZone.mockResolvedValue("Asia/Shanghai");
  vi.stubEnv("MESSAGES_OVERRIDE", "");
});

afterEach(() => {
  try {
    expect(en).toEqual(original.en);
    expect(zh).toEqual(original.zh);
  } finally {
    vi.unstubAllEnvs();
  }
});

const request = async (locale: string | undefined) => {
  fixture.locale = locale;
  const config = await configure({ requestLocale: Promise.resolve(locale) });
  return { ...config, messages: config.messages as typeof en };
};

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

it("keeps a custom override out of a later English request using the same cached bundle", async () => {
  fixture.overrides.set("qaa", [
    { key: "common.save", value: "Synthetic QAA Save" },
  ]);

  const custom = await request("qaa");
  const english = await request("en");

  expect(custom.locale).toBe("qaa");
  expect(custom.messages.common.save).toBe("Synthetic QAA Save");
  expect(english.locale).toBe("en");
  expect(english.messages.common.save).toBe(original.en.common.save);
  expect(custom.messages.common).not.toBe(english.messages.common);
  expect(custom.messages.common).not.toBe(en.common);
  expect(fixture.findMany).toHaveBeenNthCalledWith(1, {
    where: { locale: "qaa" },
    select: { key: true, value: true },
  });
  expect(fixture.findMany).toHaveBeenNthCalledWith(2, {
    where: { locale: "en" },
    select: { key: true, value: true },
  });
});

it("isolates two custom locales with different partial overrides and retains the earlier result", async () => {
  fixture.overrides.set("qaa", [
    { key: "common.save", value: "Synthetic QAA Save" },
    { key: "auth.twoFactor.settings.title", value: "Synthetic QAA Settings" },
  ]);
  fixture.overrides.set("qab", [
    { key: "common.cancel", value: "Synthetic QAB Cancel" },
  ]);

  const first = await request("qaa");
  const retained = structuredClone(first.messages);
  const second = await request("qab");

  expect(first.messages.common.save).toBe("Synthetic QAA Save");
  expect(first.messages.auth.twoFactor.settings.title).toBe(
    "Synthetic QAA Settings",
  );
  expect(first.messages.common.cancel).toBe(original.en.common.cancel);
  expect(second.messages.common.cancel).toBe("Synthetic QAB Cancel");
  expect(second.messages.common.save).toBe(original.en.common.save);
  expect(second.messages.auth.twoFactor.settings.title).toBe(
    original.en.auth.twoFactor.settings.title,
  );
  expect(first.messages).toEqual(retained);
});

it.each(["en", "zh"] as const)(
  "restores the %s bundle after removing its rendered overrides in the same module",
  async (locale) => {
    fixture.overrides.set(locale, [
      { key: "common.save", value: "Synthetic built-in Save" },
      {
        key: "auth.twoFactor.settings.title",
        value: "Synthetic built-in Settings",
      },
    ]);
    const first = await request(locale);
    fixture.overrides.delete(locale);
    const cleared = await request(locale);

    expect(first.messages.common.save).toBe("Synthetic built-in Save");
    expect(first.messages.auth.twoFactor.settings.title).toBe(
      "Synthetic built-in Settings",
    );
    expect(cleared.messages.common.save).toBe(original[locale].common.save);
    expect(cleared.messages.auth.twoFactor.settings.title).toBe(
      original[locale].auth.twoFactor.settings.title,
    );
  },
);

it("preserves bundle, nested environment and DB precedence without changing untouched siblings", async () => {
  vi.stubEnv(
    "MESSAGES_OVERRIDE",
    JSON.stringify({
      common: { save: "Synthetic environment Save" },
      auth: { signIn: "Synthetic environment Sign In" },
    }),
  );
  fixture.overrides.set("en", [
    { key: "common.save", value: "Synthetic DB Save" },
    { key: "auth.twoFactor.settings.title", value: "Synthetic DB Settings" },
  ]);
  const published = await request("en");
  const retained = structuredClone(published.messages);
  fixture.overrides.delete("en");
  const environment = await request("en");
  vi.stubEnv("MESSAGES_OVERRIDE", "");
  const bundled = await request("en");

  expect(published.messages.common.save).toBe("Synthetic DB Save");
  expect(published.messages.auth.signIn).toBe("Synthetic environment Sign In");
  expect(published.messages.auth.twoFactor.settings.title).toBe(
    "Synthetic DB Settings",
  );
  expect(environment.messages.common.save).toBe("Synthetic environment Save");
  expect(environment.messages.common.cancel).toBe(original.en.common.cancel);
  expect(environment.messages.auth.signIn).toBe(
    "Synthetic environment Sign In",
  );
  expect(environment.messages.auth.twoFactor.settings.title).toBe(
    original.en.auth.twoFactor.settings.title,
  );
  expect(bundled.messages).toEqual(original.en);
  expect(published.messages).toEqual(retained);
});

it("uses pristine bundle and environment fallbacks when a warmed override read fails", async () => {
  vi.stubEnv(
    "MESSAGES_OVERRIDE",
    JSON.stringify({ common: { save: "Synthetic environment Save" } }),
  );
  fixture.overrides.set("en", [
    { key: "common.save", value: "Synthetic DB Save" },
    { key: "auth.signIn", value: "Synthetic DB Sign In" },
  ]);
  const warmed = await request("en");
  fixture.findMany.mockRejectedValueOnce(new Error("Synthetic DB unavailable"));
  const fallback = await request("en");

  expect(warmed.messages.common.save).toBe("Synthetic DB Save");
  expect(warmed.messages.auth.signIn).toBe("Synthetic DB Sign In");
  expect(fallback.messages.common.save).toBe("Synthetic environment Save");
  expect(fallback.messages.auth.signIn).toBe(original.en.auth.signIn);
  expect(fallback.messages.auth.twoFactor.settings.title).toBe(
    original.en.auth.twoFactor.settings.title,
  );
});

it("keeps overlapping custom requests and an already returned result independent", async () => {
  const firstEntered = deferred<void>();
  const secondEntered = deferred<void>();
  const firstRows = deferred<Override[]>();
  const secondRows = deferred<Override[]>();
  fixture.findMany.mockImplementation(({ where }) => {
    if (where.locale === "qaa") {
      firstEntered.resolve(undefined);
      return firstRows.promise;
    }
    if (where.locale === "qab") {
      secondEntered.resolve(undefined);
      return secondRows.promise;
    }
    throw new Error("Unexpected synthetic locale");
  });

  const firstPending = request("qaa");
  const secondPending = request("qab");
  await Promise.all([firstEntered.promise, secondEntered.promise]);
  firstRows.resolve([
    { key: "common.save", value: "Synthetic overlapping QAA Save" },
  ]);
  const first = await firstPending;
  const retained = structuredClone(first.messages);
  secondRows.resolve([
    { key: "common.save", value: "Synthetic overlapping QAB Save" },
    { key: "common.cancel", value: "Synthetic overlapping QAB Cancel" },
  ]);
  const second = await secondPending;

  expect(first.locale).toBe("qaa");
  expect(second.locale).toBe("qab");
  expect(retained.common.save).toBe("Synthetic overlapping QAA Save");
  expect(second.messages.common.save).toBe("Synthetic overlapping QAB Save");
  expect(second.messages.common.cancel).toBe(
    "Synthetic overlapping QAB Cancel",
  );
  expect(first.messages).toEqual(retained);
  expect(first.messages.common.cancel).toBe(original.en.common.cancel);
  expect(first.messages.common).not.toBe(second.messages.common);
});

it.each([undefined, "not-enabled"])(
  "retains English fallback for a missing or unknown locale cookie: %s",
  async (locale) => {
    const config = await request(locale);
    expect(config.locale).toBe("en");
    expect(config.messages).toEqual(original.en);
  },
);

it("retains shared formatter callbacks and resolves the current program time zone for each request", async () => {
  fixture.timeZone
    .mockResolvedValueOnce("Asia/Shanghai")
    .mockResolvedValueOnce("Europe/Athens");
  const first = await request("en");
  const second = await request("zh");

  expect(first.getMessageFallback).toBe(getMessageFallback);
  expect(first.onError).toBe(onIntlError);
  expect(second.getMessageFallback).toBe(getMessageFallback);
  expect(second.onError).toBe(onIntlError);
  expect(first.timeZone).toBe("Asia/Shanghai");
  expect(second.timeZone).toBe("Europe/Athens");
  expect(fixture.timeZone).toHaveBeenCalledTimes(2);
});
