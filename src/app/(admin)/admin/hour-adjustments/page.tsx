"use client";
import {
  useSessionPageScroll,
  useSessionAccessDenied,
} from "~/app/_components/session-view-state";
import { InlineNotice, StatePanel } from "~/app/_components/ui/patterns";
import { ParticipantName } from "~/app/_components/participant-name";

import { useTranslations } from "next-intl";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { Button } from "~/app/_components/ui/button";
import { useRef, useState } from "react";
import Link from "next/link";

import { api } from "~/trpc/react";
import { currentMonth } from "~/lib/time";
import { useReadOnly } from "~/app/_components/read-only";
import {
  SummaryTable,
  TableActions,
  TableAction,
  TableDetails,
} from "~/app/_components/ui/summary-table";
import styles from "./page.module.css";
import { visibleTutors } from "~/lib/tutor-visibility";
import { PastTutorsToggle } from "~/app/_components/past-tutors-toggle";
import { useActionReview } from "~/app/_components/ui/action-review";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { queuedApprovalId } from "~/lib/approval-outcome";

export default function AdjustmentsPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const tutors = api.admin.tutors.useQuery();
  const [showPast, setShowPast] = useState(false);
  const list = api.admin.adjustments.useQuery({});
  const denied = useSessionAccessDenied(list, tutors);
  useSessionPageScroll({
    id: "hour-adjustments-v1",
    ready: list.data !== undefined && tutors.data !== undefined && !denied,
    enabled: !denied,
  });
  const admitted = useRef(false);
  const accepted = useRef(false);
  const [writing, setWriting] = useState(false);
  const [receipt, setReceipt] = useState<{ approvalId?: string } | null>(null);
  const [synchronizing, setSynchronizing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  // Accepted writes retire the draft immediately. Recovery only refreshes reads,
  // including when an approval proposal was queued instead of applied.
  const recover = async () => {
    setSynchronizing(true);
    try {
      await invalidateAndReport(utils.admin.adjustments);
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    } finally {
      setSynchronizing(false);
    }
  };
  const accept = async (approvalId?: string) => {
    accepted.current = true;
    setReceipt({ approvalId });
    await recover();
  };
  const create = api.admin.createAdjustment.useMutation({
    onSuccess: () => accept(),
    onError: async (error) => {
      const approvalId = queuedApprovalId(error);
      if (approvalId) await accept(approvalId);
    },
    onSettled: () => {
      admitted.current = false;
      setWriting(false);
    },
  });
  const del = api.admin.deleteAdjustment.useMutation();
  const review = useActionReview();

  const [createOpen, setCreateOpen] = useState(false);
  const [tutorId, setTutorId] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [type, setType] = useState<"PUNISHMENT" | "EXTRA">("EXTRA");
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");
  const busy = writing || create.isPending || synchronizing;
  const startAnother = () => {
    if (busy || admitted.current || refreshFailed) return;
    accepted.current = false;
    setReceipt(null);
    setRefreshFailed(false);
    setTutorId("");
    setMonth(currentMonth());
    setType("EXTRA");
    setAmount("1");
    setReason("");
    create.reset();
  };

  // A stale cached adjustment cannot supply an authorized page position.
  if (denied)
    return (
      <div className="space-y-6">
        <h1 className="page-title">{t("admin.adjustments.title")}</h1>
        <StatePanel
          kind="denied"
          title={t("managementRecovery.denied", {
            section: t("admin.adjustments.title"),
          })}
          action={
            <Button
              disabled={list.isFetching || tutors.isFetching}
              onClick={() => {
                void list.refetch();
                void tutors.refetch();
              }}
            >
              {t("uiPatterns.retry")}
            </Button>
          }
        />
      </div>
    );
  return (
    <div className={`space-y-6 ${styles.page}`}>
      {!readOnly && review.dialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{t("admin.adjustments.title")}</h1>
        {!readOnly && (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => setCreateOpen(true)}
          >
            {t("admin.adjustments.create")}
          </Button>
        )}
        <p className="muted mt-1 text-sm">{t("admin.adjustments.subtitle")}</p>
      </div>

      {!readOnly && createOpen && (
        <ProfileDialog
          title={t("admin.adjustments.create")}
          pending={busy}
          onClose={() => {
            if (!busy && !admitted.current) setCreateOpen(false);
          }}
        >
          {receipt ? (
            <div className="space-y-3">
              <InlineNotice tone="success" announcement="status">
                {t(
                  receipt.approvalId
                    ? "actionReview.queued"
                    : "actionReview.applied",
                )}
                {receipt.approvalId && (
                  <Link
                    className="link ml-2"
                    href={`/admin/approvals?request=${encodeURIComponent(receipt.approvalId)}`}
                  >
                    {t("actionReview.viewRequest")}
                  </Link>
                )}
              </InlineNotice>
              {refreshFailed && (
                <InlineNotice
                  tone="warning"
                  announcement="status"
                  action={
                    <Button disabled={busy} onClick={() => void recover()}>
                      {t("actionReview.retry")}
                    </Button>
                  }
                >
                  {t("managementRecovery.refreshFailed", {
                    section: t("admin.adjustments.title"),
                  })}
                </InlineNotice>
              )}
              <Button disabled={busy || refreshFailed} onClick={startAnother}>
                {t("admin.adjustments.create")}
              </Button>
            </div>
          ) : (
            <>
              <fieldset disabled={busy} className="space-y-4">
                <PastTutorsToggle showPast={showPast} onChange={setShowPast} />
                <form
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (
                      readOnly ||
                      busy ||
                      admitted.current ||
                      accepted.current
                    )
                      return;
                    const amt = Number(amount);
                    if (tutorId && Number.isFinite(amt) && amt > 0) {
                      admitted.current = true;
                      setWriting(true);
                      create.mutate({
                        tutorId,
                        month,
                        type,
                        amount: amt,
                        reason: reason.trim() || undefined,
                      });
                    }
                  }}
                >
                  <label>
                    <span className="label">
                      {t("admin.adjustments.table.tutor")}
                    </span>
                    <select
                      value={tutorId}
                      aria-label={t("admin.adjustments.table.tutor")}
                      onChange={(e) => setTutorId(e.target.value)}
                      className="select"
                    >
                      <option value="">
                        {t("admin.adjustments.form.tutorPlaceholder")}
                      </option>
                      {visibleTutors(tutors.data ?? [], showPast, [
                        tutorId,
                      ]).map((t) => (
                        <option key={t.id} value={t.id}>
                          <ParticipantName
                            name={t.englishName}
                            username={t.username}
                          />
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="label">
                      {t("admin.adjustments.table.month")}
                    </span>
                    <input
                      type="month"
                      aria-label={t("admin.adjustments.table.month")}
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                      className="input"
                    />
                  </label>
                  <label>
                    <span className="label">
                      {t("admin.adjustments.table.type")}
                    </span>
                    <select
                      value={type}
                      aria-label={t("admin.adjustments.table.type")}
                      onChange={(e) =>
                        setType(e.target.value as "PUNISHMENT" | "EXTRA")
                      }
                      className="select"
                    >
                      <option value="EXTRA">
                        {t("admin.adjustments.form.typeExtra")}
                      </option>
                      <option value="PUNISHMENT">
                        {t("admin.adjustments.form.typePunishment")}
                      </option>
                    </select>
                  </label>
                  <label>
                    <span className="label">
                      {t("admin.adjustments.table.amount")}
                    </span>
                    <input
                      type="number"
                      aria-label={t("admin.adjustments.table.amount")}
                      step="0.5"
                      min="0"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="input"
                    />
                  </label>
                  <label className={styles.reasonInput}>
                    <span className="label">
                      {t("admin.adjustments.table.reason")}
                    </span>
                    <input
                      value={reason}
                      aria-label={t("admin.adjustments.table.reason")}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t(
                        "admin.adjustments.form.reasonPlaceholder",
                      )}
                      className="input"
                    />
                  </label>
                  <button
                    className={`btn-primary ${styles.add}`}
                    disabled={!tutorId || !(Number(amount) > 0) || busy}
                  >
                    {t("admin.adjustments.form.add")}
                  </button>
                </form>
              </fieldset>
              {create.error && (
                <p role="alert" className="text-red-700">
                  {create.error.message}
                </p>
              )}
            </>
          )}
        </ProfileDialog>
      )}

      {list.isLoading && <p role="status">{t("common.loading")}</p>}
      {list.error && (
        <p role="alert" className="text-sm text-red-600">
          {list.error.message}
        </p>
      )}

      <div className="card">
        {/* Free-form reasons belong to the detail dialog; the month and amount stay easy to scan. */}
        <SummaryTable label={t("admin.adjustments.title")}>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">
                {t("admin.adjustments.table.tutor")}
              </th>
              <th role="columnheader" scope="col">
                {t("admin.adjustments.table.month")}
              </th>
              <th role="columnheader" scope="col">
                {t("admin.adjustments.table.type")}
              </th>
              <th role="columnheader" scope="col" className="text-right">
                {t("admin.adjustments.table.amount")}
              </th>
              <th scope="col" className="table-actions-heading">
                {t("tablePatterns.actions")}
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {(list.data ?? []).map((a) => (
              <tr role="row" key={a.id}>
                <td role="cell">{a.tutor.englishName}</td>
                <td role="cell">
                  <time dateTime={a.month} className={styles.month}>
                    {a.month}
                  </time>
                </td>
                <td role="cell" className="text-slate-500">
                  {t(`admin.adjustments.typeLabel.${a.type}`)}
                </td>
                <td role="cell" className="text-right">
                  {/* Decimal amounts are one token; the table scrolls locally
                      instead of breaking the fractional digits onto another line. */}
                  <span className={styles.amount}>{a.amount.toFixed(1)}</span>
                </td>
                <TableActions>
                  <TableDetails title={`${a.tutor.englishName} · ${a.month}`}>
                    <dl className="space-y-2">
                      <dt className="font-semibold">
                        {t("admin.adjustments.table.type")}
                      </dt>
                      <dd>
                        {t(`admin.adjustments.typeLabel.${a.type}`)} ·{" "}
                        {a.amount.toFixed(1)}
                      </dd>
                      <dt className="font-semibold">
                        {t("admin.adjustments.table.reason")}
                      </dt>
                      <dd className="whitespace-pre-wrap">{a.reason ?? "—"}</dd>
                    </dl>
                  </TableDetails>
                  {!readOnly && (
                    <TableAction
                      onClick={() =>
                        review.open({
                          key: a.id,
                          title: t("admin.adjustments.review.title"),
                          description: t(
                            "admin.adjustments.review.consequence",
                          ),
                          confirmLabel: t("admin.adjustments.review.confirm"),
                          details: (
                            <div className="space-y-2 text-sm break-words">
                              <p className="font-semibold">
                                {a.tutor.englishName}
                              </p>
                              <p>
                                {a.month} ·{" "}
                                {t(`admin.adjustments.typeLabel.${a.type}`)} ·{" "}
                                {a.amount.toFixed(1)} h
                              </p>
                              <p className="whitespace-pre-wrap">
                                {a.reason ?? "—"}
                              </p>
                            </div>
                          ),
                          commit: () => del.mutateAsync({ id: a.id }),
                          refresh: () =>
                            invalidateAndReport(utils.admin.adjustments),
                          approvalId: queuedApprovalId,
                        })
                      }
                      disabled={review.blocked(a.id)}
                      aria-label={`${t("admin.adjustments.table.delete")}: ${a.tutor.englishName}, ${a.month}`}
                      className="text-red-700"
                    >
                      {t("admin.adjustments.table.delete")}
                    </TableAction>
                  )}
                </TableActions>
              </tr>
            ))}
          </tbody>
        </SummaryTable>
      </div>
    </div>
  );
}
