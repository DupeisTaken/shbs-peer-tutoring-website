"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { api, type RouterOutputs } from "~/trpc/react";
import { minToHm } from "~/lib/time";
import {
  SESSION_FLAG_FILTERS,
  type SessionFlagFilter,
} from "~/lib/session-flag-state";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { useReadOnly } from "./read-only";
import { Button, ChoiceButton } from "./ui/button";
import { Modal } from "./ui/modal";
import { FilterToolbar, InlineNotice, StatePanel } from "./ui/patterns";
import { TableDetails } from "./ui/summary-table";
import { participantNameLabel } from "./participant-name";

type Flag = RouterOutputs["admin"]["sessionFlags"][number];
type Decision = "DISMISS" | "WARN" | "PENALIZE" | "ESCALATE";
const actions: {
  action: Decision;
  key: "dismiss" | "warn" | "penalize" | "escalate";
}[] = [
  { action: "DISMISS", key: "dismiss" },
  { action: "WARN", key: "warn" },
  { action: "PENALIZE", key: "penalize" },
  { action: "ESCALATE", key: "escalate" },
];

/** Filters change reads only. Drafts and accepted locks live above filtered rows;
 * hiding a record cannot discard its decision or replay an accepted operation. */
export function SessionFlagBoard() {
  const format = useFormatter();
  const t = useTranslations("admin.sessionFlags");
  const common = useTranslations("common");
  const names = useTranslations("participantNames");
  // Resolved decision context stays recorded; only the live pending identity needs a label fallback.
  const tutorLabel = (flag: Flag) =>
    flag.state === "PENDING"
      ? participantNameLabel(flag.tutor, undefined, names("unnamed"))
      : flag.tutor;
  const ui = useTranslations("uiPatterns");
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const [accessDenied, setAccessDenied] = useState(false);
  const [filter, setFilter] = useState<SessionFlagFilter>("PENDING");
  const flags = api.admin.sessionFlags.useQuery(
    { state: filter },
    { enabled: !accessDenied },
  );
  const [note, setNote] = useState<Record<string, string>>({});
  const [hours, setHours] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{
    flag: Flag;
    action: Decision;
  } | null>(null);
  const [accepted, setAccepted] = useState<Record<string, string | true>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const admission = useRef(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await invalidateAndReport(utils.admin.sessionFlags);
      setRefreshFailed(false);
      setEditing(null);
    } catch {
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
      admission.current = false;
    }
  };
  const decide = api.admin.decideSessionFlag.useMutation({
    onSuccess: async (_result, input) => {
      setAccepted((current) => ({ ...current, [input.flagId]: true }));
      await refresh();
    },
    onError: (error, input) => {
      admission.current = false;
      const approvalId = error.data?.approvalId;
      if (approvalId)
        setAccepted((current) => ({ ...current, [input.flagId]: approvalId }));
    },
  });
  const pending = decide.isPending || refreshing;
  const authorizationDenied =
    flags.error?.data?.code === "FORBIDDEN" ||
    flags.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    if (authorizationDenied) {
      setAccessDenied(true);
      queryClient.removeQueries({
        queryKey: getQueryKey(api.admin.sessionFlags),
        exact: false,
      });
    } else if (flags.isSuccess && !flags.isFetching) setAccessDenied(false);
  }, [authorizationDenied, flags.isSuccess, flags.isFetching, queryClient]);
  const denied = authorizationDenied || accessDenied;
  const list = denied ? [] : (flags.data ?? []);
  const submit = () => {
    if (
      editing?.flag.state !== "PENDING" ||
      accepted[editing.flag.id] ||
      readOnly ||
      pending ||
      flags.error ||
      admission.current
    )
      return;
    const { flag, action } = editing;
    const parsed = Number(hours[flag.id] ?? "0.5");
    // Preserve the existing default for empty, zero and nonnumeric penalty input.
    const penalty = Number.isFinite(parsed) && parsed > 0 ? parsed : 0.5;
    const noteText = (note[flag.id] ?? "").trim();
    admission.current = true;
    decide.mutate({
      flagId: flag.id,
      action,
      note: noteText ? noteText : undefined,
      penaltyHours: action === "PENALIZE" ? penalty : undefined,
    });
  };
  const actionKey = editing
    ? actions.find((entry) => entry.action === editing.action)!.key
    : "dismiss";
  const editId = editing?.flag.id ?? "";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("title")}</h1>
        <p className="muted mt-1">{t("help")}</p>
      </div>
      <FilterToolbar label={t("filterLabel")}>
        <div className="flex flex-wrap gap-2">
          {SESSION_FLAG_FILTERS.map((value) => (
            <ChoiceButton
              key={value}
              selected={filter === value}
              onClick={() => setFilter(value)}
            >
              {t(`states.${value}`)}
            </ChoiceButton>
          ))}
        </div>
      </FilterToolbar>
      {!flags.data && !flags.error && (
        <StatePanel kind="loading" title={common("loading")} />
      )}
      {(!!flags.error || denied) && (
        <StatePanel
          kind={denied ? "denied" : "error"}
          title={flags.error?.message ?? ui("loadFailed")}
          action={
            <Button
              size="compact"
              disabled={pending}
              onClick={() => void flags.refetch()}
            >
              {ui("retry")}
            </Button>
          }
        />
      )}
      {refreshFailed && (
        <InlineNotice
          tone="warning"
          announcement="alert"
          action={
            <Button disabled={pending} onClick={() => void refresh()}>
              {ui("retry")}
            </Button>
          }
        >
          {t("refreshFailed")}
        </InlineNotice>
      )}
      <div className="space-y-3">
        {list.map((flag) => (
          <section key={flag.id} className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  <span>
                    {tutorLabel(flag)} · {flag.subject}
                  </span>
                  <span
                    className={
                      flag.state === "PENDING" ? "badge-red" : "badge-slate"
                    }
                  >
                    {t(`states.${flag.state}`)}
                  </span>
                </p>
                <p className="muted mt-1 text-xs">
                  {t("context", {
                    room: flag.room ?? "—",
                    date: format.dateTime(new Date(flag.date), {
                      dateStyle: "medium",
                      timeZone: "UTC",
                    }),
                    start: minToHm(flag.startMin),
                    end: minToHm(flag.endMin),
                  })}
                </p>
                <p className="mt-1 text-sm">
                  {t("discrepancy", {
                    observed: flag.observed,
                    expected: flag.expected,
                  })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <TableDetails title={`${tutorLabel(flag)} · ${flag.subject}`}>
                  <p>
                    {t("discrepancy", {
                      observed: flag.observed,
                      expected: flag.expected,
                    })}
                  </p>
                  <p>{t(`states.${flag.state}`)}</p>
                  {flag.decisionNote && (
                    <p className="whitespace-pre-wrap">{flag.decisionNote}</p>
                  )}
                  {flag.resolvedAt && (
                    <p>
                      {t("resolved", {
                        name: flag.resolvedByName ?? "—",
                        date: format.dateTime(new Date(flag.resolvedAt), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }),
                      })}
                    </p>
                  )}
                </TableDetails>
                {!readOnly &&
                  flag.state === "PENDING" &&
                  actions.map(({ action, key }) => (
                    <Button
                      key={action}
                      size="compact"
                      variant={action === "DISMISS" ? "secondary" : "danger"}
                      disabled={pending || !!flags.error || !!accepted[flag.id]}
                      aria-haspopup="dialog"
                      onClick={() => {
                        decide.reset();
                        setEditing({ flag, action });
                      }}
                    >
                      {t(key)}
                    </Button>
                  ))}
              </div>
            </div>
          </section>
        ))}
      </div>
      {flags.data && !flags.error && !denied && list.length === 0 && (
        <p className="muted">{t("empty")}</p>
      )}
      {!readOnly && !denied && editing && (
        <Modal
          title={`${t(actionKey)} · ${tutorLabel(editing.flag)}`}
          busy={pending}
          onClose={() => {
            if (!pending) setEditing(null);
          }}
          footer={
            <>
              <Button onClick={() => setEditing(null)} disabled={pending}>
                {common("close")}
              </Button>
              {!accepted[editing.flag.id] && (
                <Button
                  variant={
                    editing.action === "DISMISS" ? "secondary" : "danger"
                  }
                  disabled={pending || !!flags.error}
                  onClick={submit}
                >
                  {t(actionKey)}
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-4">
            <p>
              {editing.flag.subject} ·{" "}
              {t("discrepancy", {
                observed: editing.flag.observed,
                expected: editing.flag.expected,
              })}
            </p>
            <fieldset
              disabled={pending || !!flags.error || !!accepted[editing.flag.id]}
              className="space-y-3"
            >
              <label className="block">
                <span className="label">{t("notePlaceholder")}</span>
                <textarea
                  className="input min-h-24 w-full"
                  maxLength={500}
                  value={note[editId] ?? ""}
                  onChange={(event) =>
                    setNote((current) => ({
                      ...current,
                      [editId]: event.target.value,
                    }))
                  }
                />
              </label>
              {editing.action === "PENALIZE" && (
                <label className="block">
                  <span className="label">{t("penaltyHours")}</span>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    max="24"
                    className="input"
                    value={hours[editId] ?? "0.5"}
                    onChange={(event) =>
                      setHours((current) => ({
                        ...current,
                        [editId]: event.target.value,
                      }))
                    }
                  />
                </label>
              )}
            </fieldset>
            {decide.error &&
              (decide.error.data?.approvalId ? (
                <InlineNotice tone="warning" announcement="status">
                  <Link
                    className="link"
                    href={`/admin/approvals?request=${encodeURIComponent(decide.error.data.approvalId)}`}
                  >
                    {t("queued")}
                  </Link>
                </InlineNotice>
              ) : (
                <p role="alert" className="text-red-700">
                  {decide.error.message}
                </p>
              ))}
            {refreshFailed && (
              <InlineNotice
                tone="warning"
                announcement="status"
                action={
                  <Button disabled={pending} onClick={() => void refresh()}>
                    {ui("retry")}
                  </Button>
                }
              >
                {t("refreshFailed")}
              </InlineNotice>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
