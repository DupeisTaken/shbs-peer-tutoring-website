"use client";

import Link from "next/link";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFormatter, useTranslations } from "next-intl";
import { queuedApprovalId } from "~/lib/approval-outcome";
import { FieldRequirement } from "./field-requirement";
import { useReadOnly } from "./read-only";
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
      {(["valid", "invalid", "all"] as const).map((choice) => (
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

type ReviewProps = {
  record: InvalidityRecord;
  name: string;
  canFlag: boolean;
  coordinator?: boolean;
  /** Domain-qualified identity keeps a legacy signup distinct from a survey/application. */
  reviewKey?: string;
  onCommit: (input: InvalidityInput) => Promise<unknown>;
  onRefresh: () => Promise<InvalidityRecord>;
};
type ReviewSession = { props: ReviewProps; open: boolean; launch: number };
const ReviewHost = createContext<((props: ReviewProps) => void) | null>(null);

/** A review belongs to the queue, not to a filtered card. Once opened, its owner
 * stays mounted through polling, filter/group changes and partial refresh failures.
 * Closed drafts remain local to their exact request; recovery stays reachable even
 * when that request no longer belongs to the displayed queue. */
export function RequestInvalidityHost({ children }: { children: ReactNode }) {
  const readOnly = useReadOnly();
  const [sessions, setSessions] = useState<ReadonlyMap<string, ReviewSession>>(
    () => new Map(),
  );
  return (
    <ReviewHost.Provider
      value={(props) => {
        if (readOnly || !props.canFlag) return;
        const key = props.reviewKey ?? props.record.id;
        setSessions((current) => {
          const next = new Map(current);
          next.set(key, {
            props,
            open: true,
            launch: (current.get(key)?.launch ?? 0) + 1,
          });
          return next;
        });
      }}
    >
      {children}
      {!readOnly &&
        [...sessions].map(([key, session]) => (
          <RequestInvalidityReview
            key={key}
            {...session.props}
            open={session.open}
            launch={session.launch}
            onClose={() =>
              setSessions((current) => {
                const previous = current.get(key);
                if (!previous) return current;
                const next = new Map(current);
                next.set(key, { ...previous, open: false });
                return next;
              })
            }
          />
        ))}
    </ReviewHost.Provider>
  );
}

/** Cards only open reviews. The host captures the authorized operation callbacks
 * with that request, so unmounting the trigger cannot discard admitted work. */
export function RequestInvalidity(props: ReviewProps) {
  const t = useTranslations("requestInvalidity");
  const openReview = useContext(ReviewHost);
  const readOnly = useReadOnly();
  if (readOnly || !props.canFlag) return null;
  // Standalone domain readers retain the same lifetime boundary without requiring
  // a caller to build a host; filtered queues must place their host above the list.
  if (!openReview)
    return (
      <RequestInvalidityHost>
        <RequestInvalidity {...props} />
      </RequestInvalidityHost>
    );
  return (
    <Button size="compact" onClick={() => openReview(props)}>
      {t(props.record.isInvalid ? "review" : "flag")}
    </Button>
  );
}

function RequestInvalidityReview({
  record,
  name,
  coordinator = false,
  onCommit,
  onRefresh,
  open,
  launch,
  onClose,
}: ReviewProps & {
  open: boolean;
  launch: number;
  onClose: () => void;
}) {
  const t = useTranslations("requestInvalidity");
  const common = useTranslations("common");
  const format = useFormatter();
  const [draft, setDraft] = useState<{
    record: InvalidityRecord;
    reason: string;
  } | null>(() => ({ record, reason: "" }));
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
  const [lastLaunch, setLastLaunch] = useState(launch);
  // Deliberate reopening may adopt a completed review's newer record. Background
  // card changes never replace a draft or its expected version.
  if (lastLaunch !== launch) {
    setLastLaunch(launch);
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
  }

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
    if (locked || admitted.current || !draft || !reason) return;
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
    onClose();
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

  return (
    <>
      {!open && result && (
        <section className="card mt-4 space-y-3 p-4" aria-label={name}>
          <p className="font-medium">{name}</p>
          {result}
        </section>
      )}
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
