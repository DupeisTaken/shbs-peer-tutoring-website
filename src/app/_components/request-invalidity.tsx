"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { queuedApprovalId } from "~/lib/approval-outcome";
import { FieldRequirement } from "./field-requirement";
import { Button, ChoiceButton } from "./ui/button";
import { Modal, useDialogPending } from "./ui/modal";
import { FilterToolbar, FormSection, InlineNotice } from "./ui/patterns";

export type InvalidityRecord = {
  id: string;
  isInvalid: boolean;
  invalidReason: string | null;
  invalidatedAt: Date | null;
  invalidatedByName: string | null;
  invalidityVersion: number;
};
export type InvalidityInput = {
  id: string;
  invalid: boolean;
  reason: string;
  expectedInvalidityVersion: number;
};
export type InvalidityFilterValue = "all" | "valid" | "invalid";

export function InvalidityBadge() {
  const t = useTranslations("requestInvalidity");
  return <span className="badge-red">{t("badge")}</span>;
}

export function InvalidityNotice() {
  const t = useTranslations("requestInvalidity");
  return <InlineNotice tone="warning">{t("processingPaused")}</InlineNotice>;
}

/** Validity is an independent filter; original workflow states remain visible. */
export function InvalidityFilter({
  value,
  onChange,
}: {
  value: InvalidityFilterValue;
  onChange: (value: InvalidityFilterValue) => void;
}) {
  const t = useTranslations("requestInvalidity");
  return (
    <FilterToolbar label={t("filterLabel")}>
      {(["all", "valid", "invalid"] as const).map((choice) => (
        <ChoiceButton
          key={choice}
          selected={value === choice}
          onClick={() => onChange(choice)}
        >
          {t(`filter.${choice}`)}
        </ChoiceButton>
      ))}
    </FilterToolbar>
  );
}

/** Feature-owned review shared by the two public signup queues. Callers own the
 * authorized mutation and exact-row refresh; no private reader mounts for viewers. */
export function RequestInvalidity({
  record,
  name,
  canFlag,
  coordinator = false,
  onCommit,
  onRefresh,
}: {
  record: InvalidityRecord;
  name: string;
  canFlag: boolean;
  coordinator?: boolean;
  onCommit: (input: InvalidityInput) => Promise<unknown>;
  onRefresh: () => Promise<InvalidityRecord>;
}) {
  const t = useTranslations("requestInvalidity");
  const common = useTranslations("common");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{
    record: InvalidityRecord;
    reason: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [reloading, setReloading] = useState(false);
  const busy = useDialogPending(pending);
  const admitted = useRef(false);
  const [accepted, setAccepted] = useState(false);
  const [approvalId, setApprovalId] = useState<string>();
  const [error, setError] = useState<string>();
  const [refreshError, setRefreshError] = useState<string>();
  const snapshot = draft?.record ?? record;
  const clearing = snapshot.isInvalid;
  const locked = busy || reloading || accepted;

  const refresh = async (reload: boolean) => {
    if (admitted.current) return;
    admitted.current = true;
    if (reload) setReloading(true);
    else setPending(true);
    setRefreshError(undefined);
    try {
      const fresh = await onRefresh();
      // Only an explicit successful Reload may replace a retained draft/version.
      if (reload) {
        setDraft({ record: fresh, reason: "" });
        setError(undefined);
        setAccepted(false);
        setApprovalId(undefined);
      }
    } catch (failure) {
      setRefreshError(failure instanceof Error ? failure.message : t("failed"));
    } finally {
      admitted.current = false;
      setPending(false);
      setReloading(false);
    }
  };
  const submit = async () => {
    const reason = draft?.reason.trim();
    if (!canFlag || locked || admitted.current || !draft || !reason) return;
    admitted.current = true;
    setPending(true);
    setError(undefined);
    try {
      await onCommit({
        id: record.id,
        invalid: !clearing,
        reason,
        expectedInvalidityVersion: draft.record.invalidityVersion,
      });
    } catch (failure) {
      const queued = queuedApprovalId(failure);
      if (queued) {
        setAccepted(true);
        setApprovalId(queued);
      } else {
        setError(failure instanceof Error ? failure.message : t("failed"));
      }
      admitted.current = false;
      setPending(false);
      return;
    }
    // Once committed, recovery may only read. It must never replay the write.
    setAccepted(true);
    admitted.current = false;
    await refresh(false);
  };
  const close = () => {
    if (busy || (admitted.current && !reloading)) return;
    setOpen(false);
    if (accepted && !refreshError && !approvalId) {
      setDraft(null);
      setAccepted(false);
    }
  };
  const result = accepted ? (
    <InlineNotice
      tone={refreshError ? "warning" : "success"}
      announcement="status"
      action={
        refreshError ? (
          <Button disabled={busy} onClick={() => void refresh(false)}>
            {t("retryRefresh")}
          </Button>
        ) : approvalId ? (
          <Button
            disabled={busy || reloading}
            onClick={() => void refresh(true)}
          >
            {t("reload")}
          </Button>
        ) : undefined
      }
    >
      <p>
        {t(approvalId ? "queued" : refreshError ? "refreshFailed" : "saved")}
      </p>
      {refreshError && <p className="mt-1 break-words">{refreshError}</p>}
      {approvalId && (
        <Link
          className="link inline-flex min-h-11 items-center lg:min-h-8"
          href={`/admin/approvals?request=${encodeURIComponent(approvalId)}`}
        >
          {t("viewProposal")}
        </Link>
      )}
    </InlineNotice>
  ) : null;

  if (!canFlag) return null;
  return (
    <>
      <Button
        size="compact"
        disabled={busy}
        onClick={() => {
          if (
            !draft ||
            (accepted &&
              !refreshError &&
              snapshot.invalidityVersion !== record.invalidityVersion)
          ) {
            setDraft({ record, reason: "" });
            setAccepted(false);
            setApprovalId(undefined);
          }
          setOpen(true);
        }}
      >
        {t(record.isInvalid ? "review" : "flag")}
      </Button>
      {!open && result}
      {open && (
        <Modal
          title={t(clearing ? "reviewTitle" : "flagTitle", { name })}
          description={t(clearing ? "clearHelp" : "flagHelp")}
          busy={pending}
          onClose={close}
          footer={
            <>
              <Button data-dialog-autofocus onClick={close}>
                {common(accepted ? "close" : "cancel")}
              </Button>
              {!accepted && (
                <Button
                  variant={clearing ? "primary" : "danger"}
                  disabled={!draft?.reason.trim() || locked}
                  onClick={() => void submit()}
                >
                  {t(
                    coordinator
                      ? clearing
                        ? "proposeClear"
                        : "proposeFlag"
                      : clearing
                        ? "clear"
                        : "flag",
                  )}
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-4">
            {clearing && (
              <InlineNotice tone="warning">
                <p className="font-medium">{t("badge")}</p>
                <p className="mt-2 break-words whitespace-pre-wrap">
                  {snapshot.invalidReason}
                </p>
                <p className="mt-2 text-xs">
                  {t("recorded", {
                    name: snapshot.invalidatedByName ?? t("unknownActor"),
                    when: format.dateTime(new Date(snapshot.invalidatedAt!), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })}
                </p>
              </InlineNotice>
            )}
            <FormSection
              title={t(clearing ? "clearReason" : "reason")}
              busy={busy || reloading}
              disabled={accepted}
            >
              <label className="block">
                <span className="label">
                  {t("reason")}
                  <FieldRequirement state="required" />
                </span>
                <textarea
                  className="input min-h-28 w-full resize-y"
                  required
                  maxLength={1000}
                  value={draft?.reason ?? ""}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, reason: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
              <p className="muted text-sm">
                {t(coordinator ? "coordinatorHelp" : "reasonHelp")}
              </p>
            </FormSection>
            {error && (
              <InlineNotice tone="error" announcement="alert">
                {error}
              </InlineNotice>
            )}
            {!accepted &&
              (!!error ||
                snapshot.invalidityVersion !== record.invalidityVersion) && (
                <InlineNotice
                  tone="warning"
                  action={
                    <Button
                      disabled={busy || reloading}
                      onClick={() => void refresh(true)}
                    >
                      {t("reload")}
                    </Button>
                  }
                >
                  {t("reloadHelp")}
                </InlineNotice>
              )}
            {!accepted && refreshError && (
              <InlineNotice tone="error" announcement="alert">
                {refreshError}
              </InlineNotice>
            )}
            {result}
          </div>
        </Modal>
      )}
    </>
  );
}
