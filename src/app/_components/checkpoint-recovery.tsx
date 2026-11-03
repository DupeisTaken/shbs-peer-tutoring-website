"use client";

import { useId, useRef, useState } from "react";
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
  onApply,
  onApplied,
}: {
  incoming: CheckpointPlan;
  denied: boolean;
  role: Role;
  fetching: boolean;
  failedRead: boolean;
  pending: boolean;
  onApply: (input: RestoreIntent) => Promise<{ receiptId: string }>;
  onApplied: (receiptId: string) => void;
}) {
  const t = useTranslations("checkpointRecovery");
  const locale = useLocale();
  const evidenceText = (message: string) =>
    checkpointEvidenceText(message, locale);
  const format = useFormatter();
  const reasonId = useId();
  const [reviewed, setReviewed] = useState(incoming);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);
  const [queued, setQueued] = useState<string>();
  const [accepted, setAccepted] = useState(false);
  const [copied, setCopied] = useState<"copied" | "copyFailed">();
  const intent = useRef<string | null>(null);
  const admitted = useRef(false);
  const changed = incoming.fingerprint !== reviewed.fingerprint;
  const headOnly =
    reviewed.directRoles.length === 1 && reviewed.directRoles[0] === "HEAD";
  const requestOnly = !reviewed.directRoles.includes(role as "ADMIN" | "HEAD");
  const requesterAllowed =
    !requestOnly ||
    (role === "ADMIN" && headOnly) ||
    (role === "COORDINATOR" && !headOnly);
  const eligible =
    reviewed.version === 1 &&
    reviewed.websiteEligible &&
    reviewed.coverage === "COMPLETE" &&
    !reviewed.blockers.length &&
    Number.isInteger(reviewed.dependentEventCount) &&
    reviewed.dependentEventCount >= 0 &&
    reviewed.dependentEventCount <= 1 &&
    !reviewed.receiptId &&
    !accepted &&
    !queued &&
    requesterAllowed;
  const blocked = denied || changed || fetching || failedRead || pending;
  const apply = async () => {
    if (!eligible || blocked || admitted.current || reason.trim().length < 5)
      return;
    admitted.current = true;
    intent.current ??= crypto.randomUUID();
    setError(false);
    try {
      const result = await onApply({
        checkpointId: reviewed.checkpointId,
        expectedFingerprint: reviewed.fingerprint,
        clientKey: intent.current,
        reason: reason.trim(),
      });
      setAccepted(true);
      setConfirming(false);
      onApplied(result.receiptId);
    } catch (failure) {
      const data =
        failure && typeof failure === "object" && "data" in failure
          ? failure.data
          : null;
      const approvalId =
        data && typeof data === "object" && "approvalId" in data
          ? data.approvalId
          : undefined;
      if (typeof approvalId === "string") setQueued(approvalId);
      else setError(true);
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
          <dd className="font-semibold">
            {t(eligible ? "eligible" : "cliOnly")}
          </dd>
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
            disabled={fetching || failedRead || pending}
            onClick={() => {
              setReviewed(incoming);
              intent.current = null;
              setConfirming(false);
              setError(false);
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
      {queued && (
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
      {(accepted || reviewed.receiptId) && <p role="status">{t("applied")}</p>}
      <div className="space-y-2">
        <label htmlFor={reasonId} className="block font-medium">
          {t("reason")}
        </label>
        <textarea
          id={reasonId}
          className="input min-h-24 w-full"
          value={reason}
          maxLength={2000}
          disabled={pending || accepted || !!queued || !!reviewed.receiptId}
          onChange={(event) => {
            setReason(event.target.value);
            intent.current = null;
            setError(false);
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
      {confirming && eligible && !changed && !failedRead && (
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
  const [adapter, setAdapter] =
    useState<CheckpointAdapterId>("PARTICIPANT_TUTOR");
  const [sourceId, setSourceId] = useState("");
  const [captureAccepted, setCaptureAccepted] = useState(false);
  const [captureFailed, setCaptureFailed] = useState(false);
  const captureLock = useRef(false);
  const [checkpointId, setCheckpointId] = useState(initialCheckpoint);
  const [lookup, setLookup] = useState(initialCheckpoint);
  const [receiptId, setReceiptId] = useState(initialReceipt);
  const [cursors, setCursors] = useState<string[]>([]);
  const [mutationDenied, setMutationDenied] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const denialRevision = useRef(0);
  const accessCheck = useRef(false);
  const list = api.recovery.checkpoints.useQuery(
    { cursor: cursors.at(-1) },
    { retry: false },
  );
  const inspect = api.recovery.inspectCheckpoint.useQuery(
    { checkpointId },
    { enabled: !!checkpointId, retry: false },
  );
  const receipt = api.recovery.receipt.useQuery(
    { id: receiptId },
    { enabled: !!receiptId, retry: false },
  );
  const capture = api.recovery.captureCheckpoint.useMutation();
  const restore = api.recovery.restoreCheckpoint.useMutation();
  const readDenied = useSessionAccessDenied(
    list,
    ...(checkpointId ? [inspect] : []),
    ...(receiptId ? [receipt] : []),
  );
  const denied = readDenied || mutationDenied;
  const recordMutationDenial = (error: unknown) => {
    const code = recoveryErrorCode(error);
    if (code !== "FORBIDDEN" && code !== "UNAUTHORIZED") return;
    denialRevision.current++;
    setMutationDenied(true);
  };
  const retryAccess = async () => {
    if (accessCheck.current) return;
    accessCheck.current = true;
    setCheckingAccess(true);
    const revision = denialRevision.current;
    try {
      // Previously successful caches cannot release a mutation denial. Re-read
      // every visible private scope, including an accepted write's receipt.
      const results = await Promise.all([
        list.refetch(),
        ...(checkpointId ? [inspect.refetch()] : []),
        ...(receiptId ? [receipt.refetch()] : []),
      ]);
      if (
        revision === denialRevision.current &&
        results.every((result) => result.isSuccess)
      )
        setMutationDenied(false);
    } catch {
      // Failed authority reads keep the private surface concealed.
    } finally {
      accessCheck.current = false;
      setCheckingAccess(false);
    }
  };
  const busy = capture.isPending || restore.isPending;
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
      {inspect.data && (
        <CheckpointReview
          key={checkpointId}
          incoming={inspect.data}
          denied={denied}
          role={role}
          fetching={inspect.isFetching}
          failedRead={inspect.isError}
          pending={restore.isPending}
          onApply={async (input) => {
            try {
              return await restore.mutateAsync(input);
            } catch (error) {
              recordMutationDenial(error);
              // Fetch new evidence after a stale preview without adopting it or
              // changing the reason/retry key. Adoption remains explicit below.
              if (recoveryErrorCode(error) === "CONFLICT")
                void inspect.refetch();
              throw error;
            }
          }}
          onApplied={setReceiptId}
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
