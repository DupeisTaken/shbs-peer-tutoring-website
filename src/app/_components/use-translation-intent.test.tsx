/** @vitest-environment jsdom */
import { Activity, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  AcceptedTranslationReceipt,
  TranslationIntentEnvelope,
} from "~/lib/translation-intent";
import {
  createTranslationIntentClient,
  TRANSLATION_INTENT_STORAGE_KEY,
} from "~/lib/translation-intent-client";
import {
  useTranslationIntent,
  type TranslationBusiness,
  type TranslationAuthorityProof,
} from "./use-translation-intent";

const transport = vi.hoisted(() => ({ metadata: vi.fn() }));
vi.mock("~/trpc/react", async () => {
  const { useQueryClient } = await import("@tanstack/react-query");
  return {
    api: {
      useUtils: () => {
        const queryClient = useQueryClient();
        return {
          client: {
            translationIntent: {
              get: {
                query: (input: { actorId: string; intentId: string }) =>
                  transport.metadata(input) as Promise<unknown>,
              },
            },
          },
          translationIntent: {
            get: {
              fetch: (input: { actorId: string; intentId: string }) =>
                queryClient.fetchQuery({
                  queryKey: ["authority-receipt", input],
                  queryFn: () => transport.metadata(input) as Promise<unknown>,
                  staleTime: 0,
                  retry: false,
                }),
            },
          },
        };
      },
    },
  };
});
let queryClient: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  transport.metadata.mockImplementation(
    async (input: { intentId: string }) => ({
      status: "NOT_RECORDED",
      version: 1,
      intentId: input.intentId,
    }),
  );
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);
type Input = TranslationBusiness<"localization.setString"> & {
  intent: TranslationIntentEnvelope;
};
const business = {
  locale: "en",
  key: "common.save",
  value: "Private exact translation",
};
function receipt(input: Input): AcceptedTranslationReceipt {
  return {
    status: "ACCEPTED",
    version: 1,
    intentId: input.intent.id,
    operation: "localization.setString",
    mode: input.intent.mode,
    outcome: input.intent.mode === "DRAFT" ? "DRAFT_SUBMITTED" : "PUBLISHED",
    draftId: input.intent.mode === "DRAFT" ? "synthetic-draft" : null,
    cleared: false,
    acceptedAt: new Date("2026-11-09"),
    replayed: false,
  };
}
function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const client = createTranslationIntentClient(() => storage);
  return { client, values, storage };
}
const authority: {
  actorId: string;
  mode: "DRAFT" | "PUBLISH";
  canSubmit: boolean;
} = { actorId: "synthetic-author", mode: "DRAFT", canSubmit: true };

it("persists metadata before POST, synchronously fences a second admission, and marks ACCEPTED before failed read sync", async () => {
  const { client, values } = fixture();
  const { result } = renderHook(
    () => useTranslationIntent({ ...authority, client }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.blocked).toBe(false));
  let finish!: (value: {
    ok: true;
    receipt: AcceptedTranslationReceipt;
  }) => void;
  const send = vi.fn((input: Input) => {
    const records: unknown = JSON.parse(
      values.get(TRANSLATION_INTENT_STORAGE_KEY)!,
    );
    expect(records).toEqual([
      {
        id: input.intent.id,
        actorId: authority.actorId,
        operation: "localization.setString",
        mode: "DRAFT",
      },
    ]);
    expect(JSON.stringify(records)).not.toContain(business.value);
    return new Promise<{ ok: true; receipt: AcceptedTranslationReceipt }>(
      (resolve) => {
        finish = resolve;
      },
    );
  });
  const acceptanceStates: {
    status: string | undefined;
    synchronize: boolean;
  }[] = [];
  const onAccepted = vi.fn(
    async (
      _receipt: AcceptedTranslationReceipt,
      context: { synchronize: boolean },
    ) => {
      acceptanceStates.push({
        status: client.getSnapshot().entries[0]?.status,
        synchronize: context.synchronize,
      });
      throw new Error("Private failed refresh detail");
    },
  );
  let first!: ReturnType<typeof result.current.submit>;
  await act(async () => {
    first = result.current.submit("localization.setString", business, send, {
      onAccepted,
    });
    expect(
      await result.current.submit("localization.setString", business, send, {
        onAccepted,
      }),
    ).toEqual({ status: "BLOCKED" });
  });
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({ ok: true, receipt: receipt(send.mock.calls[0]![0]) });
    await first;
  });
  expect(await first).toMatchObject({ status: "ACCEPTED" });
  expect(client.getSnapshot().entries[0]).toMatchObject({
    status: "ACCEPTED",
    error: "refresh",
  });
  expect(onAccepted).toHaveBeenCalledTimes(1);
  expect(acceptanceStates).toEqual([{ status: "ACCEPTED", synchronize: true }]);
  expect(
    JSON.stringify(values.get(TRANSLATION_INTENT_STORAGE_KEY)),
  ).not.toContain("Private");
});

it("gives two deliberate identical submissions distinct UUIDs and their own accepted handlers", async () => {
  const { client } = fixture();
  const { result } = renderHook(
    () => useTranslationIntent({ ...authority, client }),
    { wrapper },
  );
  const send = vi.fn(async (input: Input) => ({
    ok: true as const,
    receipt: receipt(input),
  }));
  const firstAccepted = vi.fn();
  const secondAccepted = vi.fn();
  await act(async () => {
    await result.current.submit("localization.setString", business, send, {
      onAccepted: firstAccepted,
    });
  });
  await act(async () => {
    await result.current.submit("localization.setString", business, send, {
      onAccepted: secondAccepted,
    });
  });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0]![0].intent.id).not.toBe(
    send.mock.calls[1]![0].intent.id,
  );
  expect(firstAccepted).toHaveBeenCalledTimes(1);
  expect(secondAccepted).toHaveBeenCalledTimes(1);
});

it("joins overlapping RPC/GET accepted delivery and repeats only an explicit settled read refresh", async () => {
  const { client } = fixture();
  const { result } = renderHook(
    () => useTranslationIntent({ ...authority, client }),
    { wrapper },
  );
  let finish!: () => void;
  const readPhase = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const onAccepted = vi.fn(async () => {
    await readPhase;
  });
  const send = vi.fn(async (input: Input) => ({
    ok: true as const,
    receipt: receipt(input),
  }));
  let submitting!: ReturnType<typeof result.current.submit>;
  await act(async () => {
    submitting = result.current.submit(
      "localization.setString",
      business,
      send,
      { onAccepted },
    );
  });
  await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
  const metadata = client.getSnapshot().entries[0]!.metadata;
  let lookupDelivery!: Promise<void>;
  await act(async () => {
    client.resolve(metadata, receipt(send.mock.calls[0]![0]));
    lookupDelivery = client.deliver(metadata);
  });
  expect(onAccepted).toHaveBeenCalledTimes(1);
  expect(result.current.pending).toBe(true);
  await act(async () => {
    finish();
    await submitting;
    await lookupDelivery;
  });
  expect(onAccepted).toHaveBeenCalledTimes(1);
  await act(async () => {
    await client.refresh(metadata);
  });
  expect(onAccepted).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenCalledTimes(1);
});

it("returns already verified ACCEPTED when a later RPC response is malformed", async () => {
  const { client } = fixture();
  const { result } = renderHook(
    () => useTranslationIntent({ ...authority, client }),
    { wrapper },
  );
  let finish!: (value: {
    ok: true;
    receipt?: AcceptedTranslationReceipt;
  }) => void;
  const send = vi.fn(
    (_input: Input) =>
      new Promise<{ ok: true; receipt?: AcceptedTranslationReceipt }>(
        (resolve) => {
          finish = resolve;
        },
      ),
  );
  const onAccepted = vi.fn();
  let submitting!: ReturnType<typeof result.current.submit>;
  await act(async () => {
    submitting = result.current.submit(
      "localization.setString",
      business,
      send,
      { onAccepted },
    );
  });
  const metadata = client.getSnapshot().entries[0]!.metadata;
  await act(async () => {
    client.resolve(metadata, receipt(send.mock.calls[0]![0]));
    await client.deliver(metadata);
  });
  await act(async () => {
    finish({ ok: true });
    await submitting;
  });
  expect(await submitting).toMatchObject({ status: "ACCEPTED" });
  expect(onAccepted).toHaveBeenCalledTimes(1);
  expect(client.getSnapshot().entries[0]?.status).toBe("ACCEPTED");
});

it.each(["STOPPED", "ACCEPTED"] as const)(
  "settles a hanging transport after verified %s and isolates its late completion from a fresh attempt",
  async (status) => {
    const { client } = fixture();
    const { result } = renderHook(
      () => useTranslationIntent({ ...authority, client }),
      { wrapper },
    );
    let finish!: (value: {
      ok: true;
      receipt: AcceptedTranslationReceipt;
    }) => void;
    const held = new Promise<{ ok: true; receipt: AcceptedTranslationReceipt }>(
      (resolve) => {
        finish = resolve;
      },
    );
    let attempts = 0;
    const send = vi.fn((input: Input) =>
      ++attempts === 1
        ? held
        : Promise.resolve({ ok: true as const, receipt: receipt(input) }),
    );
    const firstAccepted = vi.fn();
    const firstStopped = vi.fn();
    let first!: ReturnType<typeof result.current.submit>;
    await act(async () => {
      first = result.current.submit("localization.setString", business, send, {
        onAccepted: firstAccepted,
        onStopped: firstStopped,
      });
    });
    const original = send.mock.calls[0]![0];
    const metadata = client.getSnapshot().entries[0]!.metadata;
    await act(async () => {
      client.resolve(
        metadata,
        status === "ACCEPTED"
          ? receipt(original)
          : {
              status,
              version: 1,
              intentId: metadata.id,
              stoppedAt: new Date(),
            },
      );
      await client.deliver(metadata);
      expect(await first).toMatchObject({ status });
    });
    expect(result.current.pending).toBe(false);
    const nextAccepted = vi.fn();
    await act(async () => {
      await result.current.submit("localization.setString", business, send, {
        onAccepted: nextAccepted,
      });
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0].intent.id).not.toBe(original.intent.id);
    expect(nextAccepted).toHaveBeenCalledTimes(1);
    const touch = vi.spyOn(client, "touch");
    await act(async () => {
      finish({ ok: true, receipt: receipt(original) });
    });
    await waitFor(() => expect(touch).toHaveBeenCalled());
    expect(firstAccepted).toHaveBeenCalledTimes(status === "ACCEPTED" ? 1 : 0);
    expect(firstStopped).toHaveBeenCalledTimes(status === "STOPPED" ? 1 : 0);
    expect(nextAccepted).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(false);
    expect(result.current.recovery.map((entry) => entry.status)).toEqual([
      status,
      "ACCEPTED",
    ]);
  },
);

it("retries UNKNOWN only explicitly with the same immutable parsed input and UUID", async () => {
  const { client } = fixture();
  const { result, rerender } = renderHook(
    (props) => useTranslationIntent({ ...props, client }),
    { wrapper, initialProps: authority },
  );
  const mutable = { ...business };
  let attempts = 0;
  const send = vi.fn(async (input: Input) => {
    if (++attempts === 1)
      throw Object.assign(new Error("Lost response"), {
        data: { code: "BAD_REQUEST" },
      });
    return { ok: true as const, receipt: receipt(input) };
  });
  const onAccepted = vi.fn();
  await act(async () => {
    expect(
      await result.current.submit("localization.setString", mutable, send, {
        onAccepted,
      }),
    ).toEqual({ status: "UNKNOWN" });
  });
  mutable.value = "Later unsent text";
  rerender({ ...authority });
  expect(send).toHaveBeenCalledTimes(1);
  expect(result.current.blocked).toBe(true);
  const metadata = client.getSnapshot().entries[0]!.metadata;
  act(() => {
    client.resolve(metadata, {
      status: "NOT_RECORDED",
      version: 1,
      intentId: metadata.id,
    });
  });
  await act(async () => {
    expect(
      await result.current.submit("localization.setString", mutable, send, {
        onAccepted,
      }),
    ).toEqual({ status: "BLOCKED" });
  });
  await act(async () => {
    await client.retry(metadata);
  });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1]![0]).toBe(send.mock.calls[0]![0]);
  expect(send.mock.calls[1]![0].value).toBe(business.value);
  expect(onAccepted).toHaveBeenCalledTimes(1);
});

it("retains UNKNOWN through same-actor mode/capability changes and releases the exact lease only on durable Stop", async () => {
  const { client } = fixture();
  const { result, rerender } = renderHook(
    (props: {
      actorId: string;
      mode: "DRAFT" | "PUBLISH";
      canSubmit: boolean;
    }) => useTranslationIntent({ ...props, client }),
    { wrapper, initialProps: authority },
  );
  const send = vi.fn(
    async (
      _input: Input,
    ): Promise<{ ok: true; receipt?: AcceptedTranslationReceipt }> => {
      throw new Error("Unknown");
    },
  );
  let lease = true;
  const onStopped = vi.fn(() => {
    lease = false;
  });
  await act(async () => {
    await result.current.submit("localization.setString", business, send, {
      onAccepted: vi.fn(),
      onStopped,
    });
  });
  expect(lease).toBe(true);
  rerender({ ...authority, mode: "PUBLISH" });
  await act(async () => {
    await client.retry(client.getSnapshot().entries[0]!.metadata);
  });
  expect(send).toHaveBeenCalledTimes(1);
  rerender({ ...authority, canSubmit: false });
  const metadata = client.getSnapshot().entries[0]!.metadata;
  await act(async () => {
    client.resolve(metadata, {
      status: "STOPPED",
      version: 1,
      intentId: metadata.id,
      stoppedAt: new Date(),
    });
    await client.deliver(metadata);
  });
  expect(onStopped).toHaveBeenCalledTimes(1);
  expect(lease).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);
  rerender(authority);
  await waitFor(() => expect(result.current.blocked).toBe(false));
});

it("retains the original unresolved owner through unavailable identity without enabling retry", async () => {
  const { client } = fixture();
  const options: {
    actorId: string | null;
    mode: "DRAFT" | "PUBLISH";
    canSubmit: boolean;
  } = { ...authority };
  const { result, rerender } = renderHook(
    (props) => useTranslationIntent({ ...props, client }),
    { wrapper, initialProps: options },
  );
  const send = vi.fn(async (_input: Input): Promise<{ ok: true }> => {
    throw new Error("Unknown response");
  });
  await act(async () => {
    await result.current.submit("localization.setString", business, send, {
      onAccepted: vi.fn(),
    });
  });
  rerender({ ...options, actorId: null, canSubmit: false });
  expect(result.current.recovery).toMatchObject([
    { metadata: { actorId: authority.actorId }, status: "UNKNOWN" },
  ]);
  expect(result.current.blocked).toBe(true);
  await waitFor(() =>
    expect(client.getSnapshot().entries[0]?.canRetry).toBe(false),
  );
  await act(async () => {
    await client.retry(client.getSnapshot().entries[0]!.metadata);
  });
  expect(send).toHaveBeenCalledTimes(1);
});

it("marks local acceptance with synchronize=false after capability loss and never delivers into a new actor", async () => {
  const { client } = fixture();
  const { result, rerender } = renderHook(
    (props) => useTranslationIntent({ ...props, client }),
    { wrapper, initialProps: authority },
  );
  let finish!: (value: {
    ok: true;
    receipt: AcceptedTranslationReceipt;
  }) => void;
  const send = vi.fn(
    (_input: Input) =>
      new Promise<{ ok: true; receipt: AcceptedTranslationReceipt }>(
        (resolve) => {
          finish = resolve;
        },
      ),
  );
  const onAccepted = vi.fn();
  let pending!: ReturnType<typeof result.current.submit>;
  await act(async () => {
    pending = result.current.submit("localization.setString", business, send, {
      onAccepted,
    });
  });
  rerender({ ...authority, canSubmit: false });
  await act(async () => {
    finish({ ok: true, receipt: receipt(send.mock.calls[0]![0]) });
    await pending;
  });
  expect(onAccepted).toHaveBeenCalledWith(expect.anything(), {
    synchronize: false,
  });
  rerender({ ...authority, actorId: "new-verified-actor" });
  const newerAccepted = vi.fn();
  await act(async () => {
    pending = result.current.submit("localization.setString", business, send, {
      onAccepted: newerAccepted,
    });
  });
  rerender({ ...authority, actorId: "third-verified-actor" });
  await act(async () => {
    finish({ ok: true, receipt: receipt(send.mock.calls[1]![0]) });
    await pending;
  });
  expect(newerAccepted).not.toHaveBeenCalled();
  expect(result.current.recovery).toHaveLength(0);
});

it("cleans up Activity retry registration but preserves metadata and pure local late acceptance", async () => {
  const { client } = fixture();
  let controller!: ReturnType<typeof useTranslationIntent>;
  function Owner() {
    controller = useTranslationIntent({ ...authority, client });
    return null;
  }
  const ownerView = (mode: "visible" | "hidden") => (
    <QueryClientProvider client={queryClient}>
      <Activity mode={mode}>
        <Owner />
      </Activity>
    </QueryClientProvider>
  );
  const view = render(ownerView("visible"));
  let finish!: (value: {
    ok: true;
    receipt: AcceptedTranslationReceipt;
  }) => void;
  const send = vi.fn(
    (_input: Input) =>
      new Promise<{ ok: true; receipt: AcceptedTranslationReceipt }>(
        (resolve) => {
          finish = resolve;
        },
      ),
  );
  const onAccepted = vi.fn();
  let pending!: ReturnType<typeof controller.submit>;
  await act(async () => {
    pending = controller.submit("localization.setString", business, send, {
      onAccepted,
    });
  });
  view.rerender(ownerView("hidden"));
  expect(client.getSnapshot().entries[0]).toMatchObject({
    status: "UNKNOWN",
    canRetry: false,
  });
  await act(async () => {
    finish({ ok: true, receipt: receipt(send.mock.calls[0]![0]) });
    await pending;
  });
  expect(onAccepted).toHaveBeenCalledWith(expect.anything(), {
    synchronize: false,
  });
  expect(client.getSnapshot().entries[0]?.status).toBe("ACCEPTED");
  view.rerender(ownerView("visible"));
  expect(send).toHaveBeenCalledTimes(1);
  expect(onAccepted).toHaveBeenCalledTimes(1);
});

it("refuses every POST if storage cannot persist recovery metadata", async () => {
  const client = createTranslationIntentClient(() => {
    throw new Error("Storage disabled");
  });
  const { result } = renderHook(
    () => useTranslationIntent({ ...authority, client }),
    { wrapper },
  );
  const send = vi.fn();
  await act(async () => {
    expect(
      await result.current.submit("localization.setString", business, send, {
        onAccepted: vi.fn(),
      }),
    ).toEqual({ status: "BLOCKED" });
  });
  expect(send).not.toHaveBeenCalled();
  expect(result.current.error).toBe("storage");
});

it.each(["FORBIDDEN", "UNAUTHORIZED"])(
  "fences cached authority after %s until fresh own proof AND receipt lifecycle read allow explicit retry",
  async (code) => {
    const { client } = fixture();
    let finish!: (proof: TranslationAuthorityProof) => void;
    const refreshAuthority = vi.fn(
      () =>
        new Promise<TranslationAuthorityProof>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(
      () => useTranslationIntent({ ...authority, client, refreshAuthority }),
      { wrapper },
    );
    let attempts = 0;
    const send = vi.fn(async (input: Input) => {
      if (++attempts === 1)
        throw Object.assign(new Error("PRIVATE-DENIAL"), { data: { code } });
      return { ok: true as const, receipt: receipt(input) };
    });
    await act(async () => {
      await result.current.submit("localization.setString", business, send, {
        onAccepted: vi.fn(),
      });
    });
    const metadata = client.getSnapshot().entries[0]!.metadata;
    expect(client.getSnapshot().entries[0]).toMatchObject({
      needsAuthority: true,
      canRetry: false,
    });
    await act(async () => {
      await client.retry(metadata);
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(transport.metadata).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshAuthority).toHaveBeenCalledTimes(1));
    await act(async () => {
      finish({ ...authority });
    });
    await waitFor(() =>
      expect(client.getSnapshot().entries[0]?.canRetry).toBe(true),
    );
    expect(transport.metadata).toHaveBeenCalledExactlyOnceWith({
      actorId: authority.actorId,
      intentId: metadata.id,
    });
    expect(send).toHaveBeenCalledTimes(1); // positive proof never retries automatically
    await act(async () => {
      await client.retry(metadata);
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toBe(send.mock.calls[0]![0]);
  },
);

it.each([
  { actorId: "different-account", mode: "DRAFT", canSubmit: true },
  { actorId: authority.actorId, mode: "PUBLISH", canSubmit: true },
  { actorId: authority.actorId, mode: "DRAFT", canSubmit: false },
  { actorId: null, mode: "DRAFT", canSubmit: false },
] satisfies TranslationAuthorityProof[])(
  "does not query the original UUID or retry after incompatible fresh proof %j",
  async (proof) => {
    const { client } = fixture();
    const refreshAuthority = vi.fn(async () => proof);
    const { result } = renderHook(
      () => useTranslationIntent({ ...authority, client, refreshAuthority }),
      { wrapper },
    );
    const send = vi.fn(async (_input: Input): Promise<{ ok: true }> => {
      throw Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } });
    });
    await act(async () => {
      await result.current.submit("localization.setString", business, send, {
        onAccepted: vi.fn(),
      });
    });
    await waitFor(() =>
      expect(client.getSnapshot().entries[0]?.canRecheck).toBe(true),
    );
    const metadata = client.getSnapshot().entries[0]!.metadata;
    expect(client.getSnapshot().entries[0]).toMatchObject({
      status: "UNKNOWN",
      needsAuthority: true,
      canRetry: false,
    });
    expect(transport.metadata).not.toHaveBeenCalled();
    await act(async () => {
      await client.retry(metadata);
    });
    expect(send).toHaveBeenCalledTimes(1);
  },
);

it("keeps suspension/session lifecycle denial fenced even when fresh account.me still reports Translator authority", async () => {
  const { client } = fixture();
  const refreshAuthority = vi.fn(async () => ({ ...authority }));
  transport.metadata.mockRejectedValue(
    Object.assign(new Error("Suspended"), { data: { code: "FORBIDDEN" } }),
  );
  const { result } = renderHook(
    () => useTranslationIntent({ ...authority, client, refreshAuthority }),
    { wrapper },
  );
  const send = vi.fn(async (_input: Input): Promise<{ ok: true }> => {
    throw Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } });
  });
  await act(async () => {
    await result.current.submit("localization.setString", business, send, {
      onAccepted: vi.fn(),
    });
  });
  await waitFor(() =>
    expect(client.getSnapshot().entries[0]?.canRecheck).toBe(true),
  );
  expect(transport.metadata).toHaveBeenCalledTimes(1);
  expect(client.getSnapshot().entries[0]).toMatchObject({
    needsAuthority: true,
    canRetry: false,
  });
  await act(async () => {
    await client.retry(client.getSnapshot().entries[0]!.metadata);
  });
  expect(send).toHaveBeenCalledTimes(1);
});

it.each(["FORBIDDEN", "UNAUTHORIZED"])(
  "does not join a predenial in-flight receipt lookup as lifecycle proof after %s",
  async (code) => {
    const { client } = fixture();
    let finishProof!: (proof: TranslationAuthorityProof) => void;
    const refreshAuthority = vi.fn(
      () =>
        new Promise<TranslationAuthorityProof>((resolve) => {
          finishProof = resolve;
        }),
    );
    const { result } = renderHook(
      () => useTranslationIntent({ ...authority, client, refreshAuthority }),
      { wrapper },
    );
    let rejectSend!: (error: Error) => void;
    const send = vi.fn(
      (_input: Input) =>
        new Promise<{ ok: true }>((_resolve, reject) => {
          rejectSend = reject;
        }),
    );
    let submitting!: ReturnType<typeof result.current.submit>;
    await act(async () => {
      submitting = result.current.submit(
        "localization.setString",
        business,
        send,
        { onAccepted: vi.fn() },
      );
    });
    const metadata = client.getSnapshot().entries[0]!.metadata;
    const input = { actorId: metadata.actorId, intentId: metadata.id };
    const absent = {
      status: "NOT_RECORDED",
      version: 1,
      intentId: metadata.id,
    };
    let finishOldLookup!: (value: typeof absent) => void;
    transport.metadata
      .mockImplementationOnce(
        () =>
          new Promise<typeof absent>((resolve) => {
            finishOldLookup = resolve;
          }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error("Current lifecycle refused"), {
          data: { code },
        }),
      );
    // This real cache request starts while the original POST has no denial yet.
    // staleTime:0 alone would join it after proof and reuse its older success.
    const oldLookup = queryClient.fetchQuery({
      queryKey: ["authority-receipt", input],
      queryFn: () => transport.metadata(input) as Promise<unknown>,
      staleTime: 0,
      retry: false,
    });
    expect(transport.metadata).toHaveBeenCalledTimes(1);
    await act(async () => {
      rejectSend(
        Object.assign(new Error("POST authority refused"), { data: { code } }),
      );
      expect(await submitting).toEqual({ status: "UNKNOWN" });
    });
    await waitFor(() => expect(refreshAuthority).toHaveBeenCalledTimes(1));
    expect(transport.metadata).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot().entries[0]).toMatchObject({
      needsAuthority: true,
      canRetry: false,
    });
    await act(async () => {
      finishProof({ ...authority });
    });
    // A new protected read must run even while the older cache Promise is held.
    await waitFor(() => expect(transport.metadata).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(client.getSnapshot().entries[0]?.canRecheck).toBe(true),
    );
    expect(transport.metadata.mock.calls).toEqual([[input], [input]]);
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishOldLookup(absent);
      await oldLookup;
    });
    expect(queryClient.getQueryData(["authority-receipt", input])).toEqual(
      absent,
    );
    expect(client.getSnapshot().entries[0]).toMatchObject({
      status: "UNKNOWN",
      needsAuthority: true,
      canRetry: false,
      absent: false,
    });
    await act(async () => {
      await client.retry(metadata);
    });
    expect(send).toHaveBeenCalledTimes(1);
  },
);
it.each([
  null,
  undefined,
  { status: "NOT_RECORDED", version: 1, intentId: "different" },
])(
  "does not infer lifecycle authority from missing or mismatched receipt data: %j",
  async (value) => {
    const { client } = fixture();
    transport.metadata.mockResolvedValue(value);
    const refreshAuthority = vi.fn(async () => ({ ...authority }));
    const { result } = renderHook(
      () => useTranslationIntent({ ...authority, client, refreshAuthority }),
      { wrapper },
    );
    const send = vi.fn(async (_input: Input): Promise<{ ok: true }> => {
      throw Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } });
    });
    await act(async () => {
      await result.current.submit("localization.setString", business, send, {
        onAccepted: vi.fn(),
      });
    });
    await waitFor(() =>
      expect(client.getSnapshot().entries[0]?.canRecheck).toBe(true),
    );
    expect(client.getSnapshot().entries[0]).toMatchObject({
      needsAuthority: true,
      canRetry: false,
      absent: false,
    });
    await act(async () => {
      await client.retry(client.getSnapshot().entries[0]!.metadata);
    });
    expect(send).toHaveBeenCalledTimes(1);
  },
);

it("does not start the next authority-read phase after the original owner is disposed", async () => {
  const { client } = fixture();
  let finish!: (proof: TranslationAuthorityProof) => void;
  const refreshAuthority = vi.fn(
    () =>
      new Promise<TranslationAuthorityProof>((resolve) => {
        finish = resolve;
      }),
  );
  const { result, unmount } = renderHook(
    () => useTranslationIntent({ ...authority, client, refreshAuthority }),
    { wrapper },
  );
  const send = vi.fn(async (_input: Input): Promise<{ ok: true }> => {
    throw Object.assign(new Error("Denied"), {
      data: { code: "UNAUTHORIZED" },
    });
  });
  await act(async () => {
    await result.current.submit("localization.setString", business, send, {
      onAccepted: vi.fn(),
    });
  });
  await waitFor(() => expect(refreshAuthority).toHaveBeenCalledTimes(1));
  unmount();
  await act(async () => {
    finish({ ...authority });
  });
  expect(transport.metadata).not.toHaveBeenCalled();
  expect(client.getSnapshot().entries[0]).toMatchObject({
    status: "UNKNOWN",
    canRetry: false,
  });
});

it.each(["ACCEPTED", "STOPPED"] as const)(
  "applies %s discovered during authority verification instead of posting again",
  async (status) => {
    const { client } = fixture();
    const refreshAuthority = vi.fn(async () => ({ ...authority }));
    const { result } = renderHook(
      () => useTranslationIntent({ ...authority, client, refreshAuthority }),
      { wrapper },
    );
    const send = vi.fn(async (_input: Input): Promise<{ ok: true }> => {
      throw Object.assign(new Error("Denied response"), {
        data: { code: "UNAUTHORIZED" },
      });
    });
    const onAccepted = vi.fn();
    const onStopped = vi.fn();
    transport.metadata.mockImplementation(async () =>
      status === "ACCEPTED"
        ? receipt(send.mock.calls[0]![0])
        : {
            status,
            version: 1,
            intentId: send.mock.calls[0]![0].intent.id,
            stoppedAt: new Date(),
          },
    );
    await act(async () => {
      await result.current.submit("localization.setString", business, send, {
        onAccepted,
        onStopped,
      });
    });
    await waitFor(() =>
      expect(client.getSnapshot().entries[0]?.status).toBe(status),
    );
    await waitFor(() =>
      expect(
        status === "ACCEPTED" ? onAccepted : onStopped,
      ).toHaveBeenCalledTimes(1),
    );
    expect(client.getSnapshot().entries[0]?.canRetry).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  },
);

it.each(["NOT_RECORDED", "ACCEPTED", "STOPPED"] as const)(
  "keeps a newer denial fenced when an older authority read returns %s, while retaining terminal evidence",
  async (status) => {
    const { client } = fixture();
    const refreshAuthority = vi.fn(async () => ({ ...authority }));
    let finishRead!: (value: unknown) => void;
    transport.metadata.mockImplementationOnce(
      () =>
        new Promise<unknown>((resolve) => {
          finishRead = resolve;
        }),
    );
    const { result } = renderHook(
      () => useTranslationIntent({ ...authority, client, refreshAuthority }),
      { wrapper },
    );
    let attempts = 0;
    const send = vi.fn(async (input: Input) => {
      if (++attempts === 1)
        throw Object.assign(new Error("First authorization refusal"), {
          data: { code: "FORBIDDEN" },
        });
      return { ok: true as const, receipt: receipt(input) };
    });
    const onAccepted = vi.fn();
    const onStopped = vi.fn();
    await act(async () => {
      await result.current.submit("localization.setString", business, send, {
        onAccepted,
        onStopped,
      });
    });
    const metadata = client.getSnapshot().entries[0]!.metadata;
    await waitFor(() => expect(transport.metadata).toHaveBeenCalledTimes(1));
    // A second protected lookup refuses access while the first authority GET is
    // still pending. Joining that in-flight recheck cannot clear this new fence.
    act(() => {
      client.denyAuthority(metadata);
    });
    expect(refreshAuthority).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot().entries[0]).toMatchObject({
      needsAuthority: true,
      canRetry: false,
    });
    await act(async () => {
      finishRead(
        status === "ACCEPTED"
          ? receipt(send.mock.calls[0]![0])
          : status === "STOPPED"
            ? {
                status,
                version: 1,
                intentId: metadata.id,
                stoppedAt: new Date(0),
              }
            : { status, version: 1, intentId: metadata.id },
      );
    });
    expect(send).toHaveBeenCalledTimes(1);
    if (status === "NOT_RECORDED") {
      await waitFor(() =>
        expect(client.getSnapshot().entries[0]?.canRecheck).toBe(true),
      );
      expect(client.getSnapshot().entries[0]).toMatchObject({
        status: "UNKNOWN",
        needsAuthority: true,
        canRetry: false,
      });
      await act(async () => {
        await client.retry(metadata);
      });
      expect(send).toHaveBeenCalledTimes(1);
      // A separate fresh proof/read is the positive control; no automatic POST.
      await act(async () => {
        await client.recheck(metadata);
      });
      expect(refreshAuthority).toHaveBeenCalledTimes(2);
      expect(transport.metadata).toHaveBeenCalledTimes(2);
      expect(client.getSnapshot().entries[0]).toMatchObject({
        needsAuthority: false,
        canRetry: true,
      });
      expect(send).toHaveBeenCalledTimes(1);
      await act(async () => {
        await client.retry(metadata);
      });
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[1]![0]).toBe(send.mock.calls[0]![0]);
    } else {
      await waitFor(() =>
        expect(
          status === "ACCEPTED" ? onAccepted : onStopped,
        ).toHaveBeenCalledTimes(1),
      );
      expect(client.getSnapshot().entries[0]?.status).toBe(status);
      await act(async () => {
        await client.retry(metadata);
      });
      expect(send).toHaveBeenCalledTimes(1);
    }
  },
);
