"use client";

import {
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { z } from "zod";
import { api } from "~/trpc/react";
import {
  translationBusinessInputs,
  type AcceptedTranslationReceipt,
  type TranslationIntentEnvelope,
  type TranslationIntentMode,
  type TranslationOperation,
  type TranslationReceiptResult,
} from "~/lib/translation-intent";
import {
  isTranslationIntentUnresolved,
  isTranslationAuthorityError,
  parseTranslationAuthorityProof,
  translationIntentClient,
  type TranslationIntentClient,
  type TranslationIntentMetadata,
  type TranslationIntentOwner,
  type TranslationAuthorityProof,
} from "~/lib/translation-intent-client";
export type { TranslationAuthorityProof } from "~/lib/translation-intent-client";

export type TranslationBusiness<Operation extends TranslationOperation> =
  z.output<(typeof translationBusinessInputs)[Operation]>;
export type TranslationRawSender<Operation extends TranslationOperation> = (
  input: Readonly<
    TranslationBusiness<Operation> & { intent: TranslationIntentEnvelope }
  >,
) => Promise<{
  ok: true;
  receipt?: AcceptedTranslationReceipt;
  cleared?: boolean;
}>;
export type TranslationSubmitResult =
  | { status: "ACCEPTED"; receipt: AcceptedTranslationReceipt }
  | { status: "UNKNOWN" | "BLOCKED" | "STOPPED" };
export type TranslationAccepted = (
  receipt: AcceptedTranslationReceipt,
  context: { synchronize: boolean },
) => void | Promise<unknown>;
export type TranslationIntentHandlers = {
  onAccepted: TranslationAccepted;
  onStopped?: (
    receipt: Extract<TranslationReceiptResult, { status: "STOPPED" }>,
  ) => void | Promise<unknown>;
};

const serverSnapshot = {
  ready: false,
  storageError: false,
  entries: [],
} as const;
export function useTranslationIntentRegistry(
  client: TranslationIntentClient = translationIntentClient,
) {
  const snapshot = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    () => serverSnapshot,
  );
  useEffect(() => {
    client.hydrate();
  }, [client]);
  return snapshot;
}

type Captured = {
  metadata: TranslationIntentMetadata;
  send: () => Promise<{ ok: true; receipt?: AcceptedTranslationReceipt }>;
  handlers: TranslationIntentHandlers;
  running: boolean;
  delivered: boolean;
  receipt?: AcceptedTranslationReceipt;
  delivery?: Promise<void>;
  terminal: Promise<TranslationSubmitResult>;
  settleTerminal: (result: TranslationSubmitResult) => void;
  needsAuthority: boolean;
  denialVersion: number;
  rechecking?: Promise<void>;
};

type OwnerAuthority = {
  actorId?: string | null;
  mode: TranslationIntentMode;
  canSubmit: boolean;
  refreshAuthority?: () => Promise<TranslationAuthorityProof>;
  readReceipt: (input: {
    actorId: string;
    intentId: string;
  }) => Promise<unknown>;
};
type OwnerSnapshot = {
  actorId: string | null;
  intentId: string | null;
  pending: boolean;
  delivered: boolean;
  error: "storage" | null;
};

/** Imperative leases and exact private input never participate in React render.
 * Only this small immutable projection is exposed through the external store. */
function createTranslationIntentOwner(client: TranslationIntentClient) {
  let latest: OwnerAuthority = {
    actorId: null,
    mode: "DRAFT",
    canSubmit: false,
    readReceipt: async () => {
      throw new Error("Translation authority is not committed.");
    },
  };
  let verifiedActor: string | null | undefined = null;
  let captured: Captured | null = null;
  let detach: (() => void) | null = null;
  let active = false;
  let error: "storage" | null = null;
  const listeners = new Set<() => void>();
  let view: OwnerSnapshot = {
    actorId: null,
    intentId: null,
    pending: false,
    delivered: true,
    error: null,
  };
  const publish = () => {
    const next: OwnerSnapshot = {
      actorId: verifiedActor ?? null,
      intentId: captured?.metadata.id ?? null,
      pending: captured?.running === true || captured?.delivery !== undefined,
      delivered: captured?.delivered ?? true,
      error,
    };
    if (
      view.actorId === next.actorId &&
      view.intentId === next.intentId &&
      view.pending === next.pending &&
      view.delivered === next.delivered &&
      view.error === next.error
    )
      return;
    view = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const touch = () => {
    publish();
    client.touch();
  };
  const owns = (intent: Captured) =>
    captured === intent && verifiedActor === intent.metadata.actorId;
  const mayRetry = (intent: Captured) =>
    active &&
    owns(intent) &&
    latest.actorId === intent.metadata.actorId &&
    latest.canSubmit &&
    latest.mode === intent.metadata.mode &&
    !intent.running &&
    !intent.needsAuthority &&
    !intent.rechecking;
  const deliver = async (
    intent: Captured,
    callback: () => Promise<unknown> | void,
    repeat = false,
  ) => {
    if (!owns(intent)) return;
    if (intent.delivery) {
      await intent.delivery;
      return;
    }
    if (intent.delivered && !repeat) return;
    // Install the lease before invoking user code; a concurrent RPC/GET/Stop
    // notification joins this delivery instead of running the read phase twice.
    const delivery = Promise.resolve().then(async () => {
      if (!owns(intent)) return;
      intent.delivered = true;
      try {
        await callback();
        client.error(intent.metadata, null);
      } catch {
        client.error(intent.metadata, "refresh");
      }
    });
    intent.delivery = delivery;
    touch();
    try {
      await delivery;
    } finally {
      intent.delivery = undefined;
      const terminal = client.terminal(intent.metadata);
      if (terminal) {
        // A verified terminal settles the logical attempt even if the original
        // transport is still hanging. Its late completion remains this old ID.
        intent.running = false;
        intent.settleTerminal(
          terminal.status === "ACCEPTED"
            ? { status: "ACCEPTED", receipt: terminal }
            : { status: "STOPPED" },
        );
      }
      touch();
    }
  };
  const accept = async (
    intent: Captured,
    receipt: AcceptedTranslationReceipt,
    repeat = false,
  ) => {
    intent.receipt = receipt;
    // This callback's first synchronous phase owns the captured local receipt,
    // even if its original Activity is hidden. Its read phase must be guarded.
    await deliver(
      intent,
      () =>
        intent.handlers.onAccepted(receipt, {
          synchronize:
            active &&
            latest.actorId === intent.metadata.actorId &&
            latest.canSubmit,
        }),
      repeat,
    );
  };
  const stop = async (
    intent: Captured,
    receipt: Extract<TranslationReceiptResult, { status: "STOPPED" }>,
  ) => {
    await deliver(intent, () => intent.handlers.onStopped?.(receipt));
  };
  const known = async (
    intent: Captured,
  ): Promise<TranslationSubmitResult | undefined> => {
    const terminal = client.terminal(intent.metadata);
    if (terminal?.status === "ACCEPTED") {
      await accept(intent, terminal);
      return { status: "ACCEPTED", receipt: terminal };
    }
    if (terminal?.status === "STOPPED") {
      await stop(intent, terminal);
      return { status: "STOPPED" };
    }
  };
  const canReadAuthority = (intent: Captured) =>
    active &&
    owns(intent) &&
    latest.actorId === intent.metadata.actorId &&
    !!latest.refreshAuthority;
  const recheck = async (intent: Captured) => {
    if (intent.rechecking) {
      await intent.rechecking;
      return;
    }
    if (!canReadAuthority(intent)) return;
    const denialVersion = intent.denialVersion;
    const checking = Promise.resolve().then(async () => {
      if (!canReadAuthority(intent) || denialVersion !== intent.denialVersion)
        return;
      try {
        // Fresh returned data is the proof; never wait for a cached observer's
        // render or use its timestamp to infer authority after a known denial.
        const proof = parseTranslationAuthorityProof(
          await latest.refreshAuthority!(),
        );
        if (!canReadAuthority(intent) || denialVersion !== intent.denialVersion)
          return;
        if (
          proof.actorId !== intent.metadata.actorId ||
          proof.mode !== intent.metadata.mode ||
          !proof.canSubmit
        )
          throw new Error("Original translation authority is unavailable.");
        // account.me intentionally permits suspension and omits that field. Own
        // receipt GET supplies the existing live-session/lifecycle restriction,
        // without reading suspension appeals or protected destination content.
        // Bypass QueryClient deduplication: staleTime:0 can still join a receipt
        // request started before the denial instead of proving current access.
        const response = await latest.readReceipt({
          actorId: intent.metadata.actorId,
          intentId: intent.metadata.id,
        });
        if (!canReadAuthority(intent)) return;
        const result = client.resolve(intent.metadata, response);
        // A later refusal invalidates this read's retry proof. Historical
        // terminal evidence still settles locally; old absence grants nothing.
        const currentProof = denialVersion === intent.denialVersion;
        if (currentProof) intent.needsAuthority = false;
        if (result.status === "NOT_RECORDED")
          client.error(intent.metadata, currentProof ? null : "authority");
        else await client.deliver(intent.metadata);
      } catch {
        if (owns(intent) && !client.terminal(intent.metadata)) {
          intent.needsAuthority = true;
          client.error(intent.metadata, "authority");
        }
      }
    });
    intent.rechecking = checking;
    touch();
    try {
      await checking;
    } finally {
      intent.rechecking = undefined;
      touch();
    }
  };
  const denyAuthority = (intent: Captured) => {
    if (client.terminal(intent.metadata)) return;
    intent.denialVersion++;
    intent.needsAuthority = true;
    client.error(intent.metadata, "authority");
    if (canReadAuthority(intent)) void recheck(intent);
  };
  const transport = async (
    intent: Captured,
  ): Promise<TranslationSubmitResult> => {
    intent.running = true;
    touch();
    try {
      let response: Awaited<ReturnType<Captured["send"]>>;
      try {
        response = await intent.send();
      } catch (error) {
        if (
          isTranslationAuthorityError(error) &&
          !client.terminal(intent.metadata)
        ) {
          intent.denialVersion++;
          intent.needsAuthority = true;
          client.unknown(intent.metadata, "authority");
          if (canReadAuthority(intent)) void recheck(intent);
        } else client.unknown(intent.metadata);
        return (await known(intent)) ?? { status: "UNKNOWN" };
      }
      let result;
      try {
        result = client.resolve(intent.metadata, response.receipt);
      } catch {
        client.unknown(intent.metadata);
        return (await known(intent)) ?? { status: "UNKNOWN" };
      }
      if (result.status === "ACCEPTED") {
        await accept(intent, result);
        return { status: "ACCEPTED", receipt: result };
      }
      if (result.status === "STOPPED") await stop(intent, result);
      return { status: result.status === "STOPPED" ? "STOPPED" : "UNKNOWN" };
    } finally {
      intent.running = false;
      touch();
    }
  };
  const send = (intent: Captured) =>
    Promise.race([transport(intent), intent.terminal]);
  const register = (intent: Captured) => {
    detach?.();
    const owner: TranslationIntentOwner = {
      canRetry: () => mayRetry(intent),
      retry: async () => {
        const entry = client
          .getSnapshot()
          .entries.find(
            (item) =>
              item.metadata.id === intent.metadata.id &&
              item.metadata.actorId === intent.metadata.actorId,
          );
        if (mayRetry(intent) && entry?.status === "UNKNOWN") await send(intent);
      },
      canRefresh: () =>
        active &&
        owns(intent) &&
        latest.actorId === intent.metadata.actorId &&
        latest.canSubmit &&
        !intent.running &&
        !intent.delivery,
      accept: async (receipt) => {
        await accept(intent, receipt);
      },
      stop: async (receipt) => {
        await stop(intent, receipt);
      },
      refresh: async () => {
        if (intent.receipt) await accept(intent, intent.receipt, true);
      },
      needsAuthority: () => intent.needsAuthority,
      canRecheck: () =>
        intent.needsAuthority && canReadAuthority(intent) && !intent.rechecking,
      recheck: async () => {
        await recheck(intent);
      },
      denyAuthority: () => denyAuthority(intent),
    };
    detach = client.register(intent.metadata, owner);
  };
  async function submit<Operation extends TranslationOperation>(
    operation: Operation,
    business: TranslationBusiness<Operation>,
    sendRaw: TranslationRawSender<Operation>,
    handlers: TranslationIntentHandlers,
  ): Promise<TranslationSubmitResult> {
    const authority = latest;
    if (!active || !authority.actorId || !authority.canSubmit)
      return { status: "BLOCKED" };
    let parsed: TranslationBusiness<Operation>;
    try {
      parsed = translationBusinessInputs[operation].parse(
        business,
      ) as TranslationBusiness<Operation>;
    } catch {
      return { status: "BLOCKED" };
    }
    const previous = captured;
    const current = client.getSnapshot();
    const previousEntry =
      previous &&
      current.entries.find(
        (entry) =>
          entry.metadata.id === previous.metadata.id &&
          entry.metadata.actorId === previous.metadata.actorId,
      );
    if (
      previous?.running ||
      previous?.delivery ||
      (previousEntry &&
        !isTranslationIntentUnresolved(previousEntry) &&
        !previous.delivered) ||
      current.entries.some(
        (entry) =>
          entry.metadata.actorId === authority.actorId &&
          isTranslationIntentUnresolved(entry),
      )
    )
      return { status: "BLOCKED" };
    let metadata: TranslationIntentMetadata;
    try {
      metadata = client.admit({
        id: crypto.randomUUID(),
        actorId: authority.actorId,
        operation,
        mode: authority.mode,
      });
      error = null;
      publish();
    } catch {
      error = "storage";
      publish();
      return { status: "BLOCKED" };
    }
    const envelope = Object.freeze({
      version: 1 as const,
      id: metadata.id,
      actorId: metadata.actorId,
      mode: metadata.mode,
    });
    const input = Object.freeze({ ...parsed, intent: envelope });
    let settleTerminal!: (result: TranslationSubmitResult) => void;
    const terminal = new Promise<TranslationSubmitResult>((resolve) => {
      settleTerminal = resolve;
    });
    const intent: Captured = {
      metadata,
      send: () => sendRaw(input),
      handlers: Object.freeze({ ...handlers }),
      running: false,
      delivered: false,
      terminal,
      settleTerminal,
      needsAuthority: false,
      denialVersion: 0,
    };
    captured = intent;
    register(intent);
    return send(intent);
  }
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => view,
    commit(authority: OwnerAuthority) {
      const changed =
        latest.actorId !== authority.actorId ||
        latest.mode !== authority.mode ||
        latest.canSubmit !== authority.canSubmit;
      latest = authority;
      // Null/denied identity retains original ownership. Only a committed new
      // verified actor severs private callbacks; abandoned renders cannot do so.
      if (authority.actorId && authority.actorId !== verifiedActor) {
        verifiedActor = authority.actorId;
        captured = null;
        detach?.();
        detach = null;
      }
      if (changed) touch();
    },
    activate() {
      active = true;
      if (captured && owns(captured)) {
        register(captured);
        const intent = captured;
        const entry = client
          .getSnapshot()
          .entries.find(
            (item) =>
              item.metadata.id === intent.metadata.id &&
              item.metadata.actorId === intent.metadata.actorId,
          );
        // Reactivation reconciles historical terminal delivery, never POST.
        if (entry?.receipt?.status === "ACCEPTED" && !intent.delivered)
          void accept(intent, entry.receipt);
        if (entry?.receipt?.status === "STOPPED" && !intent.delivered)
          void stop(intent, entry.receipt);
      }
      touch();
      return () => {
        active = false;
        detach?.();
        detach = null;
        touch();
      };
    },
    submit,
    retryAccepted: async () => {
      const intent = captured;
      if (
        intent?.receipt &&
        active &&
        latest.actorId === intent.metadata.actorId &&
        latest.canSubmit &&
        !intent.running
      )
        await accept(intent, intent.receipt, true);
    },
  };
}

/** Sender must be raw mutateAsync, with no post-acceptance onSuccess callback.
 * onAccepted marks original local state before separately gated protected reads.
 * UNKNOWN keeps feature leases until onAccepted/onStopped, not network finally. */
export function useTranslationIntent({
  actorId,
  mode,
  canSubmit,
  refreshAuthority,
  client = translationIntentClient,
}: {
  actorId?: string | null;
  mode: TranslationIntentMode;
  canSubmit: boolean;
  refreshAuthority?: () => Promise<TranslationAuthorityProof>;
  /** Isolated store injection for maintained tests, never a transport option. */
  client?: TranslationIntentClient;
}) {
  const snapshot = useTranslationIntentRegistry(client);
  const utils = api.useUtils();
  const [binding, setBinding] = useState(() => ({
    client,
    controller: createTranslationIntentOwner(client),
  }));
  if (binding.client !== client)
    setBinding({ client, controller: createTranslationIntentOwner(client) });
  const controller = binding.controller;
  const owner = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  // Publish live authority only on commit. The controller retains event-time
  // synchronous admission while render reads immutable subscribed snapshots.
  useLayoutEffect(() => {
    controller.commit({
      actorId,
      mode,
      canSubmit,
      refreshAuthority,
      readReceipt: (input) => utils.client.translationIntent.get.query(input),
    });
  });
  useLayoutEffect(() => controller.activate(), [controller, actorId]);

  const recoveryActor = actorId ?? owner.actorId;
  const recovery = snapshot.entries.filter(
    (entry) => entry.metadata.actorId === recoveryActor,
  );
  const ownsView = owner.actorId === recoveryActor;
  const pending = ownsView && owner.pending;
  const ownedTerminal =
    ownsView && owner.intentId
      ? recovery.find(
          (entry) =>
            entry.metadata.id === owner.intentId &&
            !isTranslationIntentUnresolved(entry),
        )
      : undefined;
  const blocked =
    !actorId ||
    !canSubmit ||
    !snapshot.ready ||
    snapshot.storageError ||
    pending ||
    recovery.some(isTranslationIntentUnresolved) ||
    !!(ownedTerminal && !owner.delivered);
  return {
    submit: controller.submit,
    blocked,
    pending,
    recovery,
    error: owner.error,
    retryAccepted: controller.retryAccepted,
  };
}
