// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";
import LandingAdminPage, { LandingIntentRecovery } from "./landing-editor";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import {
  createTranslationIntentClient,
  TRANSLATION_INTENT_STORAGE_KEY,
  type TranslationIntentClient,
} from "~/lib/translation-intent-client";
import { installSessionReadReceipts } from "~/lib/session-read-receipts";
import { translationFixtureKey } from "~/test/translation-query-bindings";
import type * as IntentClientModule from "~/lib/translation-intent-client";

function rpcQueryKey(scope: string, name: string, input?: unknown) {
  // Use the public tRPC key builder with the same procedure metadata exposed by
  // the mocked hooks; the authority reducer inspects this actual cache entry.
  return translationFixtureKey(`${scope}.${name}`, input);
}

const fixture = vi.hoisted(() => ({
  account: { id: "landing-publisher", role: "ADMIN", canTranslate: true },
  content: [] as Record<string, unknown>[],
  news: [] as Record<string, unknown>[],
  sections: [] as Record<string, unknown>[],
  pages: [] as Record<string, unknown>[],
  requests: [] as {
    operation: string;
    input: Record<string, unknown>;
    storage: string[];
  }[],
  send: vi.fn<
    (operation: string, input: Record<string, unknown>) => Promise<unknown>
  >(),
  reads: vi.fn<(operation: string, input: unknown) => Promise<unknown>>(),
  receipts: ((): Record<string, unknown> => ({}))(),
  readError: ((): unknown => null)(),
  intentClient: null as TranslationIntentClient | null,
  mutationOptions: [] as {
    operation: string;
    retry?: unknown;
    onSuccess?: unknown;
  }[],
  queryMounts: [] as string[],
  stop: vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
}));

let client: QueryClient;
vi.mock("~/lib/translation-intent-client", async (original) => ({
  ...(await original<typeof IntentClientModule>()),
  get translationIntentClient() {
    return fixture.intentClient!;
  },
}));
vi.mock("~/app/_components/read-only", () => ({ useReadOnly: () => false }));
vi.mock("~/app/_components/markdown", () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
}));
vi.mock("~/app/_components/ui/action-review", () => ({
  useActionReview: () => ({
    dialog: null,
    blocked: () => false,
    open: vi.fn(),
    revoke: vi.fn(),
  }),
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery, useMutation } = await import("@tanstack/react-query");
  const resolve = (scope: string, name: string, input?: unknown): unknown => {
    if (scope === "account" && name === "me") return fixture.account;
    if (scope === "i18n")
      return [
        { code: "en", label: "English" },
        { code: "zh", label: "中文" },
      ];
    if (scope === "translationIntent" && name === "get") {
      const id = (input as { intentId: string }).intentId;
      return (
        fixture.receipts[id] ?? {
          status: "NOT_RECORDED",
          version: 1,
          intentId: id,
        }
      );
    }
    if (scope === "home") {
      if (name === "content") return fixture.content;
      if (name === "news") return fixture.news;
      if (name === "sections") return fixture.sections;
      if (name === "pages") return fixture.pages;
      if (name === "images")
        return [
          {
            id: "private-image-id",
            url: "/synthetic.png",
            alt: "Private image label",
            mimeType: "image/png",
            byteSize: 1,
            createdAt: new Date(0),
            createdByName: null,
          },
        ];
    }
    return [];
  };
  const read = async (scope: string, name: string, input?: unknown) => {
    await fixture.reads(`${scope}.${name}`, input);
    if (fixture.readError && scope === "home") {
      const failure = fixture.readError;
      if (failure instanceof Error) throw failure;
      if (typeof failure === "object")
        throw Object.assign(
          new Error("Synthetic Landing read failed"),
          failure,
        );
      throw new Error(
        typeof failure === "string" ? failure : "Synthetic Landing read failed",
        { cause: failure },
      );
    }
    return resolve(scope, name, input);
  };
  const utility = (scope: string, name: string) => ({
    invalidate: async (
      input?: unknown,
      filters?: Parameters<QueryClient["invalidateQueries"]>[0],
      options?: Parameters<QueryClient["invalidateQueries"]>[1],
    ) =>
      client.invalidateQueries(
        { ...filters, queryKey: rpcQueryKey(scope, name, input) },
        options,
      ),
    fetch: async (input?: unknown) =>
      client.fetchQuery({
        queryKey: rpcQueryKey(scope, name, input),
        queryFn: () => read(scope, name, input),
        staleTime: 0,
      }),
    getData: (input?: unknown) =>
      client.getQueryData(rpcQueryKey(scope, name, input)),
  });
  const directClient = new Proxy(
    {},
    {
      get: (_target, scope) =>
        new Proxy(
          {},
          {
            get: (_inner, name) => ({
              query: (input?: unknown) =>
                read(String(scope), String(name), input),
            }),
          },
        ),
    },
  );
  const utils = new Proxy(
    {},
    {
      get: (_target, scope) =>
        scope === "client"
          ? directClient
          : new Proxy(
              {},
              { get: (_inner, name) => utility(String(scope), String(name)) },
            ),
    },
  );
  const api = new Proxy(
    {},
    {
      get: (_target, scope) =>
        scope === "useUtils"
          ? () => utils
          : new Proxy(
              {},
              {
                get: (_inner, name) => ({
                  _def: () => ({ path: [String(scope), String(name)] }),
                  useQuery: (
                    input?: unknown,
                    options?: { enabled?: boolean },
                  ) => {
                    fixture.queryMounts.push(
                      `${String(scope)}.${String(name)}`,
                    );
                    return useQuery({
                      queryKey: rpcQueryKey(String(scope), String(name), input),
                      queryFn: () => read(String(scope), String(name), input),
                      initialData: () =>
                        resolve(String(scope), String(name), input),
                      retry: false,
                      staleTime: Infinity,
                      enabled: options?.enabled,
                    });
                  },
                  useMutation: (options?: {
                    retry?: unknown;
                    onSuccess?: (data: unknown) => unknown;
                  }) => {
                    fixture.mutationOptions.push({
                      operation: `${String(scope)}.${String(name)}`,
                      retry: options?.retry,
                      onSuccess: options?.onSuccess,
                    });
                    return useMutation({
                      mutationFn: async (input: Record<string, unknown>) => {
                        const operation = `${String(scope)}.${String(name)}`;
                        fixture.requests.push({
                          operation,
                          input,
                          storage: Object.keys(window.sessionStorage).map(
                            (key) => window.sessionStorage.getItem(key)!,
                          ),
                        });
                        if (scope === "translationIntent" && name === "stop") {
                          const stopped = await fixture.stop(input);
                          fixture.receipts[String(input.intentId)] = stopped;
                          return stopped;
                        }
                        return fixture.send(operation, input);
                      },
                      onSuccess: options?.onSuccess,
                    });
                  },
                }),
              },
            ),
    },
  );
  return { api };
});

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  installSessionReadReceipts(client);
  fixture.intentClient = createTranslationIntentClient(
    () => window.sessionStorage,
  );
  fixture.account = {
    id: "landing-publisher",
    role: "ADMIN",
    canTranslate: true,
  };
  fixture.requests = [];
  fixture.receipts = {};
  fixture.mutationOptions = [];
  fixture.queryMounts = [];
  fixture.readError = null;
  fixture.reads.mockReset().mockResolvedValue(undefined);
  fixture.send.mockReset().mockImplementation(async (operation, input) => {
    if (!input.intent) return { ok: true };
    const intent = input.intent as { id: string; mode: "DRAFT" | "PUBLISH" };
    const clearable = operation === "home.setContent";
    const cleared = clearable
      ? intent.mode === "PUBLISH" && !String(input.value).trim()
      : null;
    return {
      ok: true,
      ...(clearable ? { cleared } : {}),
      receipt: {
        status: "ACCEPTED",
        version: 1,
        intentId: intent.id,
        operation,
        mode: intent.mode,
        outcome: intent.mode === "DRAFT" ? "DRAFT_SUBMITTED" : "PUBLISHED",
        acceptedAt: new Date(0),
        draftId: intent.mode === "DRAFT" ? "private-draft-id" : null,
        cleared,
        replayed: false,
      },
    };
  });
  fixture.stop.mockReset().mockImplementation(async (input) => ({
    status: "STOPPED",
    version: 1,
    intentId: input.intentId,
    stoppedAt: new Date(0),
  }));
  fixture.content = [
    {
      key: "tagline",
      kind: "line",
      global: false,
      hasAppTitle: false,
      default: "Bundled tagline",
      override: "Private stored tagline",
    },
    {
      key: "heroImageId",
      kind: "image",
      global: true,
      hasAppTitle: false,
      default: null,
      override: null,
    },
  ];
  const translations = [
    {
      locale: "en",
      title: "Private original title",
      body: "Private original body",
    },
  ];
  fixture.news = [
    {
      id: "private-news-id",
      status: "DRAFT",
      pinned: false,
      publishedAt: null,
      createdByName: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      translations,
    },
  ];
  fixture.sections = [
    {
      id: "private-section-id",
      mode: "INLINE",
      sortOrder: 0,
      published: true,
      openByDefault: false,
      slug: null,
      createdByName: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      translations,
    },
  ];
  fixture.pages = [
    {
      id: "private-page-id",
      slug: "private-page-slug",
      title: { en: "Private original page" },
      published: true,
      showInNav: false,
      navOrder: 0,
      createdByName: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  ];
});
afterEach(() => {
  cleanup();
  client.clear();
});

function tree(children = <LandingAdminPage />) {
  return (
    <QueryClientProvider client={client}>
      <SessionViewProvider
        identity={fixture.account.id}
        pathname="/admin/landing"
        verified
      >
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
          {children}
        </NextIntlClientProvider>
      </SessionViewProvider>
    </QueryClientProvider>
  );
}

const privateValue =
  "Private submitted text that must never enter browser storage";
const privateBody =
  "Private markdown body that must never enter browser storage";
// These are the maintained runtime catalog strings, not a test-only copy or an
// ignored audit artifact. The lead merges the shared all-locale namespace.
const intentMessages = (
  en as unknown as { translationIntent: Record<string, string> }
).translationIntent;
const intentButton = (key: string) =>
  screen.getByRole("button", { name: intentMessages[key]! });
const textWrites = () =>
  fixture.requests.filter((row) => row.operation.startsWith("home.set"));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function accepted(input: Record<string, unknown>, operation: string) {
  const intent = input.intent as { id: string; mode: "DRAFT" | "PUBLISH" };
  return {
    status: "ACCEPTED" as const,
    version: 1 as const,
    intentId: intent.id,
    operation,
    mode: intent.mode,
    outcome: intent.mode === "DRAFT" ? "DRAFT_SUBMITTED" : "PUBLISHED",
    acceptedAt: new Date(0),
    draftId: intent.mode === "DRAFT" ? "private-draft-id" : null,
    cleared:
      operation === "home.setContent"
        ? intent.mode === "PUBLISH" && !String(input.value).trim()
        : null,
    replayed: false,
  };
}
function seedMetadata(operation = "home.setContent", mode = "PUBLISH") {
  const metadata = {
    id: "c76c4444-cc18-4f8f-bc86-6fe4d6381ebf",
    actorId: fixture.account.id,
    operation,
    mode,
  };
  window.sessionStorage.setItem(
    TRANSLATION_INTENT_STORAGE_KEY,
    JSON.stringify([metadata]),
  );
  return metadata;
}
async function setAccount(
  next: typeof fixture.account,
  page?: ReturnType<typeof render>,
) {
  fixture.account = next;
  await act(async () => {
    client.setQueryData(rpcQueryKey("account", "me"), next);
    page?.rerender(tree());
  });
}
const sites = [
  {
    site: "fixed text Save",
    tab: "content",
    operation: "home.setContent",
    submit: () => {
      fireEvent.change(
        screen.getByRole("textbox", { name: en.admin.landing.fields.tagline }),
        { target: { value: privateValue } },
      );
      fireEvent.click(screen.getByRole("button", { name: en.common.save }));
    },
  },
  {
    site: "fixed text Revert",
    tab: "content",
    operation: "home.setContent",
    submit: () =>
      fireEvent.click(
        screen.getByRole("button", { name: en.admin.landing.revert }),
      ),
  },
  {
    site: "global hero image",
    tab: "content",
    operation: "home.setContent",
    submit: () =>
      fireEvent.change(
        screen.getByRole("combobox", {
          name: en.admin.landing.fields.heroImage,
        }),
        { target: { value: "private-image-id" } },
      ),
  },
  {
    site: "news translation",
    tab: "news",
    operation: "home.setNewsTranslation",
    submit: () => {
      fireEvent.change(
        screen.getByRole("textbox", {
          name: en.admin.landing.translation.titleLabel,
        }),
        { target: { value: privateValue } },
      );
      fireEvent.change(
        screen.getByRole("textbox", {
          name: en.admin.landing.translation.bodyLabel,
        }),
        { target: { value: privateBody } },
      );
      fireEvent.click(screen.getByRole("button", { name: en.common.save }));
    },
  },
  {
    site: "section translation",
    tab: "sections",
    operation: "home.setSectionTranslation",
    submit: () => {
      fireEvent.change(
        screen.getByRole("textbox", {
          name: en.admin.landing.translation.titleLabel,
        }),
        { target: { value: privateValue } },
      );
      fireEvent.change(
        screen.getByRole("textbox", {
          name: en.admin.landing.translation.bodyLabel,
        }),
        { target: { value: privateBody } },
      );
      fireEvent.click(screen.getByRole("button", { name: en.common.save }));
    },
  },
  {
    site: "page title blur",
    tab: "pages",
    operation: "home.setPageTitle",
    submit: () => {
      const input = screen.getByRole("textbox", {
        name: en.admin.landing.pages.titleLabel,
      });
      fireEvent.change(input, { target: { value: privateValue } });
      fireEvent.blur(input);
      fireEvent.blur(input);
    },
  },
] as const;

function editable(tab: (typeof sites)[number]["tab"], operation: string) {
  if (tab === "pages")
    return screen.getByRole<HTMLInputElement>("textbox", {
      name: en.admin.landing.pages.titleLabel,
    });
  if (tab === "news" || tab === "sections")
    return screen.getByRole<HTMLInputElement>("textbox", {
      name: en.admin.landing.translation.titleLabel,
    });
  if (operation === "image")
    return screen.getByRole<HTMLSelectElement>("combobox", {
      name: en.admin.landing.fields.heroImage,
    });
  return screen.getByRole<HTMLInputElement>("textbox", {
    name: en.admin.landing.fields.tagline,
  });
}

function metadataFrom(values: string[]) {
  const records: Record<string, unknown>[] = [];
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (
      "actorId" in value &&
      "operation" in value &&
      "mode" in value &&
      "id" in value
    )
      records.push(value);
    else for (const item of Object.values(value)) walk(item);
  };
  for (const value of values) {
    try {
      const decoded: unknown = JSON.parse(value);
      walk(decoded);
    } catch {
      /* Unrelated session keys are not intent metadata. */
    }
  }
  return records;
}

it.each(sites)(
  "persists only metadata before the $site POST, holds lost-response edits, and retries only the exact explicit request",
  async ({ tab, operation, submit }) => {
    let reject!: (reason: Error) => void;
    fixture.send.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const page = render(tree());
    fireEvent.click(
      screen.getByRole("tab", { name: en.admin.landing.tabs[tab] }),
    );
    await act(async () => {
      submit();
    });
    await waitFor(() => expect(fixture.requests).toHaveLength(1));
    const request = fixture.requests[0]!;
    expect(request.operation).toBe(operation);
    const options = fixture.mutationOptions
      .filter((entry) => entry.operation === operation)
      .at(-1)!;
    expect(options.retry).toBe(false);
    expect(options.onSuccess).toBeUndefined();
    expect(request.input.intent).toMatchObject({
      version: 1,
      actorId: fixture.account.id,
      mode: "PUBLISH",
    });
    const intent = request.input.intent as { id: string };
    expect(intent.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const metadata = metadataFrom(request.storage);
    expect(metadata).toContainEqual({
      id: intent.id,
      actorId: fixture.account.id,
      operation,
      mode: "PUBLISH",
    });
    expect(
      Object.keys(metadata.find((row) => row.id === intent.id)!).sort(),
    ).toEqual(["actorId", "id", "mode", "operation"]);
    const stored = [
      ...request.storage,
      ...Object.keys(window.localStorage).map((key) =>
        window.localStorage.getItem(key)!,
      ),
    ].join(" ");
    for (const secret of [
      privateValue,
      privateBody,
      "private-news-id",
      "private-section-id",
      "private-page-id",
      "private-image-id",
      "Private original title",
      "Private stored tagline",
    ])
      expect(stored).not.toContain(secret);
    await act(async () => {
      reject(new Error("The accepted response was lost"));
    });
    page.rerender(tree());
    fireEvent.click(
      screen.getByRole("tab", { name: en.admin.landing.tabs.images }),
    );
    fireEvent.click(
      screen.getByRole("tab", { name: en.admin.landing.tabs[tab] }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      fixture.requests.filter((row) => row.operation.startsWith("home.set")),
    ).toHaveLength(1);
    for (const input of screen
      .getAllByRole("textbox")
      .filter(
        (input) =>
          (input as HTMLInputElement).value === privateValue ||
          (input as HTMLTextAreaElement).value === privateBody,
      ))
      expect((input as HTMLInputElement).disabled).toBe(true);
    expect(
      editable(tab, request.input.key === "heroImageId" ? "image" : operation)
        .disabled,
    ).toBe(true);
    await waitFor(() => expect(intentButton("retryExact")).toBeTruthy());
    fireEvent.click(intentButton("retryExact"));
    await waitFor(() => expect(textWrites()).toHaveLength(2));
    expect(textWrites()[1]!.input).toEqual(request.input);
    await waitFor(() =>
      expect(screen.getByText(intentMessages.acceptedPublished!)).toBeTruthy(),
    );
    await waitFor(() =>
      expect(
        editable(tab, request.input.key === "heroImageId" ? "image" : operation)
          .disabled,
      ).toBe(false),
    );
  },
);

it.each(sites)(
  "durably stops $site and admits a new deliberate UUID while its original POST remains unsettled",
  async ({ site, tab, submit }) => {
    const original = deferred<unknown>();
    const replacement = deferred<unknown>();
    const stopped = deferred<unknown>();
    fixture.send
      .mockImplementationOnce(() => original.promise)
      .mockImplementationOnce(() => replacement.promise);
    fixture.stop.mockImplementationOnce(() => stopped.promise);
    render(tree());
    fireEvent.click(
      screen.getByRole("tab", { name: en.admin.landing.tabs[tab] }),
    );
    await act(async () => {
      submit();
    });
    await waitFor(() => expect(textWrites()).toHaveLength(1));
    const first = textWrites()[0]!;
    const id = (first.input.intent as { id: string }).id;
    const control = () =>
      editable(tab, site === "global hero image" ? "image" : first.operation);
    fireEvent.click(intentButton("stop"));
    await waitFor(() => expect(fixture.stop).toHaveBeenCalledOnce());
    expect(control().disabled).toBe(true);
    expect(textWrites()).toHaveLength(1);
    await act(async () => {
      stopped.resolve({
        status: "STOPPED",
        version: 1,
        intentId: id,
        stoppedAt: new Date(0),
      });
    });
    await waitFor(() => expect(control().disabled).toBe(false));
    // Page-title refocus alone is not a deliberate new edit after Stop.
    if (tab === "pages") {
      fireEvent.blur(control());
      expect(textWrites()).toHaveLength(1);
      fireEvent.change(control(), {
        target: { value: `${privateValue} newer` },
      });
      fireEvent.blur(control());
    } else if (site === "global hero image") {
      fireEvent.change(control(), { target: { value: "" } });
    } else submit();
    await waitFor(() => expect(textWrites()).toHaveLength(2));
    const second = textWrites()[1]!;
    expect((second.input.intent as { id: string }).id).not.toBe(id);
    expect(control().disabled).toBe(true);
    const readsBefore = fixture.reads.mock.calls.length;
    // Deliberately do not settle the old transport until the replacement owns the
    // form. A late old ACCEPTED response cannot release/read the replacement.
    await act(async () => {
      original.resolve({
        ok: true,
        receipt: accepted(first.input, first.operation),
      });
    });
    expect(fixture.reads.mock.calls).toHaveLength(readsBefore);
    expect(control().disabled).toBe(true);
    expect(textWrites()).toHaveLength(2);
    await act(async () => {
      replacement.resolve({
        ok: true,
        receipt: accepted(second.input, second.operation),
      });
    });
    await waitFor(() => expect(control().disabled).toBe(false));
  },
);

it.each([sites[0], sites[3], sites[4], sites[5]])(
  "keeps Coordinator $site as a draft intent and reports historical submission",
  async ({ tab, submit }) => {
    fixture.account = {
      id: "landing-coordinator",
      role: "COORDINATOR",
      canTranslate: true,
    };
    render(tree());
    fireEvent.click(
      screen.getByRole("tab", { name: en.admin.landing.tabs[tab] }),
    );
    await act(async () => {
      submit();
    });
    await waitFor(() => expect(textWrites()).toHaveLength(1));
    expect(textWrites()[0]!.input.intent).toMatchObject({
      actorId: "landing-coordinator",
      mode: "DRAFT",
    });
    await waitFor(() =>
      expect(screen.getByText(intentMessages.acceptedDraft!)).toBeTruthy(),
    );
    expect(screen.queryByText(intentMessages.acceptedPublished!)).toBeNull();
    await waitFor(() =>
      expect(editable(tab, textWrites()[0]!.operation).disabled).toBe(false),
    );
  },
);

it("uses read-only GET acceptance while the original POST hangs, then admits a deliberate identical value with a fresh UUID", async () => {
  const original = deferred<unknown>();
  fixture.send.mockImplementationOnce(() => original.promise);
  render(tree());
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
  );
  await act(async () => {
    sites[0].submit();
  });
  await waitFor(() => expect(textWrites()).toHaveLength(1));
  const first = textWrites()[0]!;
  const id = (first.input.intent as { id: string }).id;
  fixture.receipts[id] = accepted(first.input, first.operation);
  fireEvent.click(intentButton("lookup"));
  await waitFor(() =>
    expect(editable("content", first.operation).disabled).toBe(false),
  );
  expect(
    fixture.reads.mock.calls.some(
      ([operation]) => operation === "translationIntent.get",
    ),
  ).toBe(true);
  expect(
    fixture.reads.mock.calls.some(
      ([operation]) => operation === "home.content",
    ),
  ).toBe(true);
  expect(textWrites()).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: en.common.save }));
  await waitFor(() => expect(textWrites()).toHaveLength(2));
  const second = textWrites()[1]!;
  expect(second.input.value).toBe(first.input.value);
  expect((second.input.intent as { id: string }).id).not.toBe(id);
  await waitFor(() =>
    expect(editable("content", first.operation).disabled).toBe(false),
  );
  const readsBefore = fixture.reads.mock.calls.length;
  await act(async () => {
    original.resolve({
      ok: true,
      receipt: accepted(first.input, first.operation),
    });
  });
  expect(fixture.reads.mock.calls).toHaveLength(readsBefore);
});

it("keeps accepted synchronization failures read-only and recovers the captured content locale", async () => {
  render(tree());
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
  );
  fixture.readError = new Error("Read unavailable");
  await act(async () => {
    sites[0].submit();
  });
  await waitFor(() =>
    expect(screen.getByText(intentMessages.refreshFailed!)).toBeTruthy(),
  );
  expect(textWrites()).toHaveLength(1);
  expect(editable("content", "home.setContent").disabled).toBe(true);
  fixture.readError = null;
  fireEvent.click(intentButton("refreshAccepted"));
  await waitFor(() =>
    expect(editable("content", "home.setContent").disabled).toBe(false),
  );
  expect(textWrites()).toHaveLength(1);
  expect(
    fixture.reads.mock.calls
      .filter(([operation]) => operation === "home.content")
      .every(([, input]) => (input as { locale: string }).locale === "en"),
  ).toBe(true);
});

it("retains the requested non-English locale for a global image through exact retry and tab changes", async () => {
  fixture.send.mockRejectedValueOnce(new Error("Lost response"));
  render(tree());
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
  );
  fireEvent.change(screen.getByRole("combobox", { name: en.common.language }), {
    target: { value: "zh" },
  });
  fireEvent.change(
    screen.getByRole("combobox", { name: en.admin.landing.fields.heroImage }),
    { target: { value: "private-image-id" } },
  );
  await waitFor(() => expect(intentButton("retryExact")).toBeTruthy());
  const first = textWrites()[0]!;
  expect(first.input).toMatchObject({
    locale: "zh",
    key: "heroImageId",
    value: "private-image-id",
  });
  fireEvent.change(screen.getByRole("combobox", { name: en.common.language }), {
    target: { value: "en" },
  });
  fireEvent.click(intentButton("retryExact"));
  await waitFor(() => expect(textWrites()).toHaveLength(2));
  expect(textWrites()[1]!.input).toEqual(first.input);
  await waitFor(() =>
    expect(screen.getByText(intentMessages.acceptedPublished!)).toBeTruthy(),
  );
  expect(
    fixture.reads.mock.calls
      .filter(([operation]) => operation === "home.content")
      .every(([, input]) => (input as { locale: string }).locale === "zh"),
  ).toBe(true);
});

it("retains the original owner after its news row disappears and synchronizes its accepted receipt without another POST", async () => {
  fixture.send.mockRejectedValueOnce(new Error("Lost response"));
  render(tree());
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.news }),
  );
  await act(async () => {
    sites[3].submit();
  });
  await waitFor(() => expect(intentButton("lookup")).toBeTruthy());
  const first = textWrites()[0]!;
  fixture.news = [];
  await act(async () => {
    client.setQueryData(rpcQueryKey("home", "news"), []);
  });
  expect(
    screen.queryByRole("textbox", {
      name: en.admin.landing.translation.titleLabel,
    }),
  ).toBeNull();
  fixture.receipts[(first.input.intent as { id: string }).id] = accepted(
    first.input,
    first.operation,
  );
  fireEvent.click(intentButton("lookup"));
  await waitFor(() =>
    expect(screen.getByText(intentMessages.acceptedPublished!)).toBeTruthy(),
  );
  await waitFor(() =>
    expect(
      fixture.reads.mock.calls.some(([operation]) => operation === "home.news"),
    ).toBe(true),
  );
  expect(textWrites()).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
  );
  expect(editable("content", "home.setContent").disabled).toBe(false);
});

it("conceals private editors after verified Translator loss but records late acceptance without private reads", async () => {
  const response = deferred<unknown>();
  fixture.send.mockImplementationOnce(() => response.promise);
  const page = render(tree());
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
  );
  await act(async () => {
    sites[0].submit();
  });
  await waitFor(() => expect(textWrites()).toHaveLength(1));
  const first = textWrites()[0]!;
  await setAccount({ ...fixture.account, canTranslate: false }, page);
  expect(
    screen.queryByRole("textbox", { name: en.admin.landing.fields.tagline }),
  ).toBeNull();
  const readsBefore = fixture.reads.mock.calls.length;
  await act(async () => {
    response.resolve({
      ok: true,
      receipt: accepted(first.input, first.operation),
    });
  });
  await waitFor(() =>
    expect(screen.getByText(intentMessages.acceptedPublished!)).toBeTruthy(),
  );
  expect(fixture.reads.mock.calls).toHaveLength(readsBefore);
  expect(
    screen.queryByRole("button", { name: intentMessages.retryExact }),
  ).toBeNull();
  await setAccount({ ...fixture.account, canTranslate: true }, page);
  fireEvent.click(intentButton("refreshAccepted"));
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
  );
  await waitFor(() =>
    expect(editable("content", "home.setContent").disabled).toBe(false),
  );
  expect(textWrites()).toHaveLength(1);
});

it("severs old actor callbacks and leases while preserving the old actor's metadata partition", async () => {
  const response = deferred<unknown>();
  fixture.send.mockImplementationOnce(() => response.promise);
  const page = render(tree());
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
  );
  await act(async () => {
    sites[0].submit();
  });
  await waitFor(() => expect(textWrites()).toHaveLength(1));
  const first = textWrites()[0]!;
  await setAccount(
    { id: "fresh-publisher", role: "HEAD", canTranslate: true },
    page,
  );
  const readsBefore = fixture.reads.mock.calls.length;
  await act(async () => {
    response.resolve({
      ok: true,
      receipt: accepted(first.input, first.operation),
    });
  });
  expect(fixture.reads.mock.calls).toHaveLength(readsBefore);
  expect(screen.queryByText(intentMessages.acceptedPublished!)).toBeNull();
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
  );
  expect(editable("content", "home.setContent").disabled).toBe(false);
  await act(async () => {
    sites[0].submit();
  });
  await waitFor(() => expect(textWrites()).toHaveLength(2));
  expect(textWrites()[1]!.input.intent).toMatchObject({
    actorId: "fresh-publisher",
    mode: "PUBLISH",
  });
  await waitFor(() =>
    expect(editable("content", "home.setContent").disabled).toBe(false),
  );
  const stored = metadataFrom([
    window.sessionStorage.getItem(TRANSLATION_INTENT_STORAGE_KEY)!,
  ]);
  expect(stored.map((row) => row.actorId)).toEqual([
    "landing-publisher",
    "fresh-publisher",
  ]);
});

it("restores metadata as lookup/Stop only, keeps NOT_RECORDED fenced, and permits replacement only after Stop", async () => {
  const metadata = seedMetadata();
  render(tree());
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
  );
  expect(editable("content", "home.setContent").disabled).toBe(true);
  expect(
    screen.queryByRole("button", { name: intentMessages.retryExact }),
  ).toBeNull();
  fireEvent.click(intentButton("lookup"));
  await waitFor(() =>
    expect(screen.getByText(intentMessages.notRecorded!)).toBeTruthy(),
  );
  expect(editable("content", "home.setContent").disabled).toBe(true);
  expect(textWrites()).toHaveLength(0);
  fireEvent.click(intentButton("stop"));
  await waitFor(() =>
    expect(editable("content", "home.setContent").disabled).toBe(false),
  );
  await act(async () => {
    sites[0].submit();
  });
  await waitFor(() => expect(textWrites()).toHaveLength(1));
  expect((textWrites()[0]!.input.intent as { id: string }).id).not.toBe(
    metadata.id,
  );
  await waitFor(() =>
    expect(editable("content", "home.setContent").disabled).toBe(false),
  );
});

it("mounts only own identity and metadata recovery in the denied Landing entry, even without Translator", async () => {
  fixture.account = {
    id: "landing-publisher",
    role: "STUDENT",
    canTranslate: false,
  };
  seedMetadata();
  render(tree(<LandingIntentRecovery />));
  await waitFor(() => expect(intentButton("lookup")).toBeTruthy());
  expect([...new Set(fixture.queryMounts)]).toEqual(["account.me"]);
  fireEvent.click(intentButton("lookup"));
  await waitFor(() =>
    expect(screen.getByText(intentMessages.notRecorded!)).toBeTruthy(),
  );
  fireEvent.click(intentButton("stop"));
  await waitFor(() =>
    expect(screen.getByText(intentMessages.stopped!)).toBeTruthy(),
  );
  expect(fixture.reads.mock.calls.map(([operation]) => operation)).toEqual([
    "translationIntent.get",
  ]);
  expect(fixture.requests.map((row) => row.operation)).toEqual([
    "translationIntent.stop",
  ]);
  expect(
    fixture.mutationOptions
      .map((entry) => entry.operation)
      .every((operation) => operation === "translationIntent.stop"),
  ).toBe(true);
});

it("refuses exact POST retry after a verified mode change while keeping own metadata Stop available", async () => {
  fixture.send.mockRejectedValueOnce(new Error("Lost response"));
  const page = render(tree());
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
  );
  await act(async () => {
    sites[0].submit();
  });
  await waitFor(() => expect(intentButton("retryExact")).toBeTruthy());
  await setAccount({ ...fixture.account, role: "COORDINATOR" }, page);
  expect(
    screen.queryByRole("button", { name: intentMessages.retryExact }),
  ).toBeNull();
  expect(editable("content", "home.setContent").disabled).toBe(true);
  fireEvent.click(intentButton("stop"));
  await waitFor(() =>
    expect(editable("content", "home.setContent").disabled).toBe(false),
  );
  await act(async () => {
    sites[0].submit();
  });
  await waitFor(() => expect(textWrites()).toHaveLength(2));
  expect(textWrites()[1]!.input.intent).toMatchObject({ mode: "DRAFT" });
  await waitFor(() =>
    expect(editable("content", "home.setContent").disabled).toBe(false),
  );
});

it.each([
  {
    scenario: "a different fresh actor",
    fresh: { id: "another-publisher", role: "ADMIN", canTranslate: true },
  },
  {
    scenario: "a fresh Coordinator draft mode",
    fresh: { id: "landing-publisher", role: "COORDINATOR", canTranslate: true },
  },
])(
  "does not retry a known authorization refusal using cached publication authority after $scenario",
  async ({ fresh }) => {
    fixture.send.mockImplementationOnce(async () => {
      // The query cache is deliberately still the original Admin object here.
      // Only the hook's own fresh identity refetch can observe this server state.
      fixture.account = fresh;
      throw Object.assign(new Error("Authority changed"), {
        data: { code: "FORBIDDEN" },
      });
    });
    render(tree());
    fireEvent.click(
      screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
    );
    await act(async () => {
      sites[0].submit();
    });
    await waitFor(() =>
      expect(
        fixture.reads.mock.calls.some(
          ([operation]) => operation === "account.me",
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(client.getQueryData(rpcQueryKey("account", "me"))).toEqual(fresh),
    );
    expect(fixture.intentClient!.getSnapshot().entries[0]).toMatchObject({
      status: "UNKNOWN",
      canRetry: false,
    });
    expect(
      screen.queryByRole("button", { name: intentMessages.retryExact }),
    ).toBeNull();
    expect(textWrites()).toHaveLength(1);
    expect(textWrites()[0]!.input.intent).toMatchObject({
      actorId: "landing-publisher",
      mode: "PUBLISH",
    });
    expect(
      fixture.reads.mock.calls.some(
        ([operation]) => operation === "translationIntent.get",
      ),
    ).toBe(false);
  },
);

it("rechecks known authorization refusal with fresh own metadata before offering exact retry and never posts automatically", async () => {
  fixture.send.mockRejectedValueOnce(
    Object.assign(new Error("Authorization expired"), {
      data: { code: "UNAUTHORIZED" },
    }),
  );
  render(tree());
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
  );
  await act(async () => {
    sites[0].submit();
  });
  await waitFor(() =>
    expect(
      fixture.reads.mock.calls.some(
        ([operation]) => operation === "account.me",
      ),
    ).toBe(true),
  );
  await waitFor(() => expect(intentButton("retryExact")).toBeTruthy());
  expect(
    fixture.reads.mock.calls.some(
      ([operation]) => operation === "translationIntent.get",
    ),
  ).toBe(true);
  expect(textWrites()).toHaveLength(1);
  const original = textWrites()[0]!.input;
  fireEvent.click(intentButton("retryExact"));
  await waitFor(() => expect(textWrites()).toHaveLength(2));
  expect(textWrites()[1]!.input).toEqual(original);
  await waitFor(() =>
    expect(editable("content", "home.setContent").disabled).toBe(false),
  );
});

it.each([
  { entry: false, clock: "equal", recoveryOffset: 600_000 },
  { entry: false, clock: "backward", recoveryOffset: 0 },
  { entry: true, clock: "equal", recoveryOffset: 600_000 },
  { entry: true, clock: "backward", recoveryOffset: 0 },
])(
  "keeps the Landing entry=$entry account denial through manual cache success and recovers by a real read at an $clock clock",
  async ({ entry, recoveryOffset }) => {
    const base = Date.parse("2026-11-10T00:00:00Z");
    const now = vi.spyOn(Date, "now").mockReturnValue(base);
    try {
      seedMetadata();
      const child = () =>
        entry ? <LandingIntentRecovery /> : <LandingAdminPage />;
      const page = render(tree(child()));
      if (!entry)
        fireEvent.click(
          screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
        );
      await waitFor(() => expect(intentButton("lookup")).toBeTruthy());
      const accountKey = rpcQueryKey("account", "me");
      now.mockReturnValue(base + 600_000);
      fixture.reads.mockImplementation(async (operation) => {
        if (operation === "account.me")
          throw Object.assign(new Error("Synthetic account denial"), {
            data: { code: "FORBIDDEN" },
          });
      });
      await act(async () => {
        await client.refetchQueries({ queryKey: accountKey, exact: true });
      });
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: intentMessages.lookup }),
        ).toBeNull(),
      );
      expect(
        screen.queryByRole("textbox", {
          name: en.admin.landing.fields.tagline,
        }),
      ).toBeNull();

      now.mockReturnValue(base + recoveryOffset);
      fixture.reads.mockResolvedValue(undefined);
      // Equal-reference cache writes are not a network/session proof, even when
      // their wall-clock timestamp appears current or moves backwards.
      await act(async () => {
        client.setQueryData(accountKey, fixture.account);
        page.rerender(tree(child()));
      });
      expect(
        screen.queryByRole("button", { name: intentMessages.lookup }),
      ).toBeNull();
      expect(
        screen.queryByRole("textbox", {
          name: en.admin.landing.fields.tagline,
        }),
      ).toBeNull();
      const readsBefore = fixture.reads.mock.calls.filter(
        ([operation]) => operation === "account.me",
      ).length;
      await act(async () => {
        await client.refetchQueries({ queryKey: accountKey, exact: true });
      });
      await waitFor(() => expect(intentButton("lookup")).toBeTruthy());
      expect(
        fixture.reads.mock.calls.filter(
          ([operation]) => operation === "account.me",
        ).length,
      ).toBeGreaterThan(readsBefore);
      if (entry)
        expect([...new Set(fixture.queryMounts)]).toEqual(["account.me"]);
      else {
        fireEvent.click(
          screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
        );
        expect(editable("content", "home.setContent").disabled).toBe(true);
      }
      expect(fixture.intentClient!.getSnapshot().entries[0]?.status).toBe(
        "UNKNOWN",
      );
      expect(fixture.requests).toHaveLength(0);
    } finally {
      now.mockRestore();
    }
  },
);
