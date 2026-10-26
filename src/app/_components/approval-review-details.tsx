"use client";

import { useFormatter, useTranslations } from "next-intl";
import { humanizeOperation } from "~/lib/approval-policy";
import {
  nextRecruitmentApprovalReview,
  reviewTechnicalFields,
  type ReviewField,
} from "~/lib/approval-review";
import { approvalPresentation } from "~/lib/approval-presentation";
import { reviewCollectionFieldEqual } from "~/lib/approval-review-collections";
import { ReviewDisclosure } from "./review-disclosure";
import { reviewInstant } from "~/lib/review-instant";
import { NextRecruitmentReview } from "./next-recruitment-review";
import { ProgramRefreshEffects } from "./program-refresh-effects";
import { minToHm } from "~/lib/time";
import { roomBlockReview } from "~/lib/room-block-review";
import { RoomBlockReview } from "./room-block-review";
import {
  HistoricalCorrectionReview,
  historicalReviewRecords,
} from "./historical-correction-review";
import { SIGNUP_FIELDS } from "~/lib/signup-fields";
import {
  NAME_ACCOUNT_TYPES,
  NAME_FIELD_KEYS,
  type NameAccountType,
} from "~/lib/name-field-policy";

/** Both the card and the final consequence dialog show this exact same proposal. */
export function ApprovalReviewDetails({
  operation,
  payload,
  targets,
  compact = false,
  summaryOnly = false,
  hideSummary = false,
  busy = false,
}: {
  operation: string;
  payload: unknown;
  targets: unknown;
  compact?: boolean;
  summaryOnly?: boolean;
  hideSummary?: boolean;
  busy?: boolean;
}) {
  const t = useTranslations("approvals.review");
  const departureText = useTranslations("schoolDeparture");
  const signupText = useTranslations("signupFields");
  const nameFieldsText = useTranslations("nameFields");
  const namesText = useTranslations("personName");
  const rolesText = useTranslations("admin.users.roles");
  const roomOrderText = useTranslations("roomOrder");
  const featureText = useTranslations("admin.program.features");
  const recruitmentText = useTranslations("nextRecruitment");
  const format = useFormatter();
  if (
    operation === "program.prepareNextRecruitment" ||
    operation === "admin.refresh"
  ) {
    const review = nextRecruitmentApprovalReview(operation, payload, targets);
    if (summaryOnly)
      return (
        <p className="text-sm text-slate-800">
          {review
            ? `${review.snapshot.currentName} → ${review.snapshot.nextName}`
            : t("unavailable")}
        </p>
      );
    return review ? (
      <div className="space-y-4">
        <NextRecruitmentReview {...review} />
        {operation === "admin.refresh" && (
          <ProgramRefreshEffects target={review.snapshot.target} />
        )}
      </div>
    ) : (
      <p className="text-sm text-slate-600">{t("unavailable")}</p>
    );
  }
  if (
    operation === "historicalAcademics.correctBatch" &&
    targets &&
    typeof targets === "object" &&
    "historicalAcademics" in targets
  ) {
    const review = historicalReviewRecords.safeParse(
      targets.historicalAcademics,
    );
    if (summaryOnly)
      return <p className="text-sm text-slate-800">{t("updateHelp")}</p>;
    if (review.success)
      return <HistoricalCorrectionReview records={review.data} />;
  }
  const model = approvalPresentation(operation, payload, targets);
  const block = roomBlockReview(operation, payload, targets);
  const departureAction =
    operation === "departure.setState"
      ? model.changes.find((field) => field.key === "action")?.requested
      : undefined;
  const label = (key: string) =>
    key === "requestedFeature"
      ? t("after")
      : operation === "program.setNameFields" && key === "states"
        ? nameFieldsText("title")
        : operation === "program.setNameFields" && key === "accountType"
          ? nameFieldsText("accountType")
          : [
                "program.setNameFields",
                "admin.correctApplicationIdentity",
                "admin.updateAccountProfile",
                "admin.updateTutor",
                "admin.updateTutee",
              ].includes(operation) &&
              NAME_FIELD_KEYS.includes(key as (typeof NAME_FIELD_KEYS)[number])
            ? namesText(key)
            : operation === "admin.reorderRooms" && key === "roomOrder"
              ? roomOrderText("title")
              : t.has(`fields.${key}`)
                ? t(`fields.${key}`)
                : humanizeOperation(key.replace(/Ids?$/, ""));
  const display = (value: unknown, key = ""): React.ReactNode => {
    if (value === undefined)
      return <span className="text-slate-600">{t("unavailable")}</span>;
    if (
      ["pending", "pendingOverride", "requestedFeature"].includes(key) &&
      value === null
    )
      return t("noPending");
    if (value === null || value === "")
      return <span className="text-slate-500">{t("emptyValue")}</span>;
    if (
      value instanceof Date ||
      (typeof value === "string" &&
        /(?:At|date|Date)$/.test(key) &&
        /^\d{4}-\d{2}-\d{2}T/.test(value))
    ) {
      const date = reviewInstant(value);
      if (operation === "program.setSignupWindow" && !model.timeZone)
        return Number.isFinite(date.getTime())
          ? date.toISOString()
          : String(value);
      if (Number.isFinite(date.getTime()))
        return format.dateTime(date, {
          dateStyle: "medium",
          timeStyle: "short",
          ...(model.timeZone ? { timeZone: model.timeZone } : {}),
        });
    }
    if (typeof value === "boolean") {
      if (
        [
          "effective",
          "pending",
          "pendingOverride",
          "requestedFeature",
        ].includes(key)
      )
        return featureText(value ? "on" : "off");
      if (key === "approve" || key === "accept")
        return t(value ? "approveUnderlying" : "rejectUnderlying");
      if (key === "overturn") return t(value ? "overturn" : "uphold");
      return t(value ? "yes" : "no");
    }
    if (typeof value === "number") {
      if (["startMin", "endMin"].includes(key)) return minToHm(value);
      if (key === "dayOfWeek" && value >= 1 && value <= 7)
        return format.dateTime(new Date(Date.UTC(2026, 0, 4 + value)), {
          weekday: "long",
          timeZone: "UTC",
        });
      return format.number(value);
    }
    if (typeof value === "string") {
      if (key === "feature" && featureText.has(`name.${value}`))
        return featureText(`name.${value}`);
      if (key === "recruitmentAudience" && ["tutor", "tutee"].includes(value))
        return recruitmentText(value);
      // Translate only schema-owned states/roles. Captured names and other
      // user-authored evidence remain exactly as supplied at submission.
      if (operation === "program.setNameFields") {
        if (
          key === "accountType" &&
          NAME_ACCOUNT_TYPES.includes(value as NameAccountType)
        )
          return rolesText(value);
        if (
          NAME_FIELD_KEYS.includes(key as (typeof NAME_FIELD_KEYS)[number]) &&
          ["required", "optional", "hidden"].includes(value)
        )
          return signupText(value);
      }
      // Localize only known signup schema values; historical or user-authored text stays verbatim.
      if (operation === "program.setSignupField") {
        if (key === "form" && (value === "tutee" || value === "tutor"))
          return signupText(value);
        if (
          key === "state" &&
          ["required", "optional", "hidden"].includes(value)
        )
          return signupText(value);
        if (key === "field") {
          const form =
            payload && typeof payload === "object" && "form" in payload
              ? payload.form
              : undefined;
          const field =
            form === "tutee" || form === "tutor"
              ? SIGNUP_FIELDS[form].find((field) => field.key === value)
              : undefined;
          if (field) return signupText(`labels.${field.label}`);
        }
      }
      if (key === "id" || /Ids?$/.test(key)) {
        const name = model.names.get(value);
        if (name) return name;
        const saved = model.references.get(value);
        if (
          saved &&
          typeof saved.dayOfWeek === "number" &&
          typeof saved.startMin === "number" &&
          typeof saved.endMin === "number"
        )
          return (
            <>
              {display(saved.dayOfWeek, "dayOfWeek")} ·{" "}
              {minToHm(saved.startMin)}–{minToHm(saved.endMin)}
            </>
          );
        return t("recordId", { id: value });
      }
      // User-authored names, reasons and text must be displayed verbatim, even
      // when they happen to match a status or a saved record ID.
      if (
        [
          "status",
          "state",
          "action",
          "reviewStatus",
          "role",
          "rank",
          "crewStatus",
          "tutorStatus",
          "headcount",
          "mode",
          "kind",
        ].includes(key) &&
        t.has(`values.${value}`)
      )
        return t(`values.${value}`);
      return value;
    }
    if (Array.isArray(value))
      return value.length ? (
        <ul className="space-y-2">
          {value.map((item, index) => (
            <li key={index} className="border-l-2 border-slate-200 pl-3">
              {display(item, key)}
            </li>
          ))}
        </ul>
      ) : (
        t("none")
      );
    if (typeof value === "object")
      return (
        <dl className="space-y-2">
          {Object.entries(value)
            .filter(([field]) => !reviewTechnicalFields.has(field))
            .map(([field, item]) => (
              <div key={field}>
                <dt className="text-xs font-medium text-slate-500">
                  {label(field)}
                </dt>
                <dd>{display(item, field)}</dd>
              </div>
            ))}
        </dl>
      );
    return t("unavailable");
  };
  const values = (entries: [string, unknown][]) => (
    <dl className="grid gap-4 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="text-xs font-medium text-slate-500">{label(key)}</dt>
          <dd className="mt-1 text-sm break-words whitespace-pre-wrap text-slate-900">
            {display(value, key)}
          </dd>
        </div>
      ))}
    </dl>
  );
  const summary = (
    <section aria-label={t("affected")} className="space-y-3">
      {!!model.facts.length &&
        values(model.facts.map(({ key, value }) => [key, value]))}
      <p className="text-sm font-medium text-slate-900">{t(model.outcome)}</p>
      {model.feature && (
        <p className="text-sm text-slate-600">
          {t(`featureSource.${model.feature.source}`)}
        </p>
      )}
    </section>
  );
  if (summaryOnly) return summary;

  const comparison = (field: ReviewField) => (
    <div className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)]">
      <h4 className="text-sm font-semibold text-slate-800">
        {label(field.key)}
      </h4>
      {model.comparison && (
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-slate-600">
            {t("before")}
          </p>
          <div className="text-sm break-words whitespace-pre-wrap text-slate-700">
            {field.hasBefore
              ? display(field.before, field.key)
              : t("unavailable")}
          </div>
        </div>
      )}
      <div
        className={`bg-accent-50 min-w-0 rounded-md px-3 py-2 ${model.comparison ? "" : "sm:col-span-2"}`}
      >
        <p className="text-accent-800 mb-1 text-xs font-medium">{t("after")}</p>
        <div className="text-sm break-words whitespace-pre-wrap text-slate-900">
          {display(field.requested, field.key)}
        </div>
      </div>
    </div>
  );
  const change = (field: ReviewField) => {
    const collection = field.collection;
    if (!collection) return comparison(field);
    return (
      <section className="space-y-3 py-3" aria-label={label(field.key)}>
        <h4 className="text-sm font-semibold text-slate-800">
          {label(field.key)}
        </h4>
        <p className="text-sm text-slate-600">
          {t("collectionCounts", collection.counts)}
        </p>
        {collection.rows
          .filter((row) => row.state !== "unchanged")
          .map((row) => {
            const left =
              row.before && typeof row.before === "object"
                ? (row.before as Record<string, unknown>)
                : undefined;
            const right =
              row.requested && typeof row.requested === "object"
                ? (row.requested as Record<string, unknown>)
                : undefined;
            const fields = [
              ...new Set([
                ...Object.keys(left ?? {}),
                ...Object.keys(right ?? {}),
              ]),
            ]
              .filter(
                (key) =>
                  key !== collection.identity &&
                  !reviewTechnicalFields.has(key),
              )
              .filter(
                (key) =>
                  !reviewCollectionFieldEqual(
                    left?.[key],
                    right?.[key],
                    key,
                    collection.dateFields,
                    !!left && Object.hasOwn(left, key),
                    !!right && Object.hasOwn(right, key),
                  ),
              );
            return (
              <div key={row.id} className="border-t border-slate-200 pt-3">
                <p className="text-sm font-semibold text-slate-900">
                  {display(row.id, collection.identity)}{" "}
                  <span className="ml-2 text-xs font-medium text-slate-600">
                    {t(`collectionState.${row.state}`)}
                  </span>
                </p>
                {fields.length
                  ? fields.map((key) => (
                      <div key={key}>
                        {comparison({
                          key,
                          before: left?.[key],
                          requested: right?.[key],
                          hasBefore: !!left && Object.hasOwn(left, key),
                        })}
                      </div>
                    ))
                  : row.state === "changed"
                    ? comparison({
                        ...field,
                        key: collection.identity,
                        before: row.before,
                        requested: row.requested,
                      })
                    : null}
              </div>
            );
          })}
        {!!collection.counts.unchanged && (
          <ReviewDisclosure
            title={t("unchangedRows", { count: collection.counts.unchanged })}
            defaultOpen={false}
            busy={busy}
          >
            {collection.rows
              .filter((row) => row.state === "unchanged")
              .map((row) => (
                <div className="text-sm whitespace-pre-wrap" key={row.id}>
                  {display(row.requested, field.key)}
                </div>
              ))}
          </ReviewDisclosure>
        )}
      </section>
    );
  };
  return (
    <div className="space-y-4">
      {!hideSummary && summary}
      <section aria-label={t("requested")}>
        <ReviewDisclosure title={t("requested")} busy={busy}>
          {operation === "departure.setState" && (
            <div className="space-y-2 rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-slate-800">
              <p>
                {departureText(
                  departureAction === "RETURN"
                    ? "returnHelp"
                    : departureAction === "REVOKE" ||
                        departureAction === "RESTORE"
                      ? "accessHelp"
                      : "consequences",
                )}
              </p>
              <p>{departureText("retained")}</p>
            </div>
          )}
          {block ? (
            <RoomBlockReview summary={block} />
          ) : model.kind === "delete" ? (
            <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-medium text-red-900">
                {t("deleteHelp")}
              </p>
              {model.hasRemovalSnapshot ? (
                values(model.removed)
              ) : (
                <p className="text-sm text-slate-600">{t("unavailable")}</p>
              )}
              {!!model.changes.length &&
                values(
                  model.changes.map((field) => [field.key, field.requested]),
                )}
            </div>
          ) : (
            <>
              {model.changes.length ? (
                <div className="divide-y divide-slate-200">
                  {model.changes.map((field) => (
                    <div key={field.key}>{change(field)}</div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                  {t(model.unchanged.length ? "noFieldChanges" : "noFields")}
                </p>
              )}
            </>
          )}
        </ReviewDisclosure>
      </section>
      {!!model.unchanged.length && (
        <details className="rounded-lg border border-slate-200 px-4">
          <summary className="min-h-11 cursor-pointer content-center text-sm font-medium text-slate-600 lg:min-h-8">
            {t("unchanged", { count: model.unchanged.length })}
          </summary>
          <div className="py-3">
            {values(
              model.unchanged.map((field) => [field.key, field.requested]),
            )}
          </div>
        </details>
      )}
      {!compact && (
        <details className="border-t border-slate-100 pt-2">
          <summary className="link min-h-11 cursor-pointer content-center text-sm lg:min-h-8">
            {t("evidence")}
          </summary>
          <p className="my-3 max-w-prose text-sm text-slate-500">
            {t("evidenceHelp")}
          </p>
          <div className="space-y-3">
            {model.groups.map(({ table, rows }) => (
              <section
                key={table}
                className="space-y-3 rounded-lg border border-slate-200 p-4"
              >
                <h4 className="text-sm font-semibold text-slate-700">
                  {t.has(`entities.${table}`)
                    ? t(`entities.${table}`)
                    : humanizeOperation(table)}
                </h4>
                {rows.map((row, index) => (
                  <div key={index} className="border-t border-slate-100 pt-3">
                    {values(
                      Object.entries(row).filter(
                        ([key]) => !reviewTechnicalFields.has(key),
                      ),
                    )}
                  </div>
                ))}
              </section>
            ))}
            {!model.groups.length && (
              <p className="text-sm text-slate-500">{t("unavailable")}</p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
