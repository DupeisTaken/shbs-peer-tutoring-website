"use client";

import { useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import type {
  AdmissionRecoveryPlan,
  AdmissionRecoveryResult,
} from "~/lib/recovery";
import { api } from "~/trpc/react";
import { recoveryEvidenceMessage } from "~/lib/recovery-evidence";
import { Button } from "./ui/button";
import { Modal, useDialogPending } from "./ui/modal";
import { QueryFeedback } from "./ui/query-feedback";
import { SummaryTable, TableAction, TableActions } from "./ui/summary-table";
import { useSessionAccessDenied } from "./session-view-state";

function RecoveryConfirmation({
  pending,
  coordinator,
  onClose,
  onApply,
}: {
  pending: boolean;
  coordinator: boolean;
  onClose: () => void;
  onApply: () => void;
}) {
  const t = useTranslations("recovery");
  const busy = useDialogPending(pending);
  return (
    <Modal
      title={t("confirmTitle")}
      description={t("confirmHelp")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant="danger" disabled={busy} onClick={onApply}>
            {t(
              pending
                ? "applying"
                : coordinator
                  ? "requestApproval"
                  : "confirm",
            )}
          </Button>
        </>
      }
    >
      <p>{t("preserved")}</p>
    </Modal>
  );
}

function RecoveryPlan({
  plan,
  coordinator,
  canInspectRecords,
  onApplied,
  actorId,
}: {
  plan: AdmissionRecoveryPlan;
  coordinator: boolean;
  canInspectRecords: boolean;
  onApplied: (result: AdmissionRecoveryResult) => void;
  actorId?: string;
}) {
  const t = useTranslations("recovery");
  const format = useFormatter();
  const evidenceText = (message: string) => {
    const evidence = recoveryEvidenceMessage(message);
    return evidence ? t(`evidence.${evidence.key}`, evidence.values) : message;
  };
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [failed, setFailed] = useState(false);
  const [queued, setQueued] = useState<string>();
  const [completed, setCompleted] = useState(false);
  const [copy, setCopy] = useState<"ready" | "copied" | "command" | "failed">(
    "ready",
  );
  const clientKey = useRef<string | null>(null);
  const apply = api.recovery.voidAdmission.useMutation();
  // Single quotes are portable for this deliberately narrow identifier alphabet.
  // Unexpected stored identifiers remain data in the copied JSON reference.
  const quoteIdentifier = (value: string | undefined, placeholder: string) =>
    value && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? `'${value}'` : placeholder;
  const inspectCommand = `npm run recovery -- admission inspect --action-id ${quoteIdentifier(plan.actionId, "ACTION_ID")} --actor-id ${quoteIdentifier(actorId, "ADMIN_ID")} --out PLAN.json`;
  const copyCommandSafe =
    /^[A-Za-z0-9_-]{1,200}$/.test(plan.actionId) &&
    !!actorId &&
    /^[A-Za-z0-9_-]{1,200}$/.test(actorId);
  const eligible =
    plan.websiteEligible &&
    plan.coverage === "COMPLETE" &&
    plan.blockers.length === 0 &&
    Number.isInteger(plan.dependentEventCount) &&
    plan.dependentEventCount >= 0 &&
    plan.dependentEventCount <= 1 &&
    !plan.alreadyVoided &&
    !queued &&
    !completed;
  const applyPlan = async () => {
    setFailed(false);
    // A transport failure keeps this key. Editing the reason or receiving a new
    // fingerprint mounts a new intent, preventing accidental duplicate compensation.
    clientKey.current ??= crypto.randomUUID();
    try {
      const result = await apply.mutateAsync({
        actionId: plan.actionId,
        expectedFingerprint: plan.fingerprint,
        clientKey: clientKey.current,
        reason: reason.trim(),
      });
      setCompleted(true);
      setConfirm(false);
      onApplied(result);
    } catch (error) {
      const approval =
        error &&
        typeof error === "object" &&
        "data" in error &&
        error.data &&
        typeof error.data === "object" &&
        "approvalId" in error.data
          ? error.data.approvalId
          : undefined;
      if (typeof approval === "string") {
        setQueued(approval);
        setConfirm(false);
      } else {
        setFailed(true);
        setConfirm(false);
      }
    }
  };
  return (
    <div className="card space-y-5 p-4 sm:p-5">
      <div>
        <h2 className="section-title">{t("preview")}</h2>
        <p className="mt-1 font-mono text-xs [overflow-wrap:anywhere]">
          {plan.actionId}
        </p>
        <p className="muted mt-1">
          {t("application", { id: plan.applicationId })}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="font-medium">{t("coverage")}</p>
          <p>
            {t(
              plan.coverage === "COMPLETE"
                ? "coverageComplete"
                : "coverageUnknown",
            )}
          </p>
        </div>
        <div>
          <p className="font-medium">{t("dependentEvents")}</p>
          <p>{plan.dependentEventCount}</p>
        </div>
        <div>
          <p className="font-medium">{t("eligibility")}</p>
          <p>
            {t(
              plan.alreadyVoided || completed
                ? "alreadyVoided"
                : eligible
                  ? "websiteEligible"
                  : plan.dependentEventCount >= 2
                    ? "cliRequired"
                    : "blocked",
            )}
          </p>
        </div>
      </div>
      <div>
        <h3 className="font-medium">{t("effects")}</h3>
        <dl className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <dt>{t("registrationCodes")}</dt>
            <dd>{plan.effects.registrationCodeCount}</dd>
          </div>
          <div>
            <dt>{t("tutor")}</dt>
            <dd className="font-mono text-xs [overflow-wrap:anywhere]">
              {plan.effects.tutorId ?? t("none")}
            </dd>
          </div>
          {(["accountIds", "pairingIds", "tuteeIds"] as const).map((field) => (
            <div key={field}>
              <dt>{t(field)}</dt>
              <dd className="font-mono text-xs [overflow-wrap:anywhere]">
                {plan.effects[field].length
                  ? plan.effects[field].join(", ")
                  : t("none")}
              </dd>
            </div>
          ))}
          <div>
            <dt>{t("verificationClocks")}</dt>
            <dd>
              <span>{plan.effects.verificationClockIds?.length ?? 0}</span>
              {!!plan.effects.verificationClockIds?.length && (
                <span className="mt-1 block font-mono text-xs [overflow-wrap:anywhere]">
                  {plan.effects.verificationClockIds.join(", ")}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("messageLinks")}</dt>
            <dd>
              <span>{plan.effects.messageLinkIds?.length ?? 0}</span>
              {!!plan.effects.messageLinkIds?.length && (
                <span className="mt-1 block font-mono text-xs [overflow-wrap:anywhere]">
                  {plan.effects.messageLinkIds.join(", ")}
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>
      <div className="rounded bg-slate-50 p-3">
        <h3 className="font-medium">{t("preservedTitle")}</h3>
        <p className="mt-1">{t("preserved")}</p>
        <p className="mt-2">{t("messageLinksHelp")}</p>
        {plan.warnings.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {plan.warnings.map((warning) => (
              <li key={warning}>{evidenceText(warning)}</li>
            ))}
          </ul>
        )}
      </div>
      {plan.blockers.length > 0 && (
        <div className="rounded bg-amber-50 p-3 text-amber-900">
          <h3 className="font-medium">{t("blockers")}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {plan.blockers.map((blocker) => (
              <li key={blocker}>{evidenceText(blocker)}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.events.length > 0 && (
        <SummaryTable label={t("events")}>
          <thead>
            <tr>
              <th>{t("event")}</th>
              <th>{t("when")}</th>
            </tr>
          </thead>
          <tbody>
            {plan.events.map((event) => (
              <tr key={event.id}>
                <td>
                  <span className="block font-mono text-xs [overflow-wrap:anywhere]">
                    {event.id}
                  </span>
                  <span>
                    {event.kind === "ADMISSION"
                      ? t("eventAdmission")
                      : event.kind === "REGISTRATION"
                        ? t("eventRegistration")
                        : event.kind === "INVITATION"
                          ? t("eventInvitation")
                          : event.kind === "ASSIGNMENT"
                            ? t("eventAssignment")
                            : t("eventOther", { kind: event.kind })}
                  </span>
                </td>
                <td>
                  {format.dateTime(new Date(event.createdAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </SummaryTable>
      )}
      {!eligible && !plan.alreadyVoided && !queued && !completed && (
        <div className="space-y-2">
          <h3 className="font-medium">{t("operatorTitle")}</h3>
          <p>{t("operatorHelp")}</p>
          <pre className="overflow-x-auto rounded bg-slate-50 p-3 text-xs">
            {inspectCommand}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button
              size="compact"
              onClick={() => {
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(
                      JSON.stringify({ actionId: plan.actionId }),
                    );
                    setCopy("copied");
                  } catch {
                    setCopy("failed");
                  }
                })();
              }}
            >
              {t("copyReference")}
            </Button>
            <Button
              size="compact"
              disabled={!copyCommandSafe}
              onClick={() => {
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(inspectCommand);
                    setCopy("command");
                  } catch {
                    setCopy("failed");
                  }
                })();
              }}
            >
              {t("copyCommand")}
            </Button>
          </div>
          {copy !== "ready" && (
            <p role="status">
              {t(
                copy === "copied"
                  ? "copied"
                  : copy === "command"
                    ? "commandCopied"
                    : "copyFailed",
              )}
            </p>
          )}
          {canInspectRecords && (
            <p>
              <Link className="link" href="/admin/database">
                {t("database")}
              </Link>
            </p>
          )}
        </div>
      )}
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
      {eligible && (
        <div className="space-y-2">
          <label className="block font-medium" htmlFor="recovery-reason">
            {t("reason")}
          </label>
          <textarea
            id="recovery-reason"
            className="input min-h-24 w-full"
            value={reason}
            disabled={apply.isPending}
            maxLength={2000}
            aria-describedby="recovery-reason-help"
            onChange={(event) => {
              setReason(event.target.value);
              clientKey.current = null;
              setFailed(false);
            }}
          />
          <p id="recovery-reason-help" className="muted">
            {t("reasonHelp")}
          </p>
          <Button
            variant="danger"
            disabled={reason.trim().length < 5 || apply.isPending}
            onClick={() => setConfirm(true)}
          >
            {t(coordinator ? "reviewRequest" : "reviewApply")}
          </Button>
        </div>
      )}
      {failed && (
        <p role="alert" className="text-red-700">
          {t("applyFailed")}
        </p>
      )}
      {confirm && eligible && (
        <RecoveryConfirmation
          pending={apply.isPending}
          coordinator={coordinator}
          onClose={() => {
            if (!apply.isPending) setConfirm(false);
          }}
          onApply={() => {
            void applyPlan();
          }}
        />
      )}
    </div>
  );
}

export function AdmissionRecovery({
  initialAction = "",
  initialReceipt = "",
  canInspectRecords = false,
  coordinator = false,
  actorId,
}: {
  initialAction?: string;
  initialReceipt?: string;
  canInspectRecords?: boolean;
  coordinator?: boolean;
  actorId?: string;
}) {
  const t = useTranslations("recovery");
  const format = useFormatter();
  const [actionId, setActionId] = useState(initialAction);
  const [lookup, setLookup] = useState(initialAction);
  const [receiptId, setReceiptId] = useState(initialReceipt);
  const [cursors, setCursors] = useState<string[]>([]);
  const list = api.recovery.list.useQuery(
    { cursor: cursors.at(-1) },
    { retry: false },
  );
  const inspect = api.recovery.inspect.useQuery(
    { actionId },
    { enabled: !!actionId, retry: false },
  );
  const receipt = api.recovery.receipt.useQuery(
    { id: receiptId },
    { enabled: !!receiptId, retry: false },
  );
  const denied = useSessionAccessDenied(
    list,
    ...(actionId ? [inspect] : []),
    ...(receiptId ? [receipt] : []),
  );
  const roots = !denied && !list.isError ? list.data : undefined;
  const plan = !denied && !inspect.isError ? inspect.data : undefined;
  const savedReceipt = !denied && !receipt.isError ? receipt.data : undefined;
  const feedback = {
    loadingTitle: t("loading"),
    errorTitle: t("loadFailed"),
    retryLabel: t("retry"),
  };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("title")}</h1>
        <p className="muted mt-1">{t("intro")}</p>
      </div>
      {denied && (
        <p role="alert" className="text-red-700">
          {t("denied")}
        </p>
      )}
      {receiptId && (
        <div className="card space-y-3 p-4 sm:p-5">
          <h2 className="section-title">{t("receipt")}</h2>
          {/* The committed write's locator survives a read/refresh failure. It
              does not disclose receipt details or override a revoked identity. */}
          {!denied && (
            <Link
              className="link"
              href={`/admin/recovery?receipt=${encodeURIComponent(receiptId)}`}
            >
              {t("receiptLink")}
            </Link>
          )}
          <QueryFeedback
            {...feedback}
            hasData={!!savedReceipt}
            loading={receipt.isLoading}
            error={receipt.isError}
            retrying={receipt.isFetching}
            onRetry={() => {
              void receipt.refetch();
            }}
          />
          {savedReceipt && (
            <>
              <p className="font-mono text-xs [overflow-wrap:anywhere]">
                {savedReceipt.id}
              </p>
              <p>{t("receiptHelp")}</p>
              <dl className="space-y-2">
                <div>
                  <dt>{t("reason")}</dt>
                  <dd>{savedReceipt.reason}</dd>
                </div>
                <div>
                  <dt>{t("actor")}</dt>
                  <dd className="font-mono text-xs">{savedReceipt.actorId}</dd>
                </div>
                <div>
                  <dt>{t("when")}</dt>
                  <dd>
                    {format.dateTime(new Date(savedReceipt.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </dd>
                </div>
              </dl>
              <p>
                <Link
                  className="link"
                  href={`/admin/recovery?action=${encodeURIComponent(savedReceipt.actionId)}`}
                >
                  {t("sourceAction")}
                </Link>
              </p>
            </>
          )}
        </div>
      )}
      <div className="card space-y-4 p-4 sm:p-5">
        {!denied && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              setActionId(lookup.trim());
            }}
          >
            <label className="block font-medium" htmlFor="recovery-action">
              {t("actionId")}
            </label>
            <input
              id="recovery-action"
              className="input w-full font-mono text-xs"
              value={lookup}
              maxLength={200}
              onChange={(event) => setLookup(event.target.value)}
            />
            <Button type="submit" size="compact" disabled={!lookup.trim()}>
              {t("inspect")}
            </Button>
          </form>
        )}
        <QueryFeedback
          {...feedback}
          hasData={!!roots}
          loading={list.isLoading}
          error={list.isError}
          retrying={list.isFetching}
          onRetry={() => {
            void list.refetch();
          }}
        />
        {roots && (
          <>
            <SummaryTable label={t("roots")}>
              <thead>
                <tr>
                  <th>{t("source")}</th>
                  <th>{t("when")}</th>
                  <th className="table-actions-heading">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {roots.items.map((root) => (
                  <tr key={root.id}>
                    <td>
                      <span className="block font-mono text-xs [overflow-wrap:anywhere]">
                        {root.id}
                      </span>
                      <span className="font-mono text-xs [overflow-wrap:anywhere]">
                        {root.applicationId}
                      </span>
                    </td>
                    <td>
                      {format.dateTime(new Date(root.createdAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                    <TableActions>
                      <TableAction
                        onClick={() => {
                          setActionId(root.id);
                          setLookup(root.id);
                        }}
                      >
                        {t("inspect")}
                      </TableAction>
                    </TableActions>
                  </tr>
                ))}
                {!roots.items.length && (
                  <tr>
                    <td colSpan={3}>{t("empty")}</td>
                  </tr>
                )}
              </tbody>
            </SummaryTable>
            <div className="flex flex-wrap gap-2">
              <Button
                size="compact"
                disabled={!cursors.length || list.isFetching}
                onClick={() => setCursors((value) => value.slice(0, -1))}
              >
                {t("previous")}
              </Button>
              <Button
                size="compact"
                disabled={!roots.nextCursor || list.isFetching}
                onClick={() => {
                  if (roots.nextCursor)
                    setCursors((value) => [...value, roots.nextCursor!]);
                }}
              >
                {t("next")}
              </Button>
              <Button
                size="compact"
                disabled={list.isFetching || inspect.isFetching}
                onClick={() => {
                  void list.refetch();
                  if (actionId) void inspect.refetch();
                }}
              >
                {t("refresh")}
              </Button>
            </div>
          </>
        )}
      </div>
      {actionId && (
        <QueryFeedback
          {...feedback}
          hasData={!!plan}
          loading={inspect.isLoading}
          error={inspect.isError}
          retrying={inspect.isFetching}
          onRetry={() => {
            void inspect.refetch();
          }}
        />
      )}
      {plan && (
        <RecoveryPlan
          key={`${plan.actionId}:${plan.fingerprint}`}
          plan={plan}
          coordinator={coordinator}
          canInspectRecords={canInspectRecords}
          actorId={actorId}
          onApplied={(result) => {
            setReceiptId(result.receiptId);
            void inspect.refetch();
            void list.refetch();
          }}
        />
      )}
    </div>
  );
}
