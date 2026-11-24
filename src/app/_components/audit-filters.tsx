"use client";
import { useState } from "react";
import { useLocale, useTranslations, useTimeZone } from "next-intl";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { humanizeOperation } from "~/lib/approval-policy";
import { auditActorLabel } from "~/lib/audit-actors";
import { auditEntityLabelKey } from "~/lib/review-vocabulary";
import { QueryFeedback } from "./ui/query-feedback";

import { programDayStart, programDayEnd } from "~/lib/program-time";
import {
  programTimeZoneInputLabel,
  programTimeZoneLabel,
} from "~/lib/program-time-zone-label";
export type AuditFilterInput = NonNullable<RouterInputs["admin"]["auditLog"]>;
export type AuditFilterOptions = RouterOutputs["admin"]["auditFilterOptions"];
export function hasAuditFilterOptions(
  value: AuditFilterOptions | null | undefined,
): value is AuditFilterOptions {
  return (
    !!value &&
    Array.isArray(value.users) &&
    Array.isArray(value.operations) &&
    Array.isArray(value.entities)
  );
}
export type AuditKind =
  | "ACTION"
  | "DECISION"
  | "SUBMISSION"
  | "CANCELLATION"
  | "ATTEMPT"
  | "REVERSAL";
export const emptyAuditView = {
  userId: "",
  kind: "",
  operation: "",
  entity: "",
  search: "",
  from: "",
  until: "",
};
export type AuditView = typeof emptyAuditView;

/** Apply the form as one filter set, so incomplete text/date edits never trigger a query. */
export function AuditFilters({
  onApply,
  appliedView,
  catalogue,
  unavailable = false,
  optionsError,
  optionsRetrying,
  onRetryOptions,
}: {
  onApply: (input: AuditFilterInput, view: AuditView) => void;
  appliedView?: AuditView;
  catalogue?: AuditFilterOptions;
  unavailable?: boolean;
  optionsError?: { message?: string } | null;
  optionsRetrying?: boolean;
  onRetryOptions?: () => void;
}) {
  const t = useTranslations("auditFilters");
  const recovery = useTranslations("managementRecovery");
  const vocabulary = useTranslations();
  const timeZone = useTimeZone() ?? "Asia/Shanghai";
  const locale = useLocale();
  const [referenceTime] = useState(() => new Date());
  const [inputError, setInputError] = useState("");
  const [draft, setDraft] = useState(appliedView ?? emptyAuditView);
  const appliedKey = appliedView ? JSON.stringify(appliedView) : "";
  const [previousAppliedKey, setPreviousAppliedKey] = useState(appliedKey);
  // A changed committed view replaces the draft before children render. Equal
  // criteria (including a background refresh) leave unfinished edits untouched.
  if (previousAppliedKey !== appliedKey) {
    setPreviousAppliedKey(appliedKey);
    if (appliedView) setDraft(appliedView);
  }
  const controlled =
    catalogue !== undefined ||
    optionsError !== undefined ||
    onRetryOptions !== undefined;
  const options = api.admin.auditFilterOptions.useQuery(undefined, {
    enabled: !controlled,
  });
  const currentOptions = hasAuditFilterOptions(options.data)
    ? options.data
    : undefined;
  const currentSignature = currentOptions ? JSON.stringify(currentOptions) : "";
  const [retainedOptions, setRetainedOptions] = useState<{
    signature: string;
    value: AuditFilterOptions;
  }>();
  if (currentOptions && retainedOptions?.signature !== currentSignature) {
    setRetainedOptions({ signature: currentSignature, value: currentOptions });
  }
  const values = controlled
    ? catalogue
    : (currentOptions ?? retainedOptions?.value);
  const missingOptions = !controlled && options.isSuccess && !currentOptions;
  const activeError =
    optionsError !== undefined ? optionsError : (options.error ?? null);
  const readFailed = !!activeError || missingOptions;
  const retrying = optionsRetrying ?? Boolean(options.isFetching);
  const blocked = unavailable || readFailed || !hasAuditFilterOptions(values);
  const retryOptions = onRetryOptions ?? (() => void options.refetch());
  const set = (key: keyof AuditView, value: string) =>
    setDraft((old) => ({ ...old, [key]: value }));
  const selects = [
    {
      key: "userId",
      label: "user",
      all: "allUsers",
      values: [
        { id: "__system__", label: t("system") },
        ...(values?.users.map((u) => ({
          id: u.id,
          label: auditActorLabel(u, {
            unnamed: t("unnamedAccount"),
            former: t("formerAccount"),
          }),
        })) ?? []),
      ],
    },
    {
      key: "kind",
      label: "kind",
      all: "allKinds",
      values: [
        "ACTION",
        "DECISION",
        "SUBMISSION",
        "CANCELLATION",
        "ATTEMPT",
        "REVERSAL",
      ].map((id) => ({ id, label: t(`kinds.${id}`) })),
    },
    {
      key: "operation",
      label: "operation",
      all: "allOperations",
      values:
        values?.operations.map((id) => ({
          id,
          label: vocabulary.has(
            `approvals.review.operations.${id.replaceAll(".", "_")}`,
          )
            ? `${vocabulary(`approvals.review.operations.${id.replaceAll(".", "_")}`)} (${id})`
            : id,
        })) ?? [],
    },
    {
      key: "entity",
      label: "entity",
      all: "allEntities",
      values:
        values?.entities.map((id) => ({
          id,
          label: vocabulary.has(auditEntityLabelKey(id) ?? "")
            ? vocabulary(auditEntityLabelKey(id)!)
            : humanizeOperation(id),
        })) ?? [],
    },
  ];
  return (
    <form
      className="card grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (blocked) return;
        try {
          setInputError("");
          onApply(
            {
              userId: draft.userId || undefined,
              kind: (draft.kind || undefined) as
                | "ACTION"
                | "DECISION"
                | "SUBMISSION"
                | "CANCELLATION"
                | "ATTEMPT"
                | "REVERSAL"
                | undefined,
              operation: draft.operation || undefined,
              entity: draft.entity || undefined,
              search: draft.search || undefined,
              from: draft.from
                ? programDayStart(draft.from, timeZone)
                : undefined,
              until: draft.until
                ? new Date(programDayEnd(draft.until, timeZone).getTime() + 1)
                : undefined,
            },
            draft,
          );
        } catch (error) {
          setInputError(
            error instanceof Error ? error.message : "Invalid date",
          );
        }
      }}
    >
      {(readFailed || !values) && (
        <div className="sm:col-span-2 xl:col-span-4">
          <QueryFeedback
            hasData={!!values}
            loading={!values && !readFailed}
            error={readFailed}
            retrying={retrying}
            loadingTitle={recovery("loading", { section: t("filterOptions") })}
            errorTitle={recovery(values ? "refreshFailed" : "loadFailed", {
              section: t("filterOptions"),
            })}
            errorDetail={activeError?.message}
            retryLabel={recovery("retry", { section: t("filterOptions") })}
            onRetry={retryOptions}
          />
        </div>
      )}
      {inputError && <p role="alert">{inputError}</p>}
      {selects.map((select) => (
        <label key={select.key}>
          <span className="label">{t(select.label)}</span>
          <select
            className="select mt-1 w-full min-w-0 whitespace-nowrap"
            title={
              select.values.find(
                (value) => value.id === draft[select.key as keyof AuditView],
              )?.label
            }
            value={draft[select.key as keyof AuditView]}
            disabled={blocked}
            onChange={(e) => set(select.key as keyof AuditView, e.target.value)}
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
          disabled={blocked}
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
          disabled={blocked}
          onChange={(e) => set("until", e.target.value)}
        />
      </label>
      <label className="sm:col-span-2">
        <span className="label">{t("search")}</span>
        <input
          className="input mt-1 w-full"
          value={draft.search}
          disabled={blocked}
          maxLength={200}
          placeholder={t("searchHint")}
          onChange={(e) => set("search", e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 xl:col-span-4">
        <button className="btn-primary" disabled={blocked}>
          {t("apply")}
        </button>
        <button
          className="btn-secondary"
          type="button"
          disabled={blocked}
          onClick={() => {
            if (blocked) return;
            setDraft(emptyAuditView);
            onApply({}, emptyAuditView);
          }}
        >
          {t("clear")}
        </button>
        <p className="muted ml-auto text-xs">
          {t("utc", {
            // A date range can cross DST: show both endpoint labels instead of
            // suggesting that today's offset applies to every historical record.
            zone:
              draft.from || draft.until
                ? [
                    ...new Set(
                      [
                        draft.from &&
                          programTimeZoneInputLabel(
                            `${draft.from}T00:00`,
                            timeZone,
                            locale,
                          ),
                        draft.until &&
                          programTimeZoneInputLabel(
                            `${draft.until}T23:59`,
                            timeZone,
                            locale,
                          ),
                      ].filter(Boolean),
                    ),
                  ].join(" → ")
                : programTimeZoneLabel(timeZone, referenceTime, locale),
          })}
        </p>
      </div>
    </form>
  );
}
