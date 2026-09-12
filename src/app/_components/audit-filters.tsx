"use client";
import { useState } from "react";
import { useTranslations, useTimeZone } from "next-intl";
import { api, type RouterInputs } from "~/trpc/react";
import { humanizeOperation } from "~/lib/approval-policy";

import { programDayStart, programDayEnd } from "~/lib/program-time";
export type AuditFilterInput = NonNullable<RouterInputs["admin"]["auditLog"]>;
const empty = {
  userId: "",
  kind: "",
  operation: "",
  entity: "",
  search: "",
  from: "",
  until: "",
};

/** Apply the form as one filter set, so incomplete text/date edits never trigger a query. */
export function AuditFilters({
  onApply,
}: {
  onApply: (input: AuditFilterInput) => void;
}) {
  const t = useTranslations("auditFilters");
  const timeZone = useTimeZone() ?? "Asia/Shanghai";
  const [inputError, setInputError] = useState("");
  const [draft, setDraft] = useState(empty);
  const options = api.admin.auditFilterOptions.useQuery();
  const set = (key: keyof typeof empty, value: string) =>
    setDraft((old) => ({ ...old, [key]: value }));
  const selects = [
    {
      key: "userId",
      label: "user",
      all: "allUsers",
      values: [
        { id: "__system__", label: t("system") },
        ...(options.data?.users.map((u) => ({
          id: u.id,
          label: `${u.label} · ${u.id.slice(-6)}`,
        })) ?? []),
      ],
    },
    {
      key: "kind",
      label: "kind",
      all: "allKinds",
      values: ["ACTION", "DECISION", "SUBMISSION", "CANCELLATION"].map(
        (id) => ({ id, label: t(`kinds.${id}`) }),
      ),
    },
    {
      key: "operation",
      label: "operation",
      all: "allOperations",
      values:
        options.data?.operations.map((id) => ({
          id,
          label: `${humanizeOperation(id)} (${id.split(".")[0]})`,
        })) ?? [],
    },
    {
      key: "entity",
      label: "entity",
      all: "allEntities",
      values:
        options.data?.entities.map((id) => ({
          id,
          label: humanizeOperation(id),
        })) ?? [],
    },
  ];
  return (
    <form
      className="card grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        try { setInputError(""); onApply({
          userId: draft.userId || undefined,
          kind: (draft.kind || undefined) as
            "ACTION" | "DECISION" | "SUBMISSION" | "CANCELLATION" | undefined,
          operation: draft.operation || undefined,
          entity: draft.entity || undefined,
          search: draft.search || undefined,
          from: draft.from ? programDayStart(draft.from, timeZone) : undefined,
          until: draft.until
            ? new Date(
                programDayEnd(draft.until, timeZone).getTime() + 1,
              )
            : undefined,
        }); } catch (error) { setInputError(error instanceof Error ? error.message : "Invalid date"); }
      }}
    >
      {inputError && <p role="alert">{inputError}</p>}
      {selects.map((select) => (
        <label key={select.key}>
          <span className="label">{t(select.label)}</span>
          <select
            className="input mt-1 w-full"
            value={draft[select.key as keyof typeof empty]}
            onChange={(e) =>
              set(select.key as keyof typeof empty, e.target.value)
            }
          >
            <option value="">{t(select.all)}</option>
            {select.values.map((value) => (
              <option key={value.id} value={value.id}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label>
        <span className="label">{t("from")}</span>
        <input
          className="input mt-1 w-full"
          type="date"
          value={draft.from}
          onChange={(e) => set("from", e.target.value)}
        />
      </label>
      <label>
        <span className="label">{t("until")}</span>
        <input
          className="input mt-1 w-full"
          type="date"
          min={draft.from || undefined}
          value={draft.until}
          onChange={(e) => set("until", e.target.value)}
        />
      </label>
      <label className="sm:col-span-2">
        <span className="label">{t("search")}</span>
        <input
          className="input mt-1 w-full"
          value={draft.search}
          maxLength={200}
          placeholder={t("searchHint")}
          onChange={(e) => set("search", e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 xl:col-span-4">
        <button className="btn-primary">{t("apply")}</button>
        <button
          className="btn-secondary"
          type="button"
          onClick={() => {
            setDraft(empty);
            onApply({});
          }}
        >
          {t("clear")}
        </button>
        <p className="muted ml-auto text-xs">{t("utc", { zone: timeZone })}</p>
      </div>
      {options.error && (
        <p role="alert" className="text-red-700 sm:col-span-2">
          {options.error.message}
        </p>
      )}
    </form>
  );
}
