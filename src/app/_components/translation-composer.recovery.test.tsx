// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { QueryFilters, UseMutationOptions } from "@tanstack/react-query";
import type * as IntentClientModule from "~/lib/translation-intent-client";
import { installSessionReadReceipts } from "~/lib/session-read-receipts";
import {
  translationFixtureFamily,
  translationFixtureKey,
} from "~/test/translation-query-bindings";
import type {
  AcceptedTranslationReceipt,
  TranslationIntentEnvelope,
  TranslationOperation,
  TranslationReceiptResult,
} from "~/lib/translation-intent";

const fixture = vi.hoisted(() => ({
  failRead: false,
  failOriginOnly: false,
  failCatalog: false,
  role: "TUTOR",
  denyRead: false,
  nullRead: false,
  rejectWrite: false,
  write: null as Promise<void> | null,
  readGate: null as Promise<void> | null,
  reads: vi.fn(),
  originFetches: vi.fn(),
  saves:
    vi.fn<
      (
        input: Record<string, unknown> & { intent: TranslationIntentEnvelope },
      ) => void
    >(),
  failedReads: vi.fn(),
  intentClient: undefined as
    IntentClientModule.TranslationIntentClient | undefined,
  ledger: new Map<string, TranslationReceiptResult>(),
  metadataReads: vi.fn(),
  stops: vi.fn(),
  loseAcceptedResponse: false,
  persistedAtWrite: vi.fn<(raw: string | null) => void>(),
}));
vi.mock("~/lib/translation-intent-client", async (importOriginal) => {
  const actual = await importOriginal<typeof IntentClientModule>();
  return {
    ...actual,
    get translationIntentClient() {
      return fixture.intentClient!;
    },
  };
});
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("~/trpc/react", async () => {
  const { useMutation, useQuery, useQueryClient } =
    await import("@tanstack/react-query");
  const {
    translationFixtureKey,
    translationFixtureFamily,
    translationFixtureProcedure,
  } = await import("~/test/translation-query-bindings");
  type SaveOptions = UseMutationOptions<
    { ok: true; receipt: AcceptedTranslationReceipt },
    Error,
    Record<string, unknown> & { intent: TranslationIntentEnvelope }
  >;
  const mutation = (operation: TranslationOperation) => ({
    useMutation: (options: SaveOptions) =>
      useMutation({
        mutationFn: async (
          input: Record<string, unknown> & {
            intent: TranslationIntentEnvelope;
          },
        ) => {
          fixture.saves(input);
          fixture.persistedAtWrite(
            sessionStorage.getItem("translation-intents:v1"),
          );
          if (fixture.write) await fixture.write;
          if (fixture.rejectWrite) throw new Error("Synthetic rejected write");
          if (fixture.ledger.get(input.intent.id)?.status === "STOPPED")
            throw new Error("Synthetic stopped before admission");
          const receipt: AcceptedTranslationReceipt = {
            status: "ACCEPTED",
            version: 1,
            intentId: input.intent.id,
            operation,
            mode: input.intent.mode,
            outcome:
              input.intent.mode === "DRAFT" ? "DRAFT_SUBMITTED" : "PUBLISHED",
            acceptedAt: new Date("2026-11-09"),
            draftId: input.intent.mode === "DRAFT" ? "synthetic-draft" : null,
            cleared: operation === "home.setContent" ? false : null,
            replayed: false,
          };
          fixture.ledger.set(input.intent.id, receipt);
          if (fixture.loseAcceptedResponse)
            throw new Error("Synthetic response lost");
          // The write and its response are accepted. Only the subsequent read fails.
          fixture.failRead = true;
          return { ok: true as const, receipt };
        },
        ...options,
      }),
  });
  const destinationOptions = (kind: string, locale: string) => ({
    queryKey: translationFixtureKey(
      `home.${kind}`,
      kind === "content" ? { locale } : undefined,
    ),
    queryFn: async () => {
      fixture.reads(kind, locale);
      if (fixture.readGate) await fixture.readGate;
      if (fixture.denyRead)
        throw Object.assign(new Error("Synthetic denied read"), {
          data: { code: "FORBIDDEN" },
        });
      if (fixture.nullRead) return null;
      if (
        fixture.failRead &&
        (!fixture.failOriginOnly || (kind === "content" && locale === "en"))
      ) {
        fixture.failedReads();
        throw new Error("Synthetic website refresh unavailable");
      }
      return [
        {
          key: "tagline",
          kind: "text",
          default: "Original",
          override: null,
          id: "destination",
          slug: "Original",
          title: { en: "Original", zh: "Original" },
          translations: [{ locale: "en", title: "Original", body: "Original" }],
        },
      ];
    },
    retry: false,
  });
  const useDestination = (kind: string, locale: string, enabled: boolean) =>
    useQuery({ ...destinationOptions(kind, locale), enabled });
  return {
    api: {
      account: {
        me: {
          ...translationFixtureProcedure("account.me"),
          useQuery: () =>
            useQuery({
              queryKey: translationFixtureKey("account.me"),
              queryFn: async () => ({
                id: "composer-actor",
                role: fixture.role,
                canTranslate: true,
              }),
            }),
        },
      },
      i18n: {
        managedLanguages: {
          ...translationFixtureProcedure("i18n.managedLanguages"),
          useQuery: () =>
            useQuery({
              queryKey: translationFixtureKey("i18n.managedLanguages"),
              queryFn: async () => {
                if (fixture.failCatalog)
                  throw new Error("Synthetic managed catalogue unavailable");
                return [
                  { code: "en", label: "English" },
                  { code: "zh", label: "中文" },
                ];
              },
            }),
        },
      },
      home: {
        content: {
          ...translationFixtureProcedure("home.content"),
          useQuery: (
            { locale }: { locale: string },
            options: { enabled: boolean },
          ) => useDestination("content", locale, options.enabled),
        },
        news: {
          ...translationFixtureProcedure("home.news"),
          useQuery: (_input: unknown, options: { enabled: boolean }) =>
            useDestination("news", "all", options.enabled),
        },
        sections: {
          ...translationFixtureProcedure("home.sections"),
          useQuery: (_input: unknown, options: { enabled: boolean }) =>
            useDestination("sections", "all", options.enabled),
        },
        pages: {
          ...translationFixtureProcedure("home.pages"),
          useQuery: (_input: unknown, options: { enabled: boolean }) =>
            useDestination("pages", "all", options.enabled),
        },
        setContent: mutation("home.setContent"),
        setNewsTranslation: mutation("home.setNewsTranslation"),
        setSectionTranslation: mutation("home.setSectionTranslation"),
        setPageTitle: mutation("home.setPageTitle"),
      },
      translationIntent: {
        stop: {
          useMutation: () =>
            useMutation({
              mutationFn: async ({
                intentId,
              }: {
                actorId: string;
                intentId: string;
              }) => {
                fixture.stops(intentId);
                const receipt = fixture.ledger.get(intentId) ?? {
                  status: "STOPPED" as const,
                  version: 1 as const,
                  intentId,
                  stoppedAt: new Date("2026-11-09"),
                };
                fixture.ledger.set(intentId, receipt);
                return receipt;
              },
              retry: false,
            }),
        },
      },
      useUtils: () => {
        const client = useQueryClient();
        const getIntent = async ({
          intentId,
        }: {
          actorId: string;
          intentId: string;
        }) => {
          fixture.metadataReads(intentId);
          return (
            fixture.ledger.get(intentId) ?? {
              status: "NOT_RECORDED",
              version: 1,
              intentId,
            }
          );
        };
        return {
          client: { translationIntent: { get: { query: getIntent } } },
          translationIntent: { get: { fetch: getIntent } },
          translationReview: {
            list: {
              invalidate: () =>
                client.invalidateQueries({
                  queryKey: translationFixtureFamily("translationReview.list"),
                }),
            },
          },
          home: {
            content: {
              fetch: ({ locale }: { locale: string }) => {
                fixture.originFetches(locale);
                return client.fetchQuery({
                  ...destinationOptions("content", locale),
                  staleTime: 0,
                });
              },
            },
            news: {
              fetch: () =>
                client.fetchQuery({
                  ...destinationOptions("news", "all"),
                  staleTime: 0,
                }),
            },
            sections: {
              fetch: () =>
                client.fetchQuery({
                  ...destinationOptions("sections", "all"),
                  staleTime: 0,
                }),
            },
            pages: {
              fetch: () =>
                client.fetchQuery({
                  ...destinationOptions("pages", "all"),
                  staleTime: 0,
                }),
            },
            invalidate: (
              _input?: unknown,
              filters?: QueryFilters,
              options?: { throwOnError?: boolean },
            ) =>
              client.invalidateQueries(
                { queryKey: translationFixtureFamily("home"), ...filters },
                options,
              ),
          },
        };
      },
    },
  };
});

import { TranslationComposer } from "./translation-composer";
import { TranslationIntentRecovery } from "./translation-intent-recovery";
import { createTranslationIntentClient } from "~/lib/translation-intent-client";

beforeEach(() => {
  vi.clearAllMocks();
  fixture.failRead = false;
  fixture.failOriginOnly = false;
  fixture.failCatalog = false;
  fixture.role = "TUTOR";
  fixture.denyRead = false;
  fixture.nullRead = false;
  fixture.rejectWrite = false;
  fixture.write = null;
  fixture.readGate = null;
  fixture.loseAcceptedResponse = false;
  fixture.ledger.clear();
  sessionStorage.clear();
  fixture.intentClient = createTranslationIntentClient(() => sessionStorage);
});
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
});

function mount(recovery = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  installSessionReadReceipts(client);
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      {recovery && <TranslationIntentRecovery actorId="composer-actor" />}
      <TranslationComposer />
    </QueryClientProvider>,
  );
  return client;
}

async function fill(kind = "content") {
  await screen.findByRole("option", { name: "Original" });
  if (kind !== "content") {
    fireEvent.change(screen.getByLabelText("contentType"), {
      target: { value: kind },
    });
    await screen.findByRole("option", { name: "Original" });
  }
  fireEvent.change(screen.getByLabelText("target"), {
    target: { value: kind === "content" ? "tagline" : "destination" },
  });
  fireEvent.change(screen.getByLabelText("translation"), {
    target: { value: "Synthetic retained draft" },
  });
}

it.each(["content", "news", "sections", "pages"])(
  "an accepted %s draft with a failed refresh recovers through reads without submitting another draft",
  async (kind) => {
    mount();
    await fill(kind);
    fireEvent.click(screen.getByRole("button", { name: "submitDraft" }));
    await waitFor(() => expect(fixture.saves).toHaveBeenCalledTimes(1));
    const envelope = fixture.saves.mock.calls[0]![0].intent;
    const uuid: unknown = expect.stringMatching(/^[0-9a-f-]{36}$/);
    expect(envelope).toEqual({
      version: 1,
      id: uuid,
      actorId: "composer-actor",
      mode: "DRAFT",
    });
    expect(fixture.ledger.get(envelope.id)).toMatchObject({
      status: "ACCEPTED",
      operation: (
        {
          content: "home.setContent",
          news: "home.setNewsTranslation",
          sections: "home.setSectionTranslation",
          pages: "home.setPageTitle",
        } as Record<string, TranslationOperation>
      )[kind],
      mode: "DRAFT",
    });
    const stored = fixture.persistedAtWrite.mock.calls[0]![0];
    if (stored === null)
      throw new Error("Intent metadata was absent before the POST");
    const metadata: unknown = JSON.parse(stored);
    expect(metadata).toEqual([
      {
        id: envelope.id,
        actorId: "composer-actor",
        operation: (
          {
            content: "home.setContent",
            news: "home.setNewsTranslation",
            sections: "home.setSectionTranslation",
            pages: "home.setPageTitle",
          } as Record<string, TranslationOperation>
        )[kind],
        mode: "DRAFT",
      },
    ]);
    await waitFor(() => expect(fixture.failedReads).toHaveBeenCalled());
    await screen.findByRole("alert");

    // This is the documented recovery control, not a second click of Submit draft.
    const recovery = screen.getByRole("button", { name: /retry|refresh/i });
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "submitDraft" })
        .disabled,
    ).toBe(true);
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("translation").value,
    ).toBe("Synthetic retained draft");
    expect(screen.getByText("acceptedRefreshFailed")).toBeTruthy();
    // A still-failed Retry performs reads only, and never releases the accepted intent.
    fireEvent.click(recovery);
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: /retry|refresh/i,
        }).disabled,
      ).toBe(false),
    );
    expect(fixture.saves).toHaveBeenCalledTimes(1);
    fixture.failRead = false;
    fireEvent.click(recovery);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(fixture.saves).toHaveBeenCalledTimes(1);
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("translation").value,
    ).toBe("Synthetic retained draft");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "submitDraft" })
        .disabled,
    ).toBe(true);
  },
);

it("admits one pending write and freezes its captured payload", async () => {
  const anyId: unknown = expect.any(String);
  mount();
  await fill();
  let release!: () => void;
  fixture.write = new Promise<void>((resolve) => {
    release = resolve;
  });
  const form = screen
    .getByRole("button", { name: "submitDraft" })
    .closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(fixture.saves).toHaveBeenCalledTimes(1));
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("translation").disabled,
  ).toBe(true);
  expect(screen.getByLabelText<HTMLSelectElement>("locale").disabled).toBe(
    true,
  );
  expect(fixture.saves).toHaveBeenCalledWith({
    locale: "en",
    key: "tagline",
    value: "Synthetic retained draft",
    intent: { version: 1, id: anyId, actorId: "composer-actor", mode: "DRAFT" },
  });
  await act(async () => {
    release();
  });
  await screen.findByText("acceptedRefreshFailed");
});

it("retains a rejected write, requires a durable Stop, and then permits deliberate retry", async () => {
  fixture.rejectWrite = true;
  mount(true);
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "submitDraft" }));
  await screen.findByText("Synthetic rejected write");
  expect(screen.getByLabelText<HTMLTextAreaElement>("translation").value).toBe(
    "Synthetic retained draft",
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "submitDraft" })
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "stop" }));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "submitDraft" })
        .disabled,
    ).toBe(false),
  );
  fixture.rejectWrite = false;
  fireEvent.click(screen.getByRole("button", { name: "submitDraft" }));
  await screen.findByText("acceptedRefreshFailed");
  expect(fixture.saves).toHaveBeenCalledTimes(2);
});

it("keeps accepted receipt and independent drafts through locale round trips", async () => {
  const client = mount();
  const changeLocale = async (locale: "en" | "zh") => {
    fireEvent.change(screen.getByLabelText("locale"), {
      target: { value: locale },
    });
    const read = client.getQueryCache().find({
      queryKey: translationFixtureKey("home.content", { locale }),
      exact: true,
    });
    const pendingRead = read?.promise;
    if (!read || !pendingRead)
      throw new Error("Expected the selected locale's existing content read");
    await act(async () => {
      await pendingRead;
    });
    expect(read.state.status).toBe("success");
    expect(read.state.fetchStatus).toBe("idle");
  };
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "submitDraft" }));
  await screen.findByText("acceptedRefreshFailed");
  fixture.failRead = false;
  fireEvent.click(screen.getByRole("button", { name: "retryRead" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("locale").disabled).toBe(
      false,
    ),
  );
  await changeLocale("zh");
  await screen.findByRole("option", { name: "Original" });
  fireEvent.change(screen.getByLabelText("target"), {
    target: { value: "tagline" },
  });
  fireEvent.change(screen.getByLabelText("translation"), {
    target: { value: "Independent Chinese draft" },
  });
  await changeLocale("en");
  expect(screen.getByText("submitted")).toBeTruthy();
  expect(screen.getByLabelText<HTMLTextAreaElement>("translation").value).toBe(
    "Synthetic retained draft",
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "submitDraft" })
      .disabled,
  ).toBe(true);
  await changeLocale("zh");
  expect(screen.getByLabelText<HTMLTextAreaElement>("translation").value).toBe(
    "Independent Chinese draft",
  );
  expect(fixture.saves).toHaveBeenCalledTimes(1);
});

it("retries the captured origin even after changing to another available content scope", async () => {
  fixture.failOriginOnly = true;
  mount();
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "submitDraft" }));
  await screen.findByText("acceptedRefreshFailed");
  fireEvent.change(screen.getByLabelText("contentType"), {
    target: { value: "news" },
  });
  await screen.findByRole("option", { name: "Original" });
  fireEvent.change(screen.getByLabelText("target"), {
    target: { value: "destination" },
  });
  fireEvent.change(screen.getByLabelText("translation"), {
    target: { value: "Independent news draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "retryRead" }));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "retryRead" })
        .disabled,
    ).toBe(false),
  );
  expect(screen.getByText("acceptedRefreshFailed")).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "submitDraft" })
      .disabled,
  ).toBe(true);
  expect(fixture.saves).toHaveBeenCalledTimes(1);
  fixture.failRead = false;
  fireEvent.click(screen.getByRole("button", { name: "retryRead" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "submitDraft" })
      .disabled,
  ).toBe(false);
  expect(screen.getByLabelText<HTMLTextAreaElement>("translation").value).toBe(
    "Independent news draft",
  );
});

it("offers read-only recovery for an initial managed-language failure", async () => {
  fixture.failCatalog = true;
  const client = mount();
  await screen.findByText("Synthetic managed catalogue unavailable");
  expect(screen.getByLabelText<HTMLSelectElement>("target").disabled).toBe(
    true,
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "submitDraft" })
      .disabled,
  ).toBe(true);
  expect(fixture.saves).not.toHaveBeenCalled();
  fixture.failCatalog = false;
  fireEvent.click(screen.getByRole("button", { name: "retryRead" }));
  await waitFor(() => {
    for (const key of [
      translationFixtureKey("account.me"),
      translationFixtureKey("i18n.managedLanguages"),
      translationFixtureKey("home.content", { locale: "en" }),
    ]) {
      const read = client.getQueryState(key);
      expect(read?.status).toBe("success");
      expect(read?.fetchStatus).toBe("idle");
      expect(read?.error).toBeNull();
      expect(read?.data).toBeDefined();
      expect(read?.data).not.toBeNull();
    }
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText<HTMLSelectElement>("target").disabled).toBe(
      false,
    );
  });
  // Destination options can load before the failed language prerequisite. Fill
  // only once its real reads and committed editor have released that gate.
  await fill();
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "submitDraft" })
        .disabled,
    ).toBe(false),
  );
  expect(fixture.saves).not.toHaveBeenCalled();
});

it("waits for active invalidation reads before fetching the captured origin", async () => {
  mount();
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "submitDraft" }));
  await screen.findByText("acceptedRefreshFailed");
  fixture.failRead = false;
  let release!: () => void;
  fixture.readGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reads = fixture.reads.mock.calls.length;
  const origins = fixture.originFetches.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "retryRead" }));
  await waitFor(() =>
    expect(fixture.reads.mock.calls.length).toBeGreaterThan(reads),
  );
  expect(fixture.originFetches).toHaveBeenCalledTimes(origins);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "retryRead" })
      .disabled,
  ).toBe(true);
  await act(async () => {
    release();
  });
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(fixture.originFetches).toHaveBeenCalledTimes(origins + 1);
  expect(fixture.saves).toHaveBeenCalledTimes(1);
});

it("recovers newly failed catalogue prerequisites and the accepted origin in one Retry", async () => {
  const client = mount();
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "submitDraft" }));
  await screen.findByText("acceptedRefreshFailed");
  fixture.failCatalog = true;
  await act(async () => {
    await client.invalidateQueries({
      queryKey: translationFixtureFamily("i18n.managedLanguages"),
    });
  });
  fixture.failRead = false;
  fixture.failCatalog = false;
  fireEvent.click(screen.getByRole("button", { name: "retryRead" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.queryByRole("button", { name: "retryRead" })).toBeNull();
  expect(fixture.saves).toHaveBeenCalledTimes(1);
});

it("conceals denied cached content through successful null and later transport failure until a fresh authorized read", async () => {
  const client = mount();
  await fill();
  fixture.denyRead = true;
  await act(async () => {
    await client.invalidateQueries({
      queryKey: translationFixtureFamily("home"),
    });
  });
  await screen.findByText("noAccess");
  expect(screen.queryByLabelText("translation")).toBeNull();
  fixture.denyRead = false;
  fixture.nullRead = true;
  fireEvent.click(screen.getByRole("button", { name: "retryRead" }));
  await waitFor(() =>
    expect(
      client.getQueryData(
        translationFixtureKey("home.content", { locale: "en" }),
      ),
    ).toBeNull(),
  );
  expect(screen.queryByLabelText("translation")).toBeNull();
  fixture.nullRead = false;
  fixture.failRead = true;
  fireEvent.click(screen.getByRole("button", { name: "retryRead" }));
  await waitFor(() => expect(fixture.failedReads).toHaveBeenCalled());
  expect(screen.queryByLabelText("translation")).toBeNull();
  fixture.failRead = false;
  fireEvent.click(screen.getByRole("button", { name: "retryRead" }));
  await screen.findByLabelText("translation");
  expect(fixture.saves).not.toHaveBeenCalled();
});

it.each(["content", "news", "sections", "pages"])(
  "stops a hanging %s POST, admits a new UUID, and ignores the stopped transport's late completion",
  async (kind) => {
    mount(true);
    await fill(kind);
    let finishOld!: () => void;
    fixture.write = new Promise<void>((resolve) => {
      finishOld = resolve;
    });
    fireEvent.click(screen.getByRole("button", { name: "submitDraft" }));
    await waitFor(() => expect(fixture.saves).toHaveBeenCalledTimes(1));
    const original = fixture.saves.mock.calls[0]![0];
    fireEvent.click(await screen.findByRole("button", { name: "stop" }));
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLTextAreaElement>("translation").disabled,
      ).toBe(false),
    );
    let finishNew!: () => void;
    fixture.write = new Promise<void>((resolve) => {
      finishNew = resolve;
    });
    fireEvent.change(screen.getByLabelText("translation"), {
      target: { value: "Deliberate replacement" },
    });
    fireEvent.click(screen.getByRole("button", { name: "submitDraft" }));
    await waitFor(() => expect(fixture.saves).toHaveBeenCalledTimes(2));
    const replacement = fixture.saves.mock.calls[1]![0];
    expect(replacement.intent.id).not.toBe(original.intent.id);
    const reads = fixture.reads.mock.calls.length;
    await act(async () => {
      finishOld();
    });
    expect(fixture.reads).toHaveBeenCalledTimes(reads);
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("translation").value,
    ).toBe("Deliberate replacement");
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("translation").disabled,
    ).toBe(true);
    expect(fixture.saves).toHaveBeenCalledTimes(2);
    await act(async () => {
      finishNew();
    });
    await screen.findByText("acceptedRefreshFailed");
    expect(fixture.saves).toHaveBeenCalledTimes(2);
  },
);

it("discovers a lost accepted website response by metadata GET without replaying its POST", async () => {
  fixture.loseAcceptedResponse = true;
  mount(true);
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "submitDraft" }));
  await screen.findByText("unknown");
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("translation").disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "lookup" }));
  await screen.findByText("submitted");
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("translation").disabled,
    ).toBe(false),
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "submitDraft" })
      .disabled,
  ).toBe(true);
  expect(fixture.saves).toHaveBeenCalledTimes(1);
  expect(fixture.metadataReads).toHaveBeenCalledTimes(1);
});
