"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "./button";
import { Modal } from "./modal";
import { InlineNotice } from "./patterns";

export type ReviewedAction = {
  key: string;
  title: string;
  description: string;
  confirmLabel: string;
  details?: ReactNode;
  /** The feature supplies an authorized mutation with its original payload. */
  commit: () => Promise<unknown>;
  /** Read-only recovery; never put another mutation in this callback. */
  refresh: () => Promise<unknown>;
  /** Only the feature may recognize an existing proposal instead of an error. */
  approvalId?: (error: unknown) => string | undefined;
  /** Features retain translated guidance for their own stable server error codes. */
  renderError?: (message: string) => ReactNode;
  /** Reversible membership changes may become meaningful again after a fresh read. */
  repeatAfterRefresh?: boolean;
};

/** Compose the existing modal around a named consequence. Features retain all
 * authorization, tickets and mutation payloads; stronger domain reviews stay separate. */
export function useActionReview() {
  const [action, setAction] = useState<ReviewedAction | null>(null);
  const [blockedKeys, setBlockedKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [generation, setGeneration] = useState(0);
  const generationNow = useRef(0);
  const pendingGenerations = useRef(new Set<number>());
  const blockedNow = useRef<ReadonlySet<string>>(new Set());
  const needsRefreshNow = useRef(false);
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const open = (next: ReviewedAction) => {
    if (
      !pendingGenerations.current.size &&
      !needsRefreshNow.current &&
      !blockedNow.current.has(next.key)
    ) {
      // A recovered reversible action can reuse its domain key. Each deliberate
      // opening needs a fresh dialog lifetime, including after inline recovery.
      generationNow.current += 1;
      setGeneration(generationNow.current);
      setAction(next);
    }
  };
  /** Explicit authoritative revocation conceals evidence, not an admitted server
   * write. Old generations may finish and block their accepted key, but cannot
   * restore evidence or change the state of a subsequently authorized review. */
  const revoke = useCallback(() => {
    generationNow.current += 1;
    setGeneration(generationNow.current);
    setAction(null);
    needsRefreshNow.current = false;
    setNeedsRefresh(false);
  }, []);
  return {
    open,
    revoke,
    busy,
    blocked: (key: string) => busy || needsRefresh || blockedKeys.has(key),
    dialog: action ? (
      <ActionReview
        key={`${generation}:${action.key}`}
        action={action}
        onClose={() => {
          if (generationNow.current === generation) setAction(null);
        }}
        onBusy={(pending) => {
          if (pending) pendingGenerations.current.add(generation);
          else pendingGenerations.current.delete(generation);
          setBusy(pendingGenerations.current.size > 0);
        }}
        onRecovery={(failed) => {
          if (generationNow.current !== generation) return;
          needsRefreshNow.current = failed;
          setNeedsRefresh(failed);
          if (!failed && action.repeatAfterRefresh) {
            const next = new Set(blockedNow.current);
            next.delete(action.key);
            blockedNow.current = next;
            setBlockedKeys(next);
          }
        }}
        onAccepted={() => {
          const next = new Set(blockedNow.current).add(action.key);
          blockedNow.current = next;
          setBlockedKeys(next);
        }}
      />
    ) : null,
  };
}

function ActionReview({
  action,
  onClose,
  onBusy,
  onAccepted,
  onRecovery,
}: {
  action: ReviewedAction;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
  onAccepted: () => void;
  onRecovery: (failed: boolean) => void;
}) {
  const t = useTranslations("actionReview");
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [approvalId, setApprovalId] = useState<string>();
  const [error, setError] = useState<string>();
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [closed, setClosed] = useState(false);
  const admitted = useRef(false);
  const pendingNow = useRef(false);
  const refreshInFlight = useRef(false);
  const pending = (value: boolean) => {
    pendingNow.current = value;
    setBusy(value);
    onBusy(value);
  };
  const refresh = async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    pending(true);
    setRefreshFailed(false);
    try {
      await action.refresh();
      onRecovery(false);
    } catch {
      setRefreshFailed(true);
      onRecovery(true);
    } finally {
      refreshInFlight.current = false;
      pending(false);
    }
  };
  const commit = async () => {
    // React disabled state arrives on the next render. This guard also excludes
    // two submissions in the same event turn and all replays after acceptance.
    if (admitted.current) return;
    admitted.current = true;
    pending(true);
    setError(undefined);
    try {
      await action.commit();
    } catch (failure) {
      const queued = action.approvalId?.(failure);
      if (queued) {
        setAccepted(true);
        setApprovalId(queued);
        onAccepted();
      } else {
        setError(failure instanceof Error ? failure.message : t("failed"));
        admitted.current = false;
      }
      pending(false);
      return;
    }
    setAccepted(true);
    onAccepted();
    await refresh();
  };
  const result = accepted ? (
    <InlineNotice
      tone={refreshFailed ? "warning" : "success"}
      announcement="status"
      action={
        refreshFailed ? (
          <Button disabled={busy} onClick={() => void refresh()}>
            {t("retry")}
          </Button>
        ) : undefined
      }
    >
      <p>
        {t(approvalId ? "queued" : refreshFailed ? "refreshFailed" : "applied")}
      </p>
      {approvalId && (
        <Link
          className="link inline-flex min-h-11 items-center lg:min-h-8"
          href={`/admin/approvals?request=${encodeURIComponent(approvalId)}`}
        >
          {t("viewRequest")}
        </Link>
      )}
    </InlineNotice>
  ) : null;
  // Closing a failed synchronization must leave its read-only recovery reachable.
  // The accepted key remains blocked for the lifetime of this page instance.
  const close = () => {
    if (pendingNow.current) return;
    if (accepted && refreshFailed) setClosed(true);
    else onClose();
  };
  if (closed) return result;
  return (
    <Modal
      title={action.title}
      description={action.description}
      busy={busy}
      onClose={() => {
        if (!busy) close();
      }}
      footer={
        <>
          <Button data-dialog-autofocus onClick={close}>
            {t(accepted ? "close" : "cancel")}
          </Button>
          {!accepted && (
            <Button variant="danger" onClick={() => void commit()}>
              {action.confirmLabel}
            </Button>
          )}
        </>
      }
    >
      {action.details}
      {error && (
        <InlineNotice tone="error" announcement="alert">
          {action.renderError ? action.renderError(error) : error}
        </InlineNotice>
      )}
      {result}
    </Modal>
  );
}
