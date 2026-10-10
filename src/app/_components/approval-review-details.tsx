"use client";

import { useFormatter, useTranslations } from "next-intl";
import { humanizeOperation } from "~/lib/approval-policy";
import { approvalReview, reviewTechnicalFields } from "~/lib/approval-review";
import { minToHm } from "~/lib/time";
import { roomBlockReview } from "~/lib/room-block-review";
import { RoomBlockReview } from "./room-block-review";
import { HistoricalCorrectionReview, historicalReviewRecords } from "./historical-correction-review";
import { SIGNUP_FIELDS } from "~/lib/signup-fields";

/** Both the card and the final consequence dialog show this exact same proposal. */
export function ApprovalReviewDetails({
  operation,
  payload,
  targets,
  compact = false,
}: {
  operation: string;
  payload: unknown;
  targets: unknown;
  compact?: boolean;
}) {
  const t = useTranslations("approvals.review");
  const departureText = useTranslations("schoolDeparture");
  const signupText = useTranslations("signupFields");
  const format = useFormatter();
  if (operation === "historicalAcademics.correctBatch" && targets && typeof targets === "object" && "historicalAcademics" in targets) {
    const review = historicalReviewRecords.safeParse(targets.historicalAcademics);
    if (review.success) return <HistoricalCorrectionReview records={review.data} />;
  }
  const model = approvalReview(operation, payload, targets);
  const block = roomBlockReview(operation, payload, targets);
  const departureAction =
    operation === "departure.setState"
      ? model.changes.find((field) => field.key === "action")?.requested
      : undefined;
  const label = (key: string) =>
    t.has(`fields.${key}`)
      ? t(`fields.${key}`)
      : humanizeOperation(key.replace(/Ids?$/, ""));
  const display = (value: unknown, key = ""): React.ReactNode => {
    if (value === null || value === undefined || value === "")
      return <span className="text-slate-500">{t("emptyValue")}</span>;
    if (
      value instanceof Date ||
      (typeof value === "string" &&
        /(?:At|date|Date)$/.test(key) &&
        /^\d{4}-\d{2}-\d{2}T/.test(value))
    ) {
      const date = new Date(value);
      if (Number.isFinite(date.getTime()))
        return format.dateTime(date, {
          dateStyle: "medium",
          timeStyle: "short",
        });
    }
    if (typeof value === "boolean") {
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
      // Localize only known signup schema values; historical or user-authored text stays verbatim.
      if (operation === "program.setSignupField") {
        if (key === "form" && (value === "tutee" || value === "tutor")) return signupText(value);
        if (key === "state" && ["required", "optional", "hidden"].includes(value)) return signupText(value);
        if (key === "field") {
          const form = payload && typeof payload === "object" && "form" in payload ? payload.form : undefined;
          const field = form === "tutee" || form === "tutor" ? SIGNUP_FIELDS[form].find((field) => field.key === value) : undefined;
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
  return (
    <div className="space-y-4">
      {!!model.context.length && (
        <section
          aria-label={t("affected")}
          className="rounded-lg bg-slate-50 p-4"
        >
          <h3 className="mb-3 text-sm font-semibold text-slate-800">
            {t("affected")}
          </h3>
          {values(model.context.map(({ key, value }) => [key, value]))}
        </section>
      )}
      <section aria-label={t("requested")} className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">
          {t("requested")}
        </h3>
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
            <p className="text-sm text-slate-500">{t(`${model.kind}Help`)}</p>
            {model.changes.length ? (
              <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
                {model.changes.map((field) => (
                  <div
                    key={field.key}
                    className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)]"
                  >
                    <h4 className="text-sm font-semibold text-slate-800">
                      {label(field.key)}
                    </h4>
                    {model.kind === "update" && (
                      <div className="min-w-0">
                        <p className="mb-1 text-xs font-medium text-slate-500">
                          {t("before")}
                        </p>
                        <div className="text-sm break-words whitespace-pre-wrap text-slate-600">
                          {field.hasBefore
                            ? display(field.before, field.key)
                            : t("unavailable")}
                        </div>
                      </div>
                    )}
                    <div
                      className={`min-w-0 rounded-md bg-blue-50 px-3 py-2 ${model.kind === "update" ? "" : "sm:col-span-2"}`}
                    >
                      <p className="mb-1 text-xs font-medium text-blue-800">
                        {t("after")}
                      </p>
                      <div className="text-sm break-words whitespace-pre-wrap text-slate-900">
                        {display(field.requested, field.key)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                {t(model.unchanged.length ? "noFieldChanges" : "noFields")}
              </p>
            )}
          </>
        )}
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
