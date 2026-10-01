"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

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

export default function AdjustmentsPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const tutors = api.admin.tutors.useQuery();
  const list = api.admin.adjustments.useQuery({});
  const invalidate = () => utils.admin.adjustments.invalidate();
  const create = api.admin.createAdjustment.useMutation({
    onSuccess: invalidate,
  });
  const del = api.admin.deleteAdjustment.useMutation({ onSuccess: invalidate });

  const [tutorId, setTutorId] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [type, setType] = useState<"PUNISHMENT" | "EXTRA">("EXTRA");
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");

  return (
    <div className={`space-y-6 ${styles.page}`}>
      <div>
        <h1 className="page-title">{t("admin.adjustments.title")}</h1>
        <p className="muted mt-1 text-sm">{t("admin.adjustments.subtitle")}</p>
      </div>

      {!readOnly && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            const amt = Number(amount);
            if (tutorId && amt > 0)
              create.mutate({
                tutorId,
                month,
                type,
                amount: amt,
                reason: reason.trim() || undefined,
              });
          }}
        >
          <select
            value={tutorId}
            aria-label={t("admin.adjustments.table.tutor")}
            onChange={(e) => setTutorId(e.target.value)}
            className="select"
          >
            <option value="">
              {t("admin.adjustments.form.tutorPlaceholder")}
            </option>
            {(tutors.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.englishName}
              </option>
            ))}
          </select>
          <input
            type="month"
            aria-label={t("admin.adjustments.table.month")}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="input"
          />
          <select
            value={type}
            aria-label={t("admin.adjustments.table.type")}
            onChange={(e) => setType(e.target.value as "PUNISHMENT" | "EXTRA")}
            className="select"
          >
            <option value="EXTRA">
              {t("admin.adjustments.form.typeExtra")}
            </option>
            <option value="PUNISHMENT">
              {t("admin.adjustments.form.typePunishment")}
            </option>
          </select>
          <input
            type="number"
            aria-label={t("admin.adjustments.table.amount")}
            step="0.5"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input"
          />
          <input
            value={reason}
            aria-label={t("admin.adjustments.table.reason")}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("admin.adjustments.form.reasonPlaceholder")}
            className={`input ${styles.reasonInput}`}
          />
          <button
            className={`btn-primary ${styles.add}`}
            disabled={!tutorId || !(Number(amount) > 0) || create.isPending}
          >
            {t("admin.adjustments.form.add")}
          </button>
        </form>
      )}
      {!readOnly && create.error && (
        <p role="alert" className="text-sm text-red-600">
          {create.error.message}
        </p>
      )}
      {!readOnly && del.error && (
        <p role="alert" className="text-sm text-red-600">
          {del.error.message}
        </p>
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
                  {a.amount.toFixed(1)}
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
                      onClick={() => del.mutate({ id: a.id })}
                      disabled={del.isPending}
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
