/** @vitest-environment jsdom */
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
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  AcceptedTranslationReceipt,
  TranslationIntentEnvelope,
  TranslationOperation,
  TranslationReceiptResult,
} from "~/lib/translation-intent";

type ReadMode = "ok" | "error" | "denied" | "null";
const fixture = vi.hoisted(() => ({
  account: ((): ReadMode => "ok")(),
  languages: ((): ReadMode => "ok")(),
  strings: ((): ReadMode => "ok")(),
  actor: "translation-actor",
  canTranslate: true,
  failAfterWrite: false,
  denyAfterWrite: false,
  writeGate: null as Promise<void> | null,
  writes: vi.fn<(name: string, input: Record<string, unknown>) => void>(),
  reads: vi.fn<
    (
      name: string,
      input?: {
        locale?: string;
        refLocales?: string[];
        page?: number;
        state?: string;
      },
    ) => void
  >(),
  observed: new Map<
    symbol,
    {
      key: string;
      data: unknown;
      error: unknown;
      status: string;
      dataUpdatedAt: number;
      errorUpdatedAt: number;
      isFetching: boolean;
    }
  >(),
  intentClient: undefined as
    IntentClientModule.TranslationIntentClient | undefined,
  receipts: new Map<string, TranslationReceiptResult>(),
  metadataReads: vi.fn(),
  stops: vi.fn(),
  role: "ADMIN",
  dropResponse: false,
  rejectWrite: false,
  omitReceipt: false,
  metadata: ((): ReadMode => "ok")(),
  persistedAtWrite: vi.fn<(raw: string | null) => void>(),
  rawAuthorityError: ((): "" | "FORBIDDEN" | "UNAUTHORIZED" => "")(),
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
  useFormatter: () => ({ dateTime: () => "Synthetic date" }),
}));
vi.mock("./student-portal", () => ({ Pager: () => null }));
vi.mock("~/trpc/react", async () => {
  const { useMutation, useQuery, useQueryClient } =
    await import("@tanstack/react-query");
  const {
    translationFixtureKey,
    translationFixtureFamily,
    translationFixtureProcedure,
  } = await import("~/test/translation-query-bindings");
  const paths: Record<string, string> = {
    account: "account.me",
    languages: "i18n.managedLanguages",
    capability: "i18n.canManageLanguages",
    strings: "localization.strings",
    content: "home.content",
    news: "home.news",
    sections: "home.sections",
    pages: "home.pages",
    review: "translationReview.list",
    "public-languages": "i18n.languages",
  };
  const { useLayoutEffect, useRef } = await import("react");
  type Scope = {
    locale?: string;
    refLocales?: string[];
    page?: number;
    state?: string;
  };
  type Input = Record<string, unknown>;
  type Options = UseMutationOptions<
    { ok: true; receipt?: AcceptedTranslationReceipt },
    Error,
    Input
  >;
  type Filters = QueryFilters;
  const queryOptions = (name: string, input?: Scope) => ({
    queryKey: translationFixtureKey(paths[name]!, input),
    queryFn: async () => {
      fixture.reads(name, input);
      const mode =
        name === "account"
          ? fixture.account
          : name === "languages"
            ? fixture.languages
            : name === "strings"
              ? fixture.strings
              : "ok";
      if (mode === "denied")
        throw Object.assign(new Error(`Synthetic ${name} denied`), {
          data: { code: "FORBIDDEN" },
        });
      if (mode === "error") throw new Error(`Synthetic ${name} unavailable`);
      if (mode === "null") return null;
      if (name === "account")
        return {
          id: fixture.actor,
          role: fixture.role,
          canTranslate: fixture.canTranslate,
        };
      if (name === "languages")
        return [
          { code: "en", label: "English", enabled: true, builtIn: true },
          { code: "zh", label: "中文", enabled: true, builtIn: true },
          {
            code: "pt-br",
            label: "Private managed language",
            enabled: false,
            builtIn: false,
          },
        ];
      if (name === "capability") return true;
      if (name === "strings")
        return [
          {
            key: "common.title",
            en: "Private English source",
            base:
              input?.locale === "zh" ? "中文原文" : "Private English source",
            override: null,
          },
          {
            key: "other.title",
            en: "Private other source",
            base: "Private other source",
            override: null,
          },
        ];
      if (name === "content")
        return [
          {
            key: "tagline",
            kind: "text",
            default: "Private website destination",
            override: null,
          },
        ];
      if (name === "review")
        return [
          {
            id: "private-draft",
            operation: "localization.setString",
            state: "PENDING",
            payload: {
              locale: "en",
              key: "common.title",
              value: "Private review text",
            },
            createdAt: new Date("2026-10-01"),
            updatedAt: new Date("2026-10-01"),
            needsResubmission: false,
          },
        ];
      return [];
    },
    retry: false,
  });
  const read = (name: string) => ({
    ...translationFixtureProcedure(paths[name]!),
    useQuery: (input?: Scope, options?: { enabled?: boolean }) => {
      const result = useQuery({ ...queryOptions(name, input), ...options });
      const owner = useRef(Symbol(name)).current;
      const observed = {
        key: JSON.stringify([name, input]),
        data: result.data,
        error: result.error,
        status: result.status,
        dataUpdatedAt: result.dataUpdatedAt,
        errorUpdatedAt: result.errorUpdatedAt,
        isFetching: result.isFetching,
      };
      // Shared queries have distinct owners. Activity can render optimistically
      // while hidden without publishing effects; only committed owners count.
      useLayoutEffect(() => {
        fixture.observed.set(owner, observed);
        return () => {
          fixture.observed.delete(owner);
        };
      });
      return result;
    },
  });
  const mutation = (name: string) => ({
    useMutation: (options?: Options) =>
      useMutation({
        mutationFn: async (input: Input) => {
          fixture.writes(name, input);
          fixture.persistedAtWrite(
            sessionStorage.getItem("translation-intents:v1"),
          );
          if (fixture.writeGate) await fixture.writeGate;
          if (fixture.rawAuthorityError)
            throw Object.assign(
              new Error("Synthetic write authority refused"),
              { data: { code: fixture.rawAuthorityError } },
            );
          if (fixture.rejectWrite)
            throw new Error("Synthetic write response lost before admission");
          const operation = (
            {
              setString: "localization.setString",
              setContent: "home.setContent",
              setNewsTranslation: "home.setNewsTranslation",
              setSectionTranslation: "home.setSectionTranslation",
              setPageTitle: "home.setPageTitle",
            } as Record<string, TranslationOperation>
          )[name];
          let receipt: AcceptedTranslationReceipt | undefined;
          if (operation) {
            const intent = input.intent as TranslationIntentEnvelope;
            if (fixture.receipts.get(intent.id)?.status === "STOPPED")
              throw new Error("Synthetic intent already stopped");
            receipt = {
              status: "ACCEPTED",
              version: 1,
              intentId: intent.id,
              operation,
              mode: intent.mode,
              outcome:
                intent.mode === "DRAFT" ? "DRAFT_SUBMITTED" : "PUBLISHED",
              acceptedAt: new Date("2026-11-09"),
              draftId: intent.mode === "DRAFT" ? "synthetic-draft" : null,
              cleared:
                operation === "localization.setString" ||
                operation === "home.setContent"
                  ? false
                  : null,
              replayed: false,
            };
            fixture.receipts.set(intent.id, receipt);
            if (fixture.dropResponse)
              throw new Error("Synthetic accepted response lost");
          }
          if (fixture.failAfterWrite && name === "setString")
            fixture.strings = "error";
          if (fixture.denyAfterWrite && name === "setString")
            fixture.strings = "denied";
          return {
            ok: true as const,
            receipt: fixture.omitReceipt ? undefined : receipt,
          };
        },
        ...options,
      }),
  });
  return {
    api: {
      account: { me: read("account") },
      i18n: {
        managedLanguages: read("languages"),
        canManageLanguages: read("capability"),
        addLanguage: mutation("addLanguage"),
        reorderLanguages: mutation("reorderLanguages"),
        deleteLanguage: mutation("deleteLanguage"),
        setLanguageEnabled: mutation("setLanguageEnabled"),
      },
      localization: {
        strings: read("strings"),
        setString: mutation("setString"),
      },
      home: {
        content: read("content"),
        news: read("news"),
        sections: read("sections"),
        pages: read("pages"),
        setContent: mutation("setContent"),
        setNewsTranslation: mutation("setNewsTranslation"),
        setSectionTranslation: mutation("setSectionTranslation"),
        setPageTitle: mutation("setPageTitle"),
      },
      translationReview: { list: read("review"), decide: mutation("decide") },
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
                const receipt = fixture.receipts.get(intentId) ?? {
                  status: "STOPPED" as const,
                  version: 1 as const,
                  intentId,
                  stoppedAt: new Date("2026-11-09"),
                };
                fixture.receipts.set(intentId, receipt);
                return receipt;
              },
              retry: false,
            }),
        },
      },
      useUtils: () => {
        const client = useQueryClient();
        const target = (name: string) => ({
          invalidate: (
            _input?: unknown,
            filters?: Filters,
            options?: { throwOnError?: boolean },
          ) =>
            client.invalidateQueries(
              { queryKey: translationFixtureFamily(paths[name]!), ...filters },
              options,
            ),
          fetch: (input?: Scope) =>
            client.fetchQuery({ ...queryOptions(name, input), staleTime: 0 }),
        });
        const getIntent = async ({
          intentId,
        }: {
          actorId: string;
          intentId: string;
        }) => {
          fixture.metadataReads(intentId);
          if (fixture.metadata === "null") return null;
          if (fixture.metadata === "error")
            throw new Error("Synthetic receipt transport failure");
          if (fixture.metadata === "denied")
            throw Object.assign(new Error("Synthetic receipt denial"), {
              data: { code: "FORBIDDEN" },
            });
          return (
            fixture.receipts.get(intentId) ?? {
              status: "NOT_RECORDED",
              version: 1,
              intentId,
            }
          );
        };
        return {
          client: { translationIntent: { get: { query: getIntent } } },
          translationIntent: { get: { fetch: getIntent } },
          localization: { strings: target("strings") },
          translationReview: { list: target("review") },
          i18n: {
            managedLanguages: target("languages"),
            languages: target("public-languages"),
          },
          home: {
            ...target("content"),
            content: target("content"),
            news: target("news"),
            sections: target("sections"),
            pages: target("pages"),
          },
        };
      },
    },
  };
});
import { TranslationEditor } from "./translation-editor";
import { createTranslationIntentClient } from "~/lib/translation-intent-client";

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.account = "ok";
  fixture.languages = "ok";
  fixture.strings = "ok";
  fixture.actor = "translation-actor";
  fixture.canTranslate = true;
  fixture.failAfterWrite = false;
  fixture.denyAfterWrite = false;
  fixture.writeGate = null;
  fixture.observed.clear();
  fixture.role = "ADMIN";
  fixture.dropResponse = false;
  fixture.rejectWrite = false;
  fixture.omitReceipt = false;
  fixture.metadata = "ok";
  fixture.rawAuthorityError = "";
  fixture.receipts.clear();
  sessionStorage.clear();
  fixture.intentClient = createTranslationIntentClient(() => sessionStorage);
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  installSessionReadReceipts(client);
});
afterEach(() => {
  cleanup();
  client.clear();
});
const show = () =>
  render(
    <QueryClientProvider client={client}>
      <TranslationEditor />
    </QueryClientProvider>,
  );
const field = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: "common.title" });
const ensureCommonOpen = () => {
  const control = screen.getByRole("button", { name: /^Common/ });
  if (control.getAttribute("aria-expanded") !== "true")
    fireEvent.click(control);
};
const openStrings = async () => {
  await screen.findByRole("button", { name: /^Common/ });
  ensureCommonOpen();
  await screen.findByLabelText("common.title");
};
const fixturePaths: Record<string, string> = {
  account: "account.me",
  languages: "i18n.managedLanguages",
  strings: "localization.strings",
};
const refresh = async (name: string) => {
  await act(async () => {
    await client.invalidateQueries({
      queryKey: translationFixtureFamily(fixturePaths[name]!),
    });
  });
  // Fetch completion can precede useBaseQuery's batched observer publication.
  // Wait for every committed hook owner, without changing the query scheduler.
  // Hidden/unmounted Activities remove their records instead of leaving a last
  // optimistic render to stand in for another instance of the same query.
  await waitFor(() => {
    const queries = client
      .getQueryCache()
      .findAll({ queryKey: translationFixtureFamily(fixturePaths[name]!) });
    // TranslationEditor's account reader is always mounted, including denial.
    // Account refresh must observe publication rather than pass with no owner.
    if (name === "account") expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      const key = JSON.stringify([
        name,
        (query.queryKey[1] as { input?: unknown } | undefined)?.input,
      ]);
      const owners = [...fixture.observed.values()].filter(
        (observed) => observed.key === key,
      );
      if (name === "account") expect(owners.length).toBeGreaterThan(0);
      for (const observed of owners) {
        expect(observed.data).toBe(query.state.data);
        expect(observed.error).toBe(query.state.error);
        expect(observed.status).toBe(query.state.status);
        expect(observed.dataUpdatedAt).toBe(query.state.dataUpdatedAt);
        expect(observed.errorUpdatedAt).toBe(query.state.errorUpdatedAt);
        expect(observed.isFetching).toBe(
          query.state.fetchStatus === "fetching",
        );
      }
    }
  });
};
const retryAccount = async () => {
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "retry" }).disabled,
    ).toBe(false),
  );
};

it("keeps shared account denial through transport and null reads and removes private DOM in every visited tab", async () => {
  show();
  await openStrings();
  fireEvent.change(field(), { target: { value: "Private retained draft" } });
  fireEvent.click(screen.getByRole("tab", { name: "website" }));
  await screen.findByRole("option", { name: "Private website destination" });
  fireEvent.click(screen.getByRole("tab", { name: "review" }));
  await screen.findByText("Private review text");
  fireEvent.click(screen.getByRole("tab", { name: "languagesHeading" }));
  await screen.findByRole("heading", { name: "localization.languagesHeading" });
  fixture.account = "denied";
  await refresh("account");
  await screen.findByText("noAccess");
  expect(screen.queryByText("Private review text")).toBeNull();
  expect(screen.queryByText("Private website destination")).toBeNull();
  expect(screen.queryByText("Private English source")).toBeNull();
  expect(screen.queryByLabelText("common.title")).toBeNull();
  expect(screen.queryByText("Private managed language")).toBeNull();
  for (const mode of ["error", "null"] as const) {
    fixture.account = mode;
    await retryAccount();
    expect(screen.queryByText("Private review text")).toBeNull();
    expect(screen.queryByLabelText("common.title")).toBeNull();
  }
  fixture.account = "ok";
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  await screen.findByRole("tab", { name: "strings" });
  fireEvent.click(screen.getByRole("tab", { name: "strings" }));
  await screen.findByRole("button", { name: /^Common/ });
  ensureCommonOpen();
  expect(field().value).toBe("Private retained draft");
  expect(fixture.writes).not.toHaveBeenCalled();
});

it.each(["account", "languages", "strings"] as const)(
  "retains ordinary failed %s reads and fences blur writes until read-only recovery",
  async (name) => {
    show();
    await openStrings();
    fireEvent.change(field(), {
      target: { value: "Unsubmitted retained text" },
    });
    fixture[name] = "error";
    await refresh(name);
    expect(field().value).toBe("Unsubmitted retained text");
    expect(field().matches(":disabled")).toBe(true);
    fireEvent.blur(field());
    expect(fixture.writes).not.toHaveBeenCalled();
    fixture[name] = "ok";
    const retries = screen.getAllByRole("button", { name: /retry/i });
    fireEvent.click(retries[0]!);
    await waitFor(() => expect(field().matches(":disabled")).toBe(false));
    expect(field().value).toBe("Unsubmitted retained text");
    expect(fixture.writes).not.toHaveBeenCalled();
  },
);

it("retains an admitted string operation across denial, row removal and same-actor regrant", async () => {
  show();
  await openStrings();
  let finish!: () => void;
  fixture.writeGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  fireEvent.change(field(), {
    target: { value: "Accepted retained translation" },
  });
  act(() => {
    fireEvent.blur(field());
    fireEvent.blur(field());
  });
  await waitFor(() => expect(fixture.writes).toHaveBeenCalledTimes(1));
  fixture.account = "denied";
  await refresh("account");
  expect(screen.queryByLabelText("common.title")).toBeNull();
  fixture.account = "ok";
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  await screen.findByRole("button", { name: /^Common/ });
  ensureCommonOpen();
  expect(field().disabled).toBe(true);
  fireEvent.blur(field());
  expect(fixture.writes).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
  });
  await waitFor(() => expect(field().disabled).toBe(false));
  fireEvent.blur(field());
  expect(fixture.writes).toHaveBeenCalledTimes(1);
});

it("retains accepted-string read recovery after denial and recovers its captured locale without replay", async () => {
  fixture.failAfterWrite = true;
  show();
  await openStrings();
  fireEvent.change(field(), { target: { value: "Accepted refresh receipt" } });
  fireEvent.blur(field());
  await screen.findByText("translationEditor.refreshFailed");
  fixture.account = "denied";
  await refresh("account");
  expect(screen.queryByText("Accepted refresh receipt")).toBeNull();
  fixture.account = "ok";
  fixture.strings = "ok";
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  await screen.findByRole("button", { name: /^Common/ });
  ensureCommonOpen();
  expect(field().disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "uiPatterns.retry" }));
  await waitFor(() => expect(field().disabled).toBe(false));
  fireEvent.blur(field());
  expect(fixture.writes).toHaveBeenCalledTimes(1);
});

it("removes unsent fields on successful capability loss and fresh regrant", async () => {
  show();
  await openStrings();
  fireEvent.change(field(), {
    target: { value: "Discard on capability loss" },
  });
  fixture.canTranslate = false;
  await refresh("account");
  expect(screen.queryByLabelText("common.title")).toBeNull();
  fixture.canTranslate = true;
  await refresh("account");
  fireEvent.click(screen.getByRole("tab", { name: "strings" }));
  await screen.findByRole("button", { name: /^Common/ });
  ensureCommonOpen();
  expect(field().value).toBe("Private English source");
  expect(fixture.writes).not.toHaveBeenCalled();
});

it("retains an admitted Strings lease through successful capability loss and regrant", async () => {
  show();
  await openStrings();
  let finish!: () => void;
  fixture.writeGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  fireEvent.change(field(), {
    target: { value: "Admitted before capability loss" },
  });
  fireEvent.blur(field());
  await waitFor(() => expect(fixture.writes).toHaveBeenCalledTimes(1));
  fixture.canTranslate = false;
  await refresh("account");
  expect(screen.queryByLabelText("common.title")).toBeNull();
  fixture.canTranslate = true;
  await refresh("account");
  fireEvent.click(screen.getByRole("tab", { name: "strings" }));
  await screen.findByRole("button", { name: /^Common/ });
  ensureCommonOpen();
  expect(field().disabled).toBe(true);
  fireEvent.blur(field());
  expect(fixture.writes).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
  });
  await waitFor(() => expect(field().disabled).toBe(false));
  fireEvent.blur(field());
  expect(fixture.writes).toHaveBeenCalledTimes(1);
});

it("keeps a known accepted website intent blocked across shared-account denial", async () => {
  show();
  await screen.findByRole("tab", { name: "website" });
  fireEvent.click(screen.getByRole("tab", { name: "website" }));
  await screen.findByRole("option", { name: "Private website destination" });
  fireEvent.change(screen.getByLabelText("target"), {
    target: { value: "tagline" },
  });
  fireEvent.change(screen.getByLabelText("translation"), {
    target: { value: "Known accepted website draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "publishEdit" }));
  await screen.findByText("published");
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "publishEdit" })
        .disabled,
    ).toBe(true),
  );
  fixture.account = "denied";
  await refresh("account");
  expect(screen.queryByLabelText("translation")).toBeNull();
  fixture.account = "ok";
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  await screen.findByLabelText("translation");
  expect(screen.getByLabelText<HTMLTextAreaElement>("translation").value).toBe(
    "Known accepted website draft",
  );
  fireEvent.submit(
    screen.getByRole("button", { name: "publishEdit" }).closest("form")!,
  );
  const anyId: unknown = expect.any(String);
  expect(fixture.writes).toHaveBeenCalledExactlyOnceWith("setContent", {
    locale: "en",
    key: "tagline",
    value: "Known accepted website draft",
    intent: {
      version: 1,
      id: anyId,
      actorId: "translation-actor",
      mode: "PUBLISH",
    },
  });
});

it("isolates a newly verified account owner from an older operation's late completion", async () => {
  show();
  await openStrings();
  let finish!: () => void;
  fixture.writeGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  fireEvent.change(field(), {
    target: { value: "Previous account pending text" },
  });
  fireEvent.blur(field());
  await waitFor(() => expect(fixture.writes).toHaveBeenCalledTimes(1));
  fixture.actor = "another-verified-account";
  await refresh("account");
  await screen.findByRole("button", { name: /^Common/ });
  ensureCommonOpen();
  expect(field().value).toBe("Private English source");
  const reads = fixture.reads.mock.calls.length;
  await act(async () => {
    finish();
  });
  expect(fixture.reads).toHaveBeenCalledTimes(reads);
  expect(field().value).toBe("Private English source");
  expect(field().disabled).toBe(false);
  expect(fixture.writes).toHaveBeenCalledTimes(1);
});

it("records acceptance while concealed without starting protected synchronization, then offers read-only recovery", async () => {
  show();
  await openStrings();
  let finish!: () => void;
  fixture.writeGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  fireEvent.change(field(), { target: { value: "Accepted while concealed" } });
  fireEvent.blur(field());
  await waitFor(() => expect(fixture.writes).toHaveBeenCalledTimes(1));
  fixture.account = "denied";
  await refresh("account");
  expect(screen.queryByLabelText("common.title")).toBeNull();
  const reads = fixture.reads.mock.calls.length;
  await act(async () => {
    finish();
  });
  expect(fixture.reads).toHaveBeenCalledTimes(reads);
  fixture.account = "ok";
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  await screen.findByRole("button", { name: /^Common/ });
  ensureCommonOpen();
  expect(field().disabled).toBe(true);
  expect(field().value).toBe("Accepted while concealed");
  fireEvent.click(screen.getByRole("button", { name: "uiPatterns.retry" }));
  await waitFor(() => expect(field().disabled).toBe(false));
  fireEvent.blur(field());
  expect(fixture.writes).toHaveBeenCalledTimes(1);
});

it("discards only unsent website contexts on verified capability loss and keeps the accepted snapshot", async () => {
  show();
  await screen.findByRole("tab", { name: "website" });
  fireEvent.click(screen.getByRole("tab", { name: "website" }));
  await screen.findByRole("option", { name: "Private website destination" });
  fireEvent.change(screen.getByLabelText("target"), {
    target: { value: "tagline" },
  });
  fireEvent.change(screen.getByLabelText("translation"), {
    target: { value: "Accepted English website text" },
  });
  fireEvent.click(screen.getByRole("button", { name: "publishEdit" }));
  await screen.findByText("published");
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("translation").disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText("translation"), {
    target: { value: "Unsent newer English edit" },
  });
  fireEvent.change(screen.getByLabelText("locale"), {
    target: { value: "zh" },
  });
  await screen.findByRole("option", { name: "Private website destination" });
  fireEvent.change(screen.getByLabelText("target"), {
    target: { value: "tagline" },
  });
  fireEvent.change(screen.getByLabelText("translation"), {
    target: { value: "Unsent Chinese context" },
  });
  fixture.canTranslate = false;
  await refresh("account");
  expect(screen.queryByLabelText("translation")).toBeNull();
  fixture.canTranslate = true;
  await refresh("account");
  fireEvent.click(screen.getByRole("tab", { name: "website" }));
  await screen.findByLabelText("translation");
  expect(screen.getByLabelText<HTMLTextAreaElement>("translation").value).toBe(
    "",
  );
  fireEvent.change(screen.getByLabelText("locale"), {
    target: { value: "en" },
  });
  const englishRead = client.getQueryCache().find({
    queryKey: translationFixtureKey("home.content", { locale: "en" }),
    exact: true,
  });
  const pendingEnglish = englishRead?.promise;
  if (!englishRead || !pendingEnglish)
    throw new Error(
      "Expected the selected English locale's existing content read",
    );
  await act(async () => {
    await pendingEnglish;
  });
  expect(englishRead.state.status).toBe("success");
  expect(englishRead.state.fetchStatus).toBe("idle");
  expect(screen.getByLabelText<HTMLTextAreaElement>("translation").value).toBe(
    "Accepted English website text",
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "publishEdit" })
      .disabled,
  ).toBe(true);
  expect(fixture.writes).toHaveBeenCalledTimes(1);
});

it("discards a newer unsent string edit on verified capability loss while preserving its accepted receipt", async () => {
  show();
  await openStrings();
  fireEvent.change(field(), { target: { value: "Accepted string snapshot" } });
  fireEvent.blur(field());
  await waitFor(() => expect(field().disabled).toBe(false));
  await screen.findByText("translationEditor.published");
  fireEvent.change(field(), { target: { value: "Unsent later string edit" } });
  fixture.canTranslate = false;
  await refresh("account");
  expect(screen.queryByLabelText("common.title")).toBeNull();
  fixture.canTranslate = true;
  await refresh("account");
  fireEvent.click(screen.getByRole("tab", { name: "strings" }));
  await screen.findByRole("button", { name: /^Common/ });
  ensureCommonOpen();
  expect(field().value).toBe("Accepted string snapshot");
  fireEvent.blur(field());
  expect(fixture.writes).toHaveBeenCalledTimes(1);
});

it("stops accepted synchronization after a child read denies access without starting another protected read phase", async () => {
  fixture.denyAfterWrite = true;
  show();
  await openStrings();
  const before = fixture.reads.mock.calls.filter(
    ([name]) => name === "strings",
  ).length;
  fireEvent.change(field(), {
    target: { value: "Accepted before child denial" },
  });
  fireEvent.blur(field());
  await screen.findByText("translationEditor.noAccess");
  expect(screen.queryByLabelText("common.title")).toBeNull();
  expect(
    fixture.reads.mock.calls.filter(([name]) => name === "strings"),
  ).toHaveLength(before + 1);
  fixture.strings = "ok";
  fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
  await screen.findByRole("button", { name: /^Common/ });
  ensureCommonOpen();
  fireEvent.click(screen.getByRole("button", { name: "uiPatterns.retry" }));
  await waitFor(() => expect(field().disabled).toBe(false));
  fireEvent.blur(field());
  expect(fixture.writes).toHaveBeenCalledTimes(1);
});

it.each(["lost", "missing-receipt"])(
  "checks an accepted string %s response without another POST or private persistent payload",
  async (response) => {
    fixture.dropResponse = response === "lost";
    fixture.omitReceipt = response === "missing-receipt";
    show();
    await openStrings();
    fireEvent.change(field(), {
      target: { value: "Private response-loss payload" },
    });
    fireEvent.blur(field());
    await screen.findByText("unknown");
    expect(field().disabled).toBe(true);
    const input = fixture.writes.mock.calls[0]![1] as {
      intent: TranslationIntentEnvelope;
      value: string;
    };
    const uuid: unknown = expect.stringMatching(/^[0-9a-f-]{36}$/);
    expect(input.intent).toEqual({
      version: 1,
      id: uuid,
      actorId: "translation-actor",
      mode: "PUBLISH",
    });
    const stored = sessionStorage.getItem("translation-intents:v1")!;
    const metadata: unknown = JSON.parse(stored);
    expect(metadata).toEqual([
      {
        id: input.intent.id,
        actorId: "translation-actor",
        operation: "localization.setString",
        mode: "PUBLISH",
      },
    ]);
    expect(fixture.persistedAtWrite.mock.calls[0]![0]).toBe(stored);
    expect(stored).not.toContain(input.value);
    fireEvent.click(screen.getByRole("button", { name: "lookup" }));
    await waitFor(() => expect(field().disabled).toBe(false));
    expect(field().value).toBe(input.value);
    expect(screen.getByText("translationEditor.published")).toBeTruthy();
    expect(fixture.metadataReads).toHaveBeenCalledExactlyOnceWith(
      input.intent.id,
    );
    fireEvent.blur(field());
    expect(fixture.writes).toHaveBeenCalledTimes(1);
  },
);

it("retains an unknown row's exact retry across disposal and does not treat NOT_RECORDED as permission for a new key", async () => {
  fixture.rejectWrite = true;
  show();
  await openStrings();
  fireEvent.change(field(), { target: { value: "Original captured input" } });
  fireEvent.blur(field());
  await screen.findByText("unknown");
  const original = fixture.writes.mock.calls[0]![1];
  fireEvent.click(screen.getByRole("button", { name: /^Common/ }));
  expect(screen.queryByLabelText("common.title")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "lookup" }));
  await screen.findByText("notRecorded");
  ensureCommonOpen();
  expect(field().value).toBe("Original captured input");
  expect(field().disabled).toBe(true);
  fireEvent.change(field(), { target: { value: "Unadmitted replacement" } });
  fireEvent.blur(field());
  expect(fixture.writes).toHaveBeenCalledTimes(1);
  fixture.rejectWrite = false;
  fireEvent.click(screen.getByRole("button", { name: "retryExact" }));
  await waitFor(() => expect(field().disabled).toBe(false));
  expect(fixture.writes).toHaveBeenCalledTimes(2);
  expect(fixture.writes.mock.calls[1]![1]).toEqual(original);
  expect(field().value).toBe("Original captured input");
});

it("releases only a stopped string lease while the old POST hangs, then ignores its late failure", async () => {
  show();
  await openStrings();
  let finishOld!: () => void;
  fixture.writeGate = new Promise<void>((resolve) => {
    finishOld = resolve;
  });
  fireEvent.change(field(), { target: { value: "Stopped original text" } });
  fireEvent.blur(field());
  await waitFor(() => expect(fixture.writes).toHaveBeenCalledTimes(1));
  const first = fixture.writes.mock.calls[0]![1] as {
    intent: TranslationIntentEnvelope;
  };
  fireEvent.click(screen.getByRole("button", { name: "stop" }));
  await waitFor(() => expect(field().disabled).toBe(false));
  let finishNew!: () => void;
  fixture.writeGate = new Promise<void>((resolve) => {
    finishNew = resolve;
  });
  fireEvent.change(field(), { target: { value: "New deliberate text" } });
  fireEvent.blur(field());
  await waitFor(() => expect(fixture.writes).toHaveBeenCalledTimes(2));
  const second = fixture.writes.mock.calls[1]![1] as {
    intent: TranslationIntentEnvelope;
  };
  expect(second.intent.id).not.toBe(first.intent.id);
  expect(field().disabled).toBe(true);
  const reads = fixture.reads.mock.calls.length;
  await act(async () => {
    finishOld();
  });
  expect(fixture.reads).toHaveBeenCalledTimes(reads);
  expect(field().value).toBe("New deliberate text");
  expect(field().disabled).toBe(true);
  expect(screen.queryByText("Synthetic intent already stopped")).toBeNull();
  expect(fixture.writes).toHaveBeenCalledTimes(2);
  await act(async () => {
    finishNew();
  });
  await waitFor(() => expect(field().disabled).toBe(false));
  expect(screen.getByText("translationEditor.published")).toBeTruthy();
});

it("allows metadata recovery after Translator loss without mounting private content or retrying the old mode", async () => {
  fixture.role = "TUTOR";
  fixture.dropResponse = true;
  show();
  await openStrings();
  fireEvent.change(field(), { target: { value: "Historical draft input" } });
  fireEvent.blur(field());
  await screen.findByText("unknown");
  const input = fixture.writes.mock.calls[0]![1] as {
    intent: TranslationIntentEnvelope;
  };
  expect(input.intent.mode).toBe("DRAFT");
  fixture.canTranslate = false;
  await refresh("account");
  expect(screen.queryByLabelText("common.title")).toBeNull();
  expect(screen.queryByText("Private English source")).toBeNull();
  expect(screen.queryByRole("button", { name: "retryExact" })).toBeNull();
  const reads = fixture.reads.mock.calls.filter(
    ([name]) => name !== "account",
  ).length;
  fireEvent.click(screen.getByRole("button", { name: "lookup" }));
  await screen.findByText("acceptedDraft");
  expect(
    fixture.reads.mock.calls.filter(([name]) => name !== "account"),
  ).toHaveLength(reads);
  expect(fixture.writes).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("common.title")).toBeNull();
  fixture.canTranslate = true;
  fixture.role = "ADMIN";
  await refresh("account");
  fireEvent.click(screen.getByRole("tab", { name: "strings" }));
  await screen.findByRole("button", { name: /^Common/ });
  ensureCommonOpen();
  expect(field().value).toBe("Historical draft input");
  expect(screen.getByText("translationEditor.submitted")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "uiPatterns.retry" }));
  await waitFor(() => expect(field().disabled).toBe(false));
  fireEvent.blur(field());
  expect(fixture.writes).toHaveBeenCalledTimes(1);
});

it("restores only metadata and offers GET/Stop without an exact input sender", async () => {
  const id = "d9677591-3ae5-4b86-a189-12f9da092b0d";
  sessionStorage.setItem(
    "translation-intents:v1",
    JSON.stringify([
      {
        id,
        actorId: fixture.actor,
        operation: "localization.setString",
        mode: "PUBLISH",
      },
    ]),
  );
  show();
  await openStrings();
  expect(field().disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "retryExact" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "lookup" }));
  await screen.findByText("notRecorded");
  expect(field().disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "stop" }));
  await waitFor(() => expect(field().disabled).toBe(false));
  expect(field().value).toBe("Private English source");
  expect(fixture.writes).not.toHaveBeenCalled();
});

it("retains an uncertain row through an unavailable identity and binds its historical receipt after a mode change", async () => {
  fixture.role = "TUTOR";
  fixture.dropResponse = true;
  show();
  await openStrings();
  fireEvent.change(field(), { target: { value: "Original draft-mode input" } });
  fireEvent.blur(field());
  await screen.findByText("unknown");
  fixture.account = "null";
  await refresh("account");
  expect(screen.queryByLabelText("common.title")).toBeNull();
  expect(screen.queryByRole("button", { name: "lookup" })).toBeNull();
  fixture.account = "ok";
  fixture.role = "ADMIN";
  await refresh("account");
  await screen.findByRole("button", { name: /^Common/ });
  ensureCommonOpen();
  expect(field().value).toBe("Original draft-mode input");
  expect(field().disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "retryExact" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "lookup" }));
  await waitFor(() => expect(field().disabled).toBe(false));
  expect(screen.getByText("translationEditor.submitted")).toBeTruthy();
  expect(screen.queryByText("translationEditor.published")).toBeNull();
  fireEvent.blur(field());
  expect(fixture.writes).toHaveBeenCalledTimes(1);
});

it.each(["null", "denied", "error"] as const)(
  "keeps the original row fenced after a %s metadata read instead of treating it as absence",
  async (mode) => {
    fixture.rejectWrite = true;
    show();
    await openStrings();
    fireEvent.change(field(), {
      target: { value: "Uncertain original payload" },
    });
    fireEvent.blur(field());
    await screen.findByText("unknown");
    fixture.metadata = mode;
    const protectedReads = fixture.reads.mock.calls.filter(
      ([name]) => name !== "account",
    ).length;
    fireEvent.click(screen.getByRole("button", { name: "lookup" }));
    await waitFor(() => expect(fixture.metadataReads).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "lookup" })
          .disabled,
      ).toBe(false),
    );
    if (mode === "denied")
      await waitFor(() =>
        expect(fixture.intentClient!.getSnapshot().entries[0]?.canRecheck).toBe(
          true,
        ),
      );
    else expect(fixture.metadataReads).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("notRecorded")).toBeNull();
    expect(field().value).toBe("Uncertain original payload");
    expect(field().disabled).toBe(true);
    expect(
      fixture.reads.mock.calls.filter(([name]) => name !== "account"),
    ).toHaveLength(protectedReads);
    fireEvent.blur(field());
    expect(fixture.writes).toHaveBeenCalledTimes(1);
    fixture.metadata = "ok";
    fireEvent.click(screen.getByRole("button", { name: "stop" }));
    await waitFor(() => expect(field().disabled).toBe(false));
    expect(fixture.writes).toHaveBeenCalledTimes(1);
  },
);

it("uses the fresh returned account mode after a raw authority refusal and never queries or retries the old UUID under a new mode", async () => {
  fixture.role = "TUTOR";
  show();
  await openStrings();
  let finish!: () => void;
  fixture.writeGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  fireEvent.change(field(), { target: { value: "Original DRAFT attempt" } });
  fireEvent.blur(field());
  await waitFor(() => expect(fixture.writes).toHaveBeenCalledTimes(1));
  const protectedReads = fixture.reads.mock.calls.filter(
    ([name]) => name !== "account",
  ).length;
  fixture.role = "ADMIN";
  fixture.rawAuthorityError = "FORBIDDEN";
  await act(async () => {
    finish();
  });
  await waitFor(() =>
    expect(fixture.intentClient!.getSnapshot().entries[0]?.canRecheck).toBe(
      true,
    ),
  );
  expect(fixture.metadataReads).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "retryExact" })).toBeNull();
  expect(field().disabled).toBe(true);
  expect(field().value).toBe("Original DRAFT attempt");
  expect(
    fixture.reads.mock.calls.filter(([name]) => name !== "account"),
  ).toHaveLength(protectedReads);
  expect(fixture.writes).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "stop" }));
  await waitFor(() => expect(field().disabled).toBe(false));
});

it("rechecks only own account and receipt after a raw refusal, then requires an explicit same-key retry", async () => {
  fixture.rawAuthorityError = "UNAUTHORIZED";
  show();
  await openStrings();
  const protectedReads = fixture.reads.mock.calls.filter(
    ([name]) => name !== "account",
  ).length;
  fireEvent.change(field(), { target: { value: "Original exact retry" } });
  fireEvent.blur(field());
  await screen.findByText("notRecorded");
  await screen.findByRole("button", { name: "retryExact" });
  expect(fixture.metadataReads).toHaveBeenCalledTimes(1);
  expect(
    fixture.reads.mock.calls.filter(([name]) => name !== "account"),
  ).toHaveLength(protectedReads);
  expect(fixture.writes).toHaveBeenCalledTimes(1);
  expect(field().disabled).toBe(true);
  const original = fixture.writes.mock.calls[0]![1];
  fixture.rawAuthorityError = "";
  fireEvent.click(screen.getByRole("button", { name: "retryExact" }));
  await waitFor(() => expect(field().disabled).toBe(false));
  expect(fixture.writes).toHaveBeenCalledTimes(2);
  expect(fixture.writes.mock.calls[1]![1]).toEqual(original);
});

it("fences a retained Composer from another row's unknown intent and releases it only after terminal Stop", async () => {
  show();
  await openStrings();
  fireEvent.click(screen.getByRole("tab", { name: "website" }));
  await screen.findByRole("option", { name: "Private website destination" });
  fireEvent.change(screen.getByLabelText("target"), {
    target: { value: "tagline" },
  });
  fireEvent.change(screen.getByLabelText("translation"), {
    target: { value: "Independent website draft" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "strings" }));
  await screen.findByLabelText("common.title");
  fixture.rejectWrite = true;
  fireEvent.change(field(), { target: { value: "Uncertain interface draft" } });
  fireEvent.blur(field());
  await screen.findByText("unknown");
  const first = fixture.writes.mock.calls[0]![1] as {
    intent: TranslationIntentEnvelope;
  };
  fireEvent.click(screen.getByRole("tab", { name: "website" }));
  const body = screen.getByLabelText<HTMLTextAreaElement>("translation");
  expect(body.value).toBe("Independent website draft");
  expect(body.disabled).toBe(true);
  fireEvent.submit(
    screen.getByRole("button", { name: "publishEdit" }).closest("form")!,
  );
  expect(fixture.writes).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "stop" }));
  await waitFor(() => expect(body.disabled).toBe(false));
  fixture.rejectWrite = false;
  fireEvent.click(screen.getByRole("button", { name: "publishEdit" }));
  await screen.findByText("published");
  expect(fixture.writes).toHaveBeenCalledTimes(2);
  const next = fixture.writes.mock.calls[1]![1] as {
    intent: TranslationIntentEnvelope;
  };
  expect(next.intent.id).not.toBe(first.intent.id);
  fireEvent.click(screen.getByRole("tab", { name: "strings" }));
  await screen.findByLabelText("common.title");
  await waitFor(() => expect(field().disabled).toBe(false));
  expect(field().value).toBe("Uncertain interface draft");
  expect(fixture.writes).toHaveBeenCalledTimes(2);
});

it("keeps interface text concealed after manual same-key success and an alternate-locale read until the exact selected read succeeds", async () => {
  show();
  await openStrings();
  const selected = { locale: "en", refLocales: [] };
  const stringsKey = translationFixtureKey("localization.strings", selected);
  const original = client.getQueryData(stringsKey);
  expect(original).toBeDefined();
  expect(
    client
      .getQueryCache()
      .find({ queryKey: translationFixtureKey("account.me"), exact: true }),
  ).toBeDefined();
  expect(
    client.getQueryCache().find({
      queryKey: translationFixtureKey("i18n.managedLanguages"),
      exact: true,
    }),
  ).toBeDefined();
  fixture.strings = "denied";
  await refresh("strings");
  expect(screen.queryByLabelText("common.title")).toBeNull();
  fixture.strings = "ok";
  await act(async () => {
    client.setQueryData(stringsKey, original);
  });
  expect(screen.queryByLabelText("common.title")).toBeNull();
  const alternateKey = translationFixtureKey("localization.strings", {
    locale: "zh",
    refLocales: ["en"],
  });
  await act(async () => {
    await client.fetchQuery({
      queryKey: alternateKey,
      queryFn: async () => original,
      retry: false,
    });
  });
  expect(screen.queryByLabelText("common.title")).toBeNull();
  expect(fixture.writes).not.toHaveBeenCalled();
  // This invokes the existing selected RPC fixture, rather than setting cached
  // success or using the other locale's genuine but unrelated read receipt.
  await act(async () => {
    await client.refetchQueries(
      { queryKey: stringsKey, exact: true },
      { throwOnError: true },
    );
  });
  await waitFor(() => expect(field().disabled).toBe(false));
  expect(fixture.reads).toHaveBeenCalledWith("strings", selected);
  expect(fixture.writes).not.toHaveBeenCalled();
});
