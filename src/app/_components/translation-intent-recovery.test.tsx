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
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createTranslationIntentClient,
  TRANSLATION_INTENT_STORAGE_KEY,
} from "~/lib/translation-intent-client";
import {
  TranslationIntentRecovery,
  TranslationIntentRecoveryEntry,
} from "./translation-intent-recovery";
import {
  useTranslationIntent,
  type TranslationBusiness,
} from "./use-translation-intent";
import type {
  AcceptedTranslationReceipt,
  TranslationIntentEnvelope,
} from "~/lib/translation-intent";

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  stop: vi.fn(),
  account: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("~/trpc/react", async () => {
  const { useMutation, useQuery, useQueryClient } =
    await import("@tanstack/react-query");
  return {
    api: {
      useUtils: () => {
        const queryClient = useQueryClient();
        return {
          client: {
            translationIntent: {
              get: {
                query: (input: { actorId: string; intentId: string }) =>
                  transport.get(input) as Promise<unknown>,
              },
            },
          },
          translationIntent: {
            get: {
              fetch: (input: { actorId: string; intentId: string }) =>
                queryClient.fetchQuery({
                  queryKey: ["intent-metadata", input],
                  queryFn: () => transport.get(input) as Promise<unknown>,
                  staleTime: 0,
                  retry: false,
                }),
            },
          },
        };
      },
      translationIntent: {
        stop: {
          useMutation: () =>
            useMutation({
              mutationFn: (input: unknown) =>
                transport.stop(input) as Promise<unknown>,
              retry: false,
            }),
        },
      },
      account: {
        me: {
          useQuery: () =>
            useQuery({
              queryKey: ["recovery-entry-account"],
              queryFn: () =>
                transport.account() as Promise<{
                  id: string;
                  role: string;
                  canTranslate: boolean;
                } | null>,
              retry: false,
            }),
        },
      },
    },
  };
});

const metadata = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  actorId: "synthetic-original",
  operation: "localization.setString" as const,
  mode: "DRAFT" as const,
};
let queryClient: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});
function restored(records: (typeof metadata)[] = [metadata]) {
  const values = new Map([
    [TRANSLATION_INTENT_STORAGE_KEY, JSON.stringify(records)],
  ]);
  const client = createTranslationIntentClient(() => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  }));
  return { client, values };
}
function show(
  client: ReturnType<typeof restored>["client"],
  actorId: string | null = metadata.actorId,
  refreshAuthority?: () => Promise<unknown>,
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TranslationIntentRecovery
        actorId={actorId}
        client={client}
        refreshAuthority={refreshAuthority}
      />
    </QueryClientProvider>,
  );
}

it("restores metadata-only lookup and durable Stop without guessing text or requiring Translator reads", async () => {
  const { client, values } = restored();
  transport.get.mockResolvedValue({
    status: "NOT_RECORDED",
    version: 1,
    intentId: metadata.id,
  });
  transport.stop.mockResolvedValue({
    status: "STOPPED",
    version: 1,
    intentId: metadata.id,
    stoppedAt: new Date(),
  });
  show(client);
  await screen.findByText("unknown");
  expect(screen.queryByRole("button", { name: "retryExact" })).toBeNull();
  expect(transport.get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "lookup" }));
  await screen.findByText("notRecorded");
  expect(client.getSnapshot().entries[0]?.status).toBe("UNKNOWN");
  expect(screen.queryByRole("button", { name: "dismiss" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "stop" }));
  await screen.findByText("stopped");
  expect(transport.stop).toHaveBeenCalledExactlyOnceWith({
    actorId: metadata.actorId,
    intentId: metadata.id,
  });
  expect(JSON.parse(values.get(TRANSLATION_INTENT_STORAGE_KEY)!)).toEqual([
    metadata,
  ]);
  fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
  await waitFor(() => expect(screen.queryByText("title")).toBeNull());
  expect(JSON.parse(values.get(TRANSLATION_INTENT_STORAGE_KEY)!)).toEqual([]);
});

it.each(["null", "denied", "transport", "binding"])(
  "keeps %s GET failures distinct from absence and hides private transport errors",
  async (kind) => {
    const { client } = restored();
    if (kind === "null") transport.get.mockResolvedValue(null);
    else if (kind === "binding")
      transport.get.mockResolvedValue({
        status: "NOT_RECORDED",
        version: 1,
        intentId: "different-uuid",
      });
    else
      transport.get.mockRejectedValue(
        Object.assign(new Error("PRIVATE-BODY-HASH"), {
          data: {
            code: kind === "denied" ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR",
          },
        }),
      );
    show(client);
    await screen.findByText("unknown");
    fireEvent.click(screen.getByRole("button", { name: "lookup" }));
    await screen.findByText("readFailed");
    expect(screen.queryByText("notRecorded")).toBeNull();
    expect(screen.queryByText(/PRIVATE-BODY-HASH/)).toBeNull();
    expect(client.getSnapshot().entries[0]).toMatchObject({
      status: "UNKNOWN",
      absent: false,
    });
  },
);

it("shows restored historical acceptance without claiming current publication or offering a guessed replay", async () => {
  const { client } = restored();
  transport.get.mockResolvedValue({
    status: "ACCEPTED",
    version: 1,
    intentId: metadata.id,
    operation: metadata.operation,
    mode: "DRAFT",
    outcome: "DRAFT_SUBMITTED",
    acceptedAt: new Date(),
    draftId: "historical-draft",
    cleared: false,
    replayed: true,
  });
  show(client);
  await screen.findByText("unknown");
  fireEvent.click(screen.getByRole("button", { name: "lookup" }));
  await screen.findByText("acceptedDraft");
  expect(screen.queryByRole("button", { name: "retryExact" })).toBeNull();
  expect(screen.queryByRole("button", { name: "refreshAccepted" })).toBeNull();
  expect(transport.stop).not.toHaveBeenCalled();
});

it("never displays or looks up another verified actor's recovery partition", async () => {
  const { client } = restored();
  show(client, "new-actor");
  await act(async () => {
    client.hydrate();
  });
  expect(screen.queryByText(metadata.id)).toBeNull();
  expect(screen.queryByRole("button", { name: "lookup" })).toBeNull();
  expect(transport.get).not.toHaveBeenCalled();
  expect(transport.stop).not.toHaveBeenCalled();
});

it("does not interpret an invalid Stop absence as permission to discard or replace the request", async () => {
  const { client } = restored();
  transport.stop.mockResolvedValue({
    status: "NOT_RECORDED",
    version: 1,
    intentId: metadata.id,
  });
  show(client);
  await screen.findByText("unknown");
  fireEvent.click(screen.getByRole("button", { name: "stop" }));
  await screen.findByText("readFailed");
  expect(client.getSnapshot().entries[0]?.status).toBe("UNKNOWN");
  expect(screen.queryByRole("button", { name: "dismiss" })).toBeNull();
});

it("offers own receipt recovery without Translator assignment through the metadata-only entry", async () => {
  const { client } = restored();
  transport.account.mockResolvedValue({
    id: metadata.actorId,
    role: "STUDENT",
    canTranslate: false,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TranslationIntentRecoveryEntry client={client} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "lookup" });
  expect(screen.getByRole("button", { name: "stop" })).toBeTruthy();
  expect(transport.account).toHaveBeenCalledTimes(1);
  expect(transport.get).not.toHaveBeenCalled();
  expect(transport.stop).not.toHaveBeenCalled();
});

it.each(["null", "denied"])(
  "keeps the metadata-only entry concealed for an unverified %s account response",
  async (mode) => {
    const { client } = restored();
    if (mode === "null") transport.account.mockResolvedValue(null);
    else
      transport.account.mockRejectedValue(new Error("PRIVATE account denial"));
    render(
      <QueryClientProvider client={queryClient}>
        <TranslationIntentRecoveryEntry client={client} />
      </QueryClientProvider>,
    );
    await screen.findByText("identityReadFailed");
    expect(screen.queryByRole("button", { name: "lookup" })).toBeNull();
    expect(screen.queryByText(/PRIVATE account denial/)).toBeNull();
    expect(transport.get).not.toHaveBeenCalled();
  },
);

it("keeps lookup and Stop available while an explicit original POST retry hangs", async () => {
  const { client } = restored([]);
  type Input = TranslationBusiness<"localization.setString"> & {
    intent: TranslationIntentEnvelope;
  };
  const accepted = (input: Input): AcceptedTranslationReceipt => ({
    status: "ACCEPTED",
    version: 1,
    intentId: input.intent.id,
    operation: "localization.setString",
    mode: "DRAFT",
    outcome: "DRAFT_SUBMITTED",
    acceptedAt: new Date(0),
    draftId: "synthetic-draft",
    cleared: false,
    replayed: false,
  });
  let finishRetry!: (value: {
    ok: true;
    receipt: AcceptedTranslationReceipt;
  }) => void;
  let attempts = 0;
  const send = vi.fn(
    (
      input: Input,
    ): Promise<{ ok: true; receipt: AcceptedTranslationReceipt }> => {
      if (++attempts === 1) return Promise.reject(new Error("Response lost"));
      if (attempts === 2)
        return new Promise((resolve) => {
          finishRetry = resolve;
        });
      return Promise.resolve({ ok: true, receipt: accepted(input) });
    },
  );
  const onAccepted = vi.fn();
  const onStopped = vi.fn();
  function Owner() {
    const intent = useTranslationIntent({
      actorId: metadata.actorId,
      mode: "DRAFT",
      canSubmit: true,
      client,
    });
    return (
      <>
        <button
          disabled={intent.blocked}
          onClick={() => {
            void intent.submit(
              "localization.setString",
              {
                locale: "en",
                key: "common.save",
                value: "Synthetic private text",
              },
              send,
              { onAccepted, onStopped },
            );
          }}
        >
          Submit deliberate edit
        </button>
        <TranslationIntentRecovery actorId={metadata.actorId} client={client} />
      </>
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Owner />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Submit deliberate edit",
      }).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Submit deliberate edit" }),
  );
  await screen.findByRole("button", { name: "retryExact" });
  fireEvent.click(screen.getByRole("button", { name: "retryExact" }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]![0]).toBe(send.mock.calls[0]![0]);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "retryExact" })).toBeNull(),
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "lookup" }).disabled,
  ).toBe(false);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "stop" }).disabled,
  ).toBe(false);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Submit deliberate edit",
    }).disabled,
  ).toBe(true);
  const original = send.mock.calls[0]![0];
  transport.stop.mockResolvedValue({
    status: "STOPPED",
    version: 1,
    intentId: original.intent.id,
    stoppedAt: new Date(0),
  });
  fireEvent.click(screen.getByRole("button", { name: "stop" }));
  await screen.findByText("stopped");
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Submit deliberate edit",
      }).disabled,
    ).toBe(false),
  );
  expect(onStopped).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(2); // Stop never posts a replacement.
  fireEvent.click(
    screen.getByRole("button", { name: "Submit deliberate edit" }),
  );
  await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
  expect(send.mock.calls[2]![0].intent.id).not.toBe(original.intent.id);
  await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
  await act(async () => {
    finishRetry({ ok: true, receipt: accepted(original) });
  });
  expect(onStopped).toHaveBeenCalledTimes(1);
  expect(onAccepted).toHaveBeenCalledTimes(1);
  expect(client.getSnapshot().entries.map((entry) => entry.status)).toEqual([
    "STOPPED",
    "ACCEPTED",
  ]);
});
it.each(["lookup", "authority-account", "authority-receipt"] as const)(
  "allows durable Stop and a fresh UUID while %s hangs, then absorbs its late result after dismissal",
  async (phase) => {
    const { client } = restored([]);
    type Input = TranslationBusiness<"localization.setString"> & {
      intent: TranslationIntentEnvelope;
    };
    const accepted = (input: Input): AcceptedTranslationReceipt => ({
      status: "ACCEPTED",
      version: 1,
      intentId: input.intent.id,
      operation: "localization.setString",
      mode: "DRAFT",
      outcome: "DRAFT_SUBMITTED",
      acceptedAt: new Date(0),
      draftId: "synthetic-draft",
      cleared: false,
      replayed: false,
    });
    const proof = {
      actorId: metadata.actorId,
      mode: "DRAFT" as const,
      canSubmit: true,
    };
    let finishProof!: (value: typeof proof) => void;
    let proofReads = 0;
    const refreshAuthority = vi.fn(() => {
      if (++proofReads === 1)
        return Promise.resolve({ ...proof, canSubmit: false });
      return phase === "authority-account"
        ? new Promise<typeof proof>((resolve) => {
            finishProof = resolve;
          })
        : Promise.resolve(proof);
    });
    let finishRead!: (value: unknown) => void;
    let rejectRead!: (error: Error) => void;
    transport.get.mockImplementation(
      () =>
        new Promise<unknown>((resolve, reject) => {
          finishRead = resolve;
          rejectRead = reject;
        }),
    );
    let finishNewPost!: (value: {
      ok: true;
      receipt: AcceptedTranslationReceipt;
    }) => void;
    let sends = 0;
    const send = vi.fn(
      (
        _input: Input,
      ): Promise<{ ok: true; receipt: AcceptedTranslationReceipt }> => {
        if (++sends === 1)
          return Promise.reject(
            phase === "lookup"
              ? new Error("Response lost")
              : Object.assign(new Error("Authority refused"), {
                  data: { code: "FORBIDDEN" },
                }),
          );
        return new Promise((resolve) => {
          finishNewPost = resolve;
        });
      },
    );
    const onAccepted = vi.fn();
    const onStopped = vi.fn();
    function Owner() {
      const intent = useTranslationIntent({
        actorId: metadata.actorId,
        mode: "DRAFT",
        canSubmit: true,
        client,
        refreshAuthority: phase === "lookup" ? undefined : refreshAuthority,
      });
      return (
        <>
          <button
            disabled={intent.blocked}
            onClick={() => {
              void intent.submit(
                "localization.setString",
                {
                  locale: "en",
                  key: "common.save",
                  value: "Synthetic private text",
                },
                send,
                { onAccepted, onStopped },
              );
            }}
          >
            Submit deliberate edit
          </button>
          <TranslationIntentRecovery
            actorId={metadata.actorId}
            client={client}
          />
        </>
      );
    }
    render(
      <QueryClientProvider client={queryClient}>
        <Owner />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Submit deliberate edit",
        }).disabled,
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Submit deliberate edit" }),
    );
    await screen.findByText("unknown");
    const original = send.mock.calls[0]![0];
    if (phase === "lookup") {
      const lookup = screen.getByRole("button", { name: "lookup" });
      fireEvent.click(lookup);
      fireEvent.click(lookup);
      await waitFor(() => expect(transport.get).toHaveBeenCalledTimes(1));
    } else {
      const recheck = await screen.findByRole("button", {
        name: "refreshAuthority",
      });
      fireEvent.click(recheck);
      fireEvent.click(recheck);
      await waitFor(() => expect(refreshAuthority).toHaveBeenCalledTimes(2));
      if (phase === "authority-receipt")
        await waitFor(() => expect(transport.get).toHaveBeenCalledTimes(1));
    }
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "stop" }).disabled,
    ).toBe(false);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Submit deliberate edit",
      }).disabled,
    ).toBe(true);
    transport.stop.mockResolvedValue({
      status: "STOPPED",
      version: 1,
      intentId: original.intent.id,
      stoppedAt: new Date(0),
    });
    fireEvent.click(screen.getByRole("button", { name: "stop" }));
    await screen.findByText("stopped");
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Submit deliberate edit",
        }).disabled,
      ).toBe(false),
    );
    expect(onStopped).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    await waitFor(() => expect(client.getSnapshot().entries).toHaveLength(0));
    fireEvent.click(
      screen.getByRole("button", { name: "Submit deliberate edit" }),
    );
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    const replacement = send.mock.calls[1]![0];
    expect(replacement.intent.id).not.toBe(original.intent.id);
    // The replacement remains pending while the old control completes. In the
    // lookup case, a late 403 after dismissal must not throw from denyAuthority.
    await act(async () => {
      if (phase === "lookup")
        rejectRead(
          Object.assign(new Error("Late private denial"), {
            data: { code: "FORBIDDEN" },
          }),
        );
      else if (phase === "authority-account") finishProof(proof);
      else
        finishRead({
          status: "NOT_RECORDED",
          version: 1,
          intentId: original.intent.id,
        });
    });
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Submit deliberate edit",
      }).disabled,
    ).toBe(true);
    expect(client.getSnapshot().entries).toMatchObject([
      {
        metadata: { id: replacement.intent.id },
        status: "PENDING",
        error: null,
      },
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(onStopped).toHaveBeenCalledTimes(1);
    expect(onAccepted).not.toHaveBeenCalled();
    expect(transport.get).toHaveBeenCalledTimes(
      phase === "authority-account" ? 0 : 1,
    );
    await act(async () => {
      finishNewPost({ ok: true, receipt: accepted(replacement) });
    });
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
    expect(client.getSnapshot().entries).toMatchObject([
      {
        metadata: { id: replacement.intent.id },
        status: "ACCEPTED",
        error: null,
      },
    ]);
  },
);
