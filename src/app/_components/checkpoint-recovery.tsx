"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { api } from "~/trpc/react";
import type {
  CheckpointAdapterId,
  CheckpointPlan,
} from "~/server/recovery/checkpoint-contract";
import { Button } from "./ui/button";
import { Modal, useDialogPending } from "./ui/modal";
import { QueryFeedback } from "./ui/query-feedback";
import { DisclosureSection } from "./ui/disclosure-section";
import { SummaryTable, TableAction, TableActions } from "./ui/summary-table";
import { useSessionAccessDenied } from "./session-view-state";
import { checkpointEvidenceText } from "~/lib/checkpoint-evidence";

const adapters: CheckpointAdapterId[] = [
  "PARTICIPANT_TUTOR",
  "PARTICIPANT_TUTEE",
  "STUDENT_WORKFLOW",
  "ATTENDANCE",
  "CARD",
  "PROGRAM_REFRESH",
];
type Role = "ADMIN" | "HEAD" | "COORDINATOR";
type RestoreIntent = {
  checkpointId: string;
  expectedFingerprint: string;
  clientKey: string;
  reason: string;
};

type CheckpointReviewMemory = {
  reviewed?: CheckpointPlan;
  reason?: string;
  attempt?: RestoreIntent | null;
  pending?: boolean;
  uncertain?: boolean;
  error?: boolean;
  receiptId?: string;
  approvalId?: string;
};
type RecoveryLedger = {
  generation: string;
  denied: boolean;
  denialRevision: number;
  deniedScopes: Record<string, string | null>;
  checkpoints: Record<string, CheckpointReviewMemory>;
};
// This disabled, client-only query survives route/selection remounts. The
// identity-keyed TRPC provider owns and clears its QueryClient on actor, role or
// authority-generation changes. Never put this intent/reason in browser storage.
const recoveryLedgerKey = [
  "checkpoint-recovery",
  "private-intent-ledger",
] as const;
const newReviewMemory = (reviewed: CheckpointPlan): CheckpointReviewMemory => ({
  reviewed,
  reason: "",
  attempt: null,
  pending: false,
  uncertain: false,
  error: false,
});

function recoveryErrorCode(error: unknown) {
  const data =
    error && typeof error === "object" && "data" in error ? error.data : null;
  return data && typeof data === "object" && "code" in data
    ? data.code
    : undefined;
}

/** The wording keeps already-observed and already-sent effects distinct from
 * pending cancellation. The original outcome remains visible in receipts. */
const deliveryDispositions = [
  "PENDING",
  "LEASED",
  "PRIOR_ATTEMPT_UNKNOWN",
  "IN_FLIGHT_OR_UNKNOWN",
  "SENT",
  "STOPPED",
  "IN_APP_VISIBLE",
  "OBSERVED_NOTICE",
  "UNKNOWN",
] as const;
export function RecoveryDeliveryConsequences({
  effects,
}: {
  effects: Array<{
    id: string;
    deliveryId: string | null;
    notificationId: string | null;
    disposition: string;
  }>;
}) {
  const t = useTranslations("checkpointRecovery");
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">{t("delivery")}</h3>
      <p className="muted">{t("notice")}</p>
      <ul className="space-y-1 text-sm">
        {effects.map((effect) => (
          <li key={effect.id} className="flex flex-wrap gap-x-2">
            <span>
              {t(
                `deliveryStates.${deliveryDispositions.includes(effect.disposition as (typeof deliveryDispositions)[number]) ? (effect.disposition as (typeof deliveryDispositions)[number]) : "UNKNOWN"}`,
              )}
            </span>
            <code className="text-xs [overflow-wrap:anywhere]">
              {effect.deliveryId ?? effect.notificationId ?? effect.id}
            </code>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RecoveryOwnerFollowUp({
  result,
}: {
  result: {
    outcome: "AWAITING_OWNER_ACTION";
    drafts: Array<{
      draftId: string;
      ownerUserId: string;
      version: number;
      state: string | null;
      destination: string | null;
    }>;
  } | null;
}) {
  const t = useTranslations("checkpointRecovery");
  if (!result) return null;
  const pending = result.drafts.some((draft) => draft.state !== "CONSUMED");
  return (
    <section
      className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4"
      aria-label={t("awaitingOwner")}
    >
      <h4 className="font-semibold">
        {t(pending ? "awaitingOwner" : "ownerActionRecorded")}
      </h4>
      <p className="text-sm">{t("ownerActionHelp")}</p>
      <ul className="space-y-3 text-sm">
        {result.drafts.map((draft) => (
          <li key={draft.draftId}>
            <p>
              {t(
                draft.state === "CONSUMED"
                  ? "consumed"
                  : draft.state === "PENDING_OWNER_REVIEW"
                    ? "pendingOwnerDraft"
                    : "stateUnknown",
              )}
            </p>
            <p className="text-xs [overflow-wrap:anywhere]">
              {t("ownerId")}: <code>{draft.ownerUserId}</code> ·{" "}
              <code>{draft.draftId}</code>
            </p>
            {draft.destination && (
              <Link
                className="link mt-1 inline-flex min-h-11 items-center"
                href={draft.destination}
              >
                {t("ownerFollowUp")}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CheckpointConfirmation({
  pending,
  requestOnly,
  onClose,
  onConfirm,
  source,
}: {
  pending: boolean;
  requestOnly: boolean;
  onClose: () => void;
  onConfirm: () => void;
  source: string;
}) {
  const t = useTranslations("checkpointRecovery");
  const busy = useDialogPending(pending);
  return (
    <Modal
      title={t("confirmTitle")}
      description={t("confirmHelp")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            {t(pending ? "pending" : requestOnly ? "request" : "confirm")}
          </Button>
        </>
      }
    >
      <p className="font-mono text-sm [overflow-wrap:anywhere]">{source}</p>
    </Modal>
  );
}

function CheckpointReview({
  incoming,
  denied,
  role,
  fetching,
  failedRead,
  pending,
  confirmedReceiptId,
  memory,
  onMemoryChange,
  onApply,
}: {
  incoming: CheckpointPlan;
  denied: boolean;
  role: Role;
  fetching: boolean;
  failedRead: boolean;
  pending: boolean;
  confirmedReceiptId: string | undefined;
  memory: CheckpointReviewMemory | undefined;
  onMemoryChange: (
    update: (current: CheckpointReviewMemory) => CheckpointReviewMemory,
  ) => CheckpointReviewMemory | undefined;
  onApply: (input: RestoreIntent) => Promise<{ receiptId: string }>;
}) {
  const t = useTranslations("checkpointRecovery");
  const locale = useLocale();
  const evidenceText = (message: string) =>
    checkpointEvidenceText(message, locale);
  const format = useFormatter();
  const reasonId = useId();
  const reviewed = memory?.reviewed ?? incoming;
  // Render typing synchronously; the cache still authorizes and retains every
  // accepted edit. Batched query notifications must not drop fast keystrokes.
  const [reason, setReason] = useState(memory?.reason ?? "");
  const error = memory?.error ?? false;
  const queued = memory?.approvalId;
  const accepted = !!memory?.receiptId;
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState<"copied" | "copyFailed">();
  const admitted = useRef(false);
  // A fresh receipt is authoritative even before adopting changed consequences.
  // It records this single-use checkpoint's result, including owner-review drafts.
  const completed =
    accepted ||
    !!confirmedReceiptId ||
    !!reviewed.receiptId ||
    (incoming.checkpointId === reviewed.checkpointId && !!incoming.receiptId);
  // Discard a submitted draft as soon as its terminal outcome renders, without
  // an effect-driven extra render or dependence on cache observer scheduling.
  if ((completed || queued) && reason !== "") setReason("");
  const changed = incoming.fingerprint !== reviewed.fingerprint;
  const headOnly =
    reviewed.directRoles.length === 1 && reviewed.directRoles[0] === "HEAD";
  const requestOnly = !reviewed.directRoles.includes(role as "ADMIN" | "HEAD");
  const requesterAllowed =
    !requestOnly ||
    (role === "ADMIN" && headOnly) ||
    (role === "COORDINATOR" && !headOnly);
  // Direct apply has a durable same-input receipt. Approval creation does not
  // have that replay guarantee after a proposal is decided, so uncertainty there
  // requires reconciliation rather than another submission.
  const exactRetry = !!memory?.uncertain && !!memory.attempt && !requestOnly;
  const eligible =
    reviewed.version === 1 &&
    reviewed.websiteEligible &&
    reviewed.coverage === "COMPLETE" &&
    !reviewed.blockers.length &&
    Number.isInteger(reviewed.dependentEventCount) &&
    reviewed.dependentEventCount >= 0 &&
    reviewed.dependentEventCount <= 1 &&
    !completed &&
    !queued &&
    !(memory?.uncertain && requestOnly) &&
    requesterAllowed;
  // CLI apply bypasses only the event-count bound. Unknown/blocked evidence is
  // never an invitation to repeat a committed action or bypass domain blockers.
  const unsupported =
    reviewed.version !== 1 ||
    reviewed.coverage !== "COMPLETE" ||
    reviewed.blockers.length > 0 ||
    !Number.isInteger(reviewed.dependentEventCount) ||
    reviewed.dependentEventCount < 0;
  const websiteState = completed
    ? "recorded"
    : queued
      ? "reviewPending"
      : unsupported
        ? "blockers"
        : reviewed.dependentEventCount > 1
          ? "cliOnly"
          : eligible
            ? "eligible"
            : "blockers";
  const blocked =
    denied ||
    (changed && !exactRetry) ||
    fetching ||
    failedRead ||
    pending ||
    !!memory?.pending;
  const apply = async () => {
    if (!eligible || blocked || admitted.current || reason.trim().length < 5)
      return;
    admitted.current = true;
    try {
      await onApply(
        memory?.attempt ?? {
          checkpointId: reviewed.checkpointId,
          expectedFingerprint: reviewed.fingerprint,
          clientKey: crypto.randomUUID(),
          reason: reason.trim(),
        },
      );
      setConfirming(false);
    } catch {
      // The identity-scoped ledger owns the outcome even if this child unmounts.
      setConfirming(false);
    } finally {
      admitted.current = false;
    }
  };
  // Keep the reason, accepted outcome and exact retry intent in memory while
  // authority is rechecked, but remove all private evidence from the DOM.
  if (denied) return null;
  return (
    <section className="card space-y-5 p-4 sm:p-5" aria-label={t("preview")}>
      <div>
        <h3 className="section-title">{t("preview")}</h3>
        <p className="mt-1 font-medium">{t(`domains.${reviewed.adapter}`)}</p>
        <p className="muted mt-1 font-mono text-xs [overflow-wrap:anywhere]">
          {reviewed.sourceEntity}: {reviewed.sourceId}
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="muted">{t("coverage")}</dt>
          <dd className="font-semibold">
            {t(reviewed.coverage === "COMPLETE" ? "complete" : "unknown")}
          </dd>
        </div>
        <div>
          <dt className="muted">{t("events")}</dt>
          <dd className="font-semibold">{reviewed.dependentEventCount}</dd>
        </div>
        <div>
          <dt className="muted">{t("website")}</dt>
          <dd className="font-semibold">{t(websiteState)}</dd>
        </div>
      </dl>
      {headOnly && <p>{t("headOnly")}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { label: "changes" as const, items: reviewed.effects },
          { label: "preserved" as const, items: reviewed.preserved },
        ].map(({ label, items }) => (
          <section
            key={label}
            className="rounded-lg border border-slate-200 p-4"
          >
            <h4 className="font-semibold">{t(label)}</h4>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
              {items.map((item, index) => (
                <li key={index}>{evidenceText(item)}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {reviewed.warnings.length > 0 && (
        <section>
          <h4 className="font-semibold">{t("warnings")}</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {reviewed.warnings.map((warning) => (
              <li key={warning}>{evidenceText(warning)}</li>
            ))}
          </ul>
        </section>
      )}
      {reviewed.blockers.length > 0 && (
        <section role="alert">
          <h4 className="font-semibold">{t("blockers")}</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {reviewed.blockers.map((blocker) => (
              <li key={blocker}>{evidenceText(blocker)}</li>
            ))}
          </ul>
        </section>
      )}
      {reviewed.delivery.effects.length > 0 && (
        <RecoveryDeliveryConsequences effects={reviewed.delivery.effects} />
      )}
      {changed && (
        <div role="status" className="space-y-2">
          <p>{t("changed")}</p>
          <Button
            disabled={fetching || failedRead || pending || !!memory?.uncertain}
            onClick={() => {
              onMemoryChange((current) =>
                current.pending || current.uncertain
                  ? current
                  : {
                      ...current,
                      reviewed: incoming,
                      attempt: null,
                      error: false,
                    },
              );
              setConfirming(false);
            }}
          >
            {t("adopt")}
          </Button>
        </div>
      )}
      <DisclosureSection title={t("details")} lifetime="lazy">
        <p className="font-mono text-xs [overflow-wrap:anywhere]">
          {reviewed.checkpointId}
        </p>
        <ol className="mt-3 space-y-2 text-xs">
          {reviewed.chronology.map((event) => (
            <li key={event.id} className="[overflow-wrap:anywhere]">
              {format.dateTime(new Date(event.createdAt), {
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              · {event.kind} · <code>{event.id}</code>
            </li>
          ))}
        </ol>
        <Button
          size="compact"
          className="mt-3"
          onClick={() => {
            void navigator.clipboard
              .writeText(
                JSON.stringify({
                  checkpointId: reviewed.checkpointId,
                  actionId: reviewed.actionId,
                }),
              )
              .then(
                () => setCopied("copied"),
                () => setCopied("copyFailed"),
              );
          }}
        >
          {t("copy")}
        </Button>
        {copied && <p role="status">{t(copied)}</p>}
      </DisclosureSection>
      {queued && !completed && (
        <p role="status">
          {t("queued")}{" "}
          <Link
            className="link"
            href={`/admin/approvals?request=${encodeURIComponent(queued)}`}
          >
            {t("viewApproval")}
          </Link>
        </p>
      )}
      {completed && <p role="status">{t("applied")}</p>}
      <div className="space-y-2">
        <label htmlFor={reasonId} className="block font-medium">
          {t("reason")}
        </label>
        <textarea
          id={reasonId}
          className="input min-h-24 w-full"
          value={reason}
          maxLength={2000}
          disabled={pending || completed || !!queued || !!memory?.uncertain}
          onChange={(event) => {
            const value = event.target.value;
            const saved = onMemoryChange((current) =>
              current.pending ||
              current.uncertain ||
              current.receiptId ||
              current.approvalId
                ? current
                : { ...current, reason: value, attempt: null, error: false },
            );
            if (saved) setReason(saved.reason ?? "");
          }}
        />
        <Button
          variant="danger"
          disabled={!eligible || blocked || reason.trim().length < 5}
          onClick={() => setConfirming(true)}
        >
          {t(requestOnly ? (headOnly ? "requestHead" : "request") : "review")}
        </Button>
      </div>
      {error && <p role="alert">{t("failed")}</p>}
      {memory?.uncertain && requestOnly && !completed && (
        <Link
          className="link inline-flex min-h-11 items-center"
          href="/admin/approvals"
        >
          {t("viewApproval")}
        </Link>
      )}
      {confirming && eligible && (!changed || exactRetry) && !failedRead && (
        <CheckpointConfirmation
          pending={pending}
          requestOnly={requestOnly}
          source={`${reviewed.sourceEntity}: ${reviewed.sourceId}`}
          onClose={() => {
            if (!pending) setConfirming(false);
          }}
          onConfirm={() => {
            void apply();
          }}
        />
      )}
    </section>
  );
}

export function CheckpointRecovery({
  role,
  initialCheckpoint = "",
  initialReceipt = "",
}: {
  role: Role;
  initialCheckpoint?: string;
  initialReceipt?: string;
}) {
  const t = useTranslations("checkpointRecovery");
  const format = useFormatter();
  const formId = useId();
  const queryClient = useQueryClient();
  const utils = api.useUtils();
  const ledger = useQuery<RecoveryLedger>({
    queryKey: recoveryLedgerKey,
    queryFn: skipToken,
    initialData: () => ({
      generation: crypto.randomUUID(),
      denied: false,
      denialRevision: 0,
      deniedScopes: {},
      checkpoints: {},
    }),
    staleTime: Infinity,
    gcTime: Infinity,
  }).data;
  // skipToken deliberately has no fetch fallback. If the identity cache cannot
  // provide its initialized ledger, fail closed rather than inventing a scope.
  if (!ledger) throw new Error("Recovery intent cache is unavailable.");
  const updateLedger = (
    update: (current: RecoveryLedger) => RecoveryLedger,
  ) => {
    const result = queryClient.setQueryData<RecoveryLedger>(
      recoveryLedgerKey,
      (current) =>
        current?.generation === ledger.generation ? update(current) : current,
    );
    return result?.generation === ledger.generation ? result : undefined;
  };
  const updateMemory = (
    id: string,
    plan: CheckpointPlan,
    update: (current: CheckpointReviewMemory) => CheckpointReviewMemory,
  ) => {
    const result = updateLedger((current) => ({
      ...current,
      checkpoints: {
        ...current.checkpoints,
        [id]: update(current.checkpoints[id] ?? newReviewMemory(plan)),
      },
    }));
    return result?.checkpoints[id];
  };
  const invalidateOutcome = (id: string, resultReceiptId?: string) => {
    if (
      queryClient.getQueryData<RecoveryLedger>(recoveryLedgerKey)
        ?.generation !== ledger.generation
    )
      return;
    void (async () => {
      await Promise.all([
        utils.recovery.checkpoints.invalidate(),
        utils.recovery.inspectCheckpoint.invalidate({ checkpointId: id }),
        ...(resultReceiptId
          ? [utils.recovery.receipt.invalidate({ id: resultReceiptId })]
          : []),
      ]);
    })().catch(() => {
      // A failed read cannot erase a committed receipt or release a queued intent.
    });
  };
  const [adapter, setAdapter] =
    useState<CheckpointAdapterId>("PARTICIPANT_TUTOR");
  const [sourceId, setSourceId] = useState("");
  const [captureAccepted, setCaptureAccepted] = useState(false);
  const [captureFailed, setCaptureFailed] = useState(false);
  const captureLock = useRef(false);
  const [checkpointId, setCheckpointId] = useState(initialCheckpoint);
  const [lookup, setLookup] = useState(initialCheckpoint);
  const [cursors, setCursors] = useState<string[]>([]);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const accessCheck = useRef(false);
  const list = api.recovery.checkpoints.useQuery(
    { cursor: cursors.at(-1) },
    { retry: false },
  );
  const inspect = api.recovery.inspectCheckpoint.useQuery(
    { checkpointId },
    { enabled: !!checkpointId, retry: false },
  );
  const selectedPlan =
    inspect.data?.checkpointId === checkpointId ? inspect.data : undefined;
  useEffect(() => {
    if (!selectedPlan || inspect.isError) return;
    queryClient.setQueryData<RecoveryLedger>(recoveryLedgerKey, (current) => {
      if (
        !current ||
        current.generation !== ledger.generation ||
        current.denied
      )
        return current;
      const existing = current.checkpoints[selectedPlan.checkpointId];
      // Persist the first displayed review even before a reason is typed. A
      // fresh receipt replaces any stale preview/queue and retains only its ID.
      if (selectedPlan.receiptId) {
        if (existing?.receiptId === selectedPlan.receiptId) return current;
        return {
          ...current,
          checkpoints: {
            ...current.checkpoints,
            [selectedPlan.checkpointId]: { receiptId: selectedPlan.receiptId },
          },
        };
      }
      if (existing) return current;
      return {
        ...current,
        checkpoints: {
          ...current.checkpoints,
          [selectedPlan.checkpointId]: newReviewMemory(selectedPlan),
        },
      };
    });
  }, [
    selectedPlan,
    inspect.isError,
    queryClient,
    ledger.generation,
    ledger.denied,
  ]);
  const receiptId =
    ledger.checkpoints[checkpointId]?.receiptId ??
    selectedPlan?.receiptId ??
    (checkpointId === initialCheckpoint ? initialReceipt : "");
  const receipt = api.recovery.receipt.useQuery(
    { id: receiptId },
    { enabled: !!receiptId, retry: false },
  );
  const confirmedReceiptId =
    receiptId &&
    receipt.isSuccess &&
    !receipt.isError &&
    receipt.data?.id === receiptId &&
    receipt.data.checkpoint?.id === checkpointId
      ? receiptId
      : undefined;
  const capture = api.recovery.captureCheckpoint.useMutation();
  const restore = api.recovery.restoreCheckpoint.useMutation();
  const readDenied = useSessionAccessDenied(
    list,
    ...(checkpointId ? [inspect] : []),
    ...(receiptId ? [receipt] : []),
  );
  useEffect(() => {
    if (!readDenied) return;
    queryClient.setQueryData<RecoveryLedger>(recoveryLedgerKey, (current) => {
      if (!current || current.generation !== ledger.generation) return current;
      if (
        current.denied &&
        Object.hasOwn(current.deniedScopes, checkpointId) &&
        current.deniedScopes[checkpointId] === (receiptId || null)
      )
        return current;
      return {
        ...current,
        denied: true,
        denialRevision: current.denialRevision + 1,
        deniedScopes: {
          ...current.deniedScopes,
          [checkpointId]: receiptId || null,
        },
      };
    });
  }, [readDenied, checkpointId, receiptId, queryClient, ledger.generation]);
  const denied = readDenied || ledger.denied;
  useLayoutEffect(() => {
    if (!confirmedReceiptId || denied) return;
    // A URL is not evidence. Only the successful exact receipt/checkpoint read
    // latches completion, synchronously before selection/navigation can remount.
    queryClient.setQueryData<RecoveryLedger>(recoveryLedgerKey, (current) => {
      if (
        !current ||
        current.generation !== ledger.generation ||
        current.denied ||
        current.checkpoints[checkpointId]?.receiptId === confirmedReceiptId
      )
        return current;
      return {
        ...current,
        checkpoints: {
          ...current.checkpoints,
          [checkpointId]: { receiptId: confirmedReceiptId },
        },
      };
    });
  }, [
    confirmedReceiptId,
    checkpointId,
    denied,
    queryClient,
    ledger.generation,
  ]);
  const recordMutationDenial = (error: unknown) => {
    const code = recoveryErrorCode(error);
    if (code !== "FORBIDDEN" && code !== "UNAUTHORIZED") return;
    updateLedger((current) => ({
      ...current,
      denied: true,
      denialRevision: current.denialRevision + 1,
      deniedScopes: {
        ...current.deniedScopes,
        [checkpointId]: receiptId || null,
      },
    }));
  };
  const retryAccess = async () => {
    if (accessCheck.current) return;
    accessCheck.current = true;
    setCheckingAccess(true);
    const current = queryClient.getQueryData<RecoveryLedger>(recoveryLedgerKey);
    const revision = current?.denialRevision;
    try {
      // Previously successful caches cannot release a mutation denial. Re-read
      // every visible private scope, including an accepted write's receipt.
      const results = await Promise.all([
        list.refetch(),
        ...(checkpointId ? [inspect.refetch()] : []),
        ...(receiptId ? [receipt.refetch()] : []),
        ...Object.entries(current?.deniedScopes ?? {}).flatMap(
          ([id, deniedReceipt]) => [
            ...(id && id !== checkpointId
              ? [
                  utils.recovery.inspectCheckpoint
                    .fetch({ checkpointId: id }, { staleTime: 0 })
                    .then(() => ({ isSuccess: true })),
                ]
              : []),
            ...(deniedReceipt && deniedReceipt !== receiptId
              ? [
                  utils.recovery.receipt
                    .fetch({ id: deniedReceipt }, { staleTime: 0 })
                    .then(() => ({ isSuccess: true })),
                ]
              : []),
          ],
        ),
      ]);
      if (results.every((result) => result.isSuccess))
        updateLedger((current) =>
          current.denialRevision === revision
            ? { ...current, denied: false, deniedScopes: {} }
            : current,
        );
    } catch {
      // Failed authority reads keep the private surface concealed.
    } finally {
      accessCheck.current = false;
      setCheckingAccess(false);
    }
  };
  const busy =
    capture.isPending ||
    restore.isPending ||
    Object.values(ledger.checkpoints).some((entry) => entry.pending);
  const feedback = {
    loadingTitle: t("loading"),
    errorTitle: t("loadFailed"),
    retryLabel: t("retry"),
  };
  return (
    <section
      className="min-w-0 space-y-5 border-t border-slate-200 pt-8"
      aria-labelledby={`${formId}-title`}
    >
      <div>
        <h2 id={`${formId}-title`} className="page-title">
          {t("title")}
        </h2>
        <p className="muted mt-2 max-w-3xl">{t("intro")}</p>
      </div>
      {denied ? (
        <div className="space-y-3">
          <p role="alert">{t("denied")}</p>
          <Button
            disabled={busy || checkingAccess}
            onClick={() => void retryAccess()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : (
        <>
          <form
            className="card space-y-4 p-4 sm:p-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                busy ||
                captureAccepted ||
                captureLock.current ||
                !sourceId.trim()
              )
                return;
              captureLock.current = true;
              setCaptureFailed(false);
              void capture
                .mutateAsync({ adapter, sourceId: sourceId.trim() })
                .then(
                  (saved) => {
                    setCaptureAccepted(true);
                    setCheckpointId(saved.checkpointId);
                    setLookup(saved.checkpointId);
                    void list.refetch();
                  },
                  (error) => {
                    recordMutationDenial(error);
                    setCaptureFailed(true);
                  },
                )
                .finally(() => {
                  captureLock.current = false;
                });
            }}
          >
            <h3 className="section-title">{t("captureTitle")}</h3>
            <fieldset
              disabled={busy || captureAccepted}
              className="grid gap-4 sm:grid-cols-2"
            >
              <div>
                <label
                  className="mb-1 block font-medium"
                  htmlFor={`${formId}-domain`}
                >
                  {t("domain")}
                </label>
                <select
                  id={`${formId}-domain`}
                  className="input w-full"
                  value={adapter}
                  onChange={(event) =>
                    setAdapter(event.target.value as CheckpointAdapterId)
                  }
                >
                  {adapters.map((value) => (
                    <option
                      key={value}
                      value={value}
                      disabled={
                        value === "PROGRAM_REFRESH" && role === "COORDINATOR"
                      }
                    >
                      {t(`domains.${value}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  className="mb-1 block font-medium"
                  htmlFor={`${formId}-source`}
                >
                  {t("source")}
                </label>
                <input
                  id={`${formId}-source`}
                  className="input w-full"
                  value={sourceId}
                  maxLength={200}
                  aria-describedby={`${formId}-help`}
                  onChange={(event) => setSourceId(event.target.value)}
                />
              </div>
            </fieldset>
            <p id={`${formId}-help`} className="muted">
              {t("sourceHelp")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={busy || captureAccepted || !sourceId.trim()}
              >
                {t(capture.isPending ? "pending" : "capture")}
              </Button>
              {captureAccepted && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setCaptureAccepted(false);
                    setCaptureFailed(false);
                  }}
                >
                  {t("captureAgain")}
                </Button>
              )}
            </div>
            {captureAccepted && <p role="status">{t("captured")}</p>}
            {captureFailed && <p role="alert">{t("captureFailed")}</p>}
          </form>
          <section className="card space-y-4 p-4 sm:p-5">
            <h3 className="section-title">{t("saved")}</h3>
            <QueryFeedback
              {...feedback}
              hasData={!!list.data}
              loading={list.isLoading}
              error={list.isError}
              retrying={list.isFetching}
              onRetry={() => {
                void list.refetch();
              }}
            />
            {list.data && (
              <>
                <SummaryTable label={t("saved")}>
                  <thead>
                    <tr>
                      <th>{t("domain")}</th>
                      <th>{t("source")}</th>
                      <th>{t("capturedAt")}</th>
                      <th>{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {adapters.includes(
                            item.adapter as CheckpointAdapterId,
                          )
                            ? t(
                                `domains.${item.adapter as CheckpointAdapterId}`,
                              )
                            : item.adapter}
                        </td>
                        <td className="font-mono text-xs [overflow-wrap:anywhere]">
                          {item.sourceEntity}: {item.sourceId}
                        </td>
                        <td>
                          {format.dateTime(new Date(item.createdAt), {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </td>
                        <TableActions>
                          <TableAction
                            disabled={busy}
                            onClick={() => {
                              setCheckpointId(item.id);
                              setLookup(item.id);
                            }}
                          >
                            {t("compare")}
                          </TableAction>
                        </TableActions>
                      </tr>
                    ))}
                  </tbody>
                </SummaryTable>
                {!list.data.items.length && <p>{t("empty")}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="compact"
                    disabled={busy || !cursors.length}
                    onClick={() => setCursors((values) => values.slice(0, -1))}
                  >
                    {t("previous")}
                  </Button>
                  <Button
                    size="compact"
                    disabled={busy || !list.data.nextCursor}
                    onClick={() => {
                      const nextCursor = list.data?.nextCursor;
                      if (nextCursor)
                        setCursors((values) => [...values, nextCursor]);
                    }}
                  >
                    {t("next")}
                  </Button>
                </div>
              </>
            )}
          </section>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && lookup.trim()) {
                if (lookup.trim() === checkpointId) void inspect.refetch();
                else setCheckpointId(lookup.trim());
              }
            }}
          >
            <div className="min-w-0 flex-1">
              <label
                className="mb-1 block font-medium"
                htmlFor={`${formId}-lookup`}
              >
                {t("lookup")}
              </label>
              <input
                id={`${formId}-lookup`}
                className="input w-full"
                value={lookup}
                maxLength={200}
                disabled={busy}
                onChange={(event) => setLookup(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy || !lookup.trim()}>
              {t("inspect")}
            </Button>
          </form>
          {checkpointId && (
            <QueryFeedback
              {...feedback}
              hasData={!!inspect.data}
              loading={inspect.isLoading}
              error={inspect.isError}
              retrying={inspect.isFetching}
              onRetry={() => {
                void inspect.refetch();
              }}
            />
          )}
        </>
      )}
      {selectedPlan && (
        <CheckpointReview
          key={checkpointId}
          incoming={selectedPlan}
          denied={denied}
          role={role}
          fetching={inspect.isFetching}
          failedRead={inspect.isError}
          pending={busy}
          confirmedReceiptId={confirmedReceiptId}
          memory={ledger.checkpoints[checkpointId]}
          onMemoryChange={(update) =>
            updateMemory(checkpointId, selectedPlan, update)
          }
          onApply={async (input) => {
            const currentLedger =
              queryClient.getQueryData<RecoveryLedger>(recoveryLedgerKey);
            const prior = currentLedger?.checkpoints[input.checkpointId];
            // Recheck the synchronous cache, not a child's possibly stale render.
            // Generation checks also discard late completions after identity reset.
            if (
              currentLedger?.generation !== ledger.generation ||
              currentLedger.denied ||
              denied
            )
              throw new Error("Recovery authority must be rechecked.");
            if (confirmedReceiptId && input.checkpointId === checkpointId) {
              updateMemory(input.checkpointId, selectedPlan, () => ({
                receiptId: confirmedReceiptId,
              }));
              return { receiptId: confirmedReceiptId };
            }
            if (prior?.receiptId) return { receiptId: prior.receiptId };
            if (prior?.approvalId || prior?.pending)
              throw new Error(
                "This checkpoint already has a submitted intent.",
              );
            if (
              prior?.uncertain &&
              JSON.stringify(prior.attempt) !== JSON.stringify(input)
            )
              throw new Error(
                "The exact uncertain recovery intent must be retained.",
              );
            const plan = prior?.reviewed ?? selectedPlan;
            updateMemory(input.checkpointId, plan, (entry) => ({
              ...entry,
              attempt: input,
              pending: true,
              error: false,
            }));
            try {
              const result = await restore.mutateAsync(input);
              updateMemory(input.checkpointId, plan, (entry) =>
                entry.receiptId ? entry : { receiptId: result.receiptId },
              );
              invalidateOutcome(input.checkpointId, result.receiptId);
              return result;
            } catch (error) {
              recordMutationDenial(error);
              const data =
                error && typeof error === "object" && "data" in error
                  ? error.data
                  : null;
              const approvalId =
                data && typeof data === "object" && "approvalId" in data
                  ? data.approvalId
                  : null;
              const code = recoveryErrorCode(error);
              updateMemory(input.checkpointId, plan, (entry) =>
                entry.receiptId || entry.approvalId
                  ? entry
                  : typeof approvalId === "string"
                    ? { approvalId }
                    : {
                        ...entry,
                        pending: false,
                        error: true,
                        uncertain: ![
                          "BAD_REQUEST",
                          "FORBIDDEN",
                          "UNAUTHORIZED",
                          "CONFLICT",
                          "PRECONDITION_FAILED",
                        ].includes(typeof code === "string" ? code : ""),
                      },
              );
              if (typeof approvalId === "string")
                invalidateOutcome(input.checkpointId);
              // Fetch new evidence after a stale preview without adopting it or
              // changing the reason/retry key. Adoption remains explicit below.
              if (code === "CONFLICT") invalidateOutcome(input.checkpointId);
              throw error;
            }
          }}
        />
      )}
      {!denied && receiptId && (
        <section
          className="card space-y-3 p-4 sm:p-5"
          aria-label={t("receipt")}
        >
          <h3 className="section-title">{t("receipt")}</h3>
          <p className="muted">{t("receiptHelp")}</p>
          <Link
            className="link font-mono text-xs [overflow-wrap:anywhere]"
            href={`/admin/recovery?checkpoint=${encodeURIComponent(checkpointId)}&receipt=${encodeURIComponent(receiptId)}`}
          >
            {receiptId}
          </Link>
          <QueryFeedback
            {...feedback}
            hasData={!!receipt.data}
            loading={receipt.isLoading}
            error={receipt.isError}
            retrying={receipt.isFetching}
            onRetry={() => {
              void receipt.refetch();
            }}
          />
          {!receipt.isError && receipt.data && (
            <>
              <p>{receipt.data.reason}</p>
              <p>
                {format.dateTime(new Date(receipt.data.createdAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
              <RecoveryOwnerFollowUp result={receipt.data.result} />
              {receipt.data.deliveries && (
                <RecoveryDeliveryConsequences
                  effects={receipt.data.deliveries.effects}
                />
              )}
              <DisclosureSection title={t("details")} lifetime="lazy">
                <p className="text-xs">{t("fingerprint")}</p>
                <code className="text-xs [overflow-wrap:anywhere]">
                  {receipt.data.fingerprint}
                </code>
                <pre className="mt-2 text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
                  {JSON.stringify(
                    {
                      version: receipt.data.version,
                      actionId: receipt.data.actionId,
                      actorId: receipt.data.actorId,
                      channel: receipt.data.channel,
                      checkpoint: receipt.data.checkpoint,
                      effects: receipt.data.effects,
                      preserved: receipt.data.preserved,
                    },
                    null,
                    2,
                  )}
                </pre>
              </DisclosureSection>
            </>
          )}
        </section>
      )}
    </section>
  );
}
