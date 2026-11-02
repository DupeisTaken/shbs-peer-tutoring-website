"use client";

import { useFormatter, useTranslations } from "next-intl";
import { APPROVAL_OPERATIONS, humanizeOperation } from "~/lib/approval-policy";
import {
  auditEntityLabelKey,
  auditFieldLabelKey,
  auditEnumLabelKey,
} from "~/lib/review-vocabulary";
import {
  nextRecruitmentApprovalReview,
  scheduledRefreshApprovalReview,
  reviewTechnicalFields,
  type ReviewField,
} from "~/lib/approval-review";
import { approvalPresentation } from "~/lib/approval-presentation";
import { isReviewReference } from "~/lib/approval-summary";
import { reviewCollectionFieldEqual } from "~/lib/approval-review-collections";
import { ReviewDisclosure } from "./review-disclosure";
import { reviewInstant } from "~/lib/review-instant";
import { NextRecruitmentReview } from "./next-recruitment-review";
import { ProgramRefreshEffects } from "./program-refresh-effects";
import { minToHm } from "~/lib/time";
import { periodLabel } from "~/lib/period";
import { roomBlockReview } from "~/lib/room-block-review";
import { RoomBlockReview } from "./room-block-review";
import {
  HistoricalCorrectionReview,
  historicalReviewRecords,
} from "./historical-correction-review";
import { SIGNUP_FIELDS } from "~/lib/signup-fields";
import { MESSAGE_GROUPS, type MessageGroup } from "~/lib/messaging";
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
  const allText = useTranslations();
  const departureText = useTranslations("schoolDeparture");
  const signupText = useTranslations("signupFields");
  const nameFieldsText = useTranslations("nameFields");
  const namesText = useTranslations("personName");
  const rolesText = useTranslations("admin.users.roles");
  const roomOrderText = useTranslations("roomOrder");
  const featureText = useTranslations("admin.program.features");
  const recruitmentText = useTranslations("nextRecruitment");
  const scheduledText = useTranslations("scheduledRefresh");
  const format = useFormatter();
  if (operation === "admin.scheduleRefresh" || operation === "admin.cancelRefresh") {
    const review = scheduledRefreshApprovalReview(operation, payload, targets);
    if (!review) return <p className="text-sm text-slate-600">{t("unavailable")}</p>;
    const time = (value: Date, zone: string) => format.dateTime(value, { dateStyle: "medium", timeStyle: "short", timeZone: zone });
    if (review.kind === "cancel") {
      const row = review.schedule;
      return <section aria-label={t("affected")} className="space-y-3 text-sm">
        <p className="font-medium">{scheduledText("cancelTitle")}</p>
        <p>{scheduledText("cancelHelp", { target: periodLabel({ schoolYear: row.destinationSchoolYear, quarter: row.destinationQuarter }, row.semesterMode), time: time(row.executeAt, row.timeZone), zone: row.timeZone })}</p>
        <p>{scheduledText("cancelEffect")}</p>
      </section>;
    }
    return <section aria-label={t("affected")} className="space-y-4 text-sm">
      <p className="font-medium">{scheduledText("reviewHelp", { target: review.snapshot.nextName, time: time(review.executeAt, review.snapshot.timeZone), zone: review.snapshot.timeZone })}</p>
      {review.previous && <div><p className="muted text-xs">{t("before")}</p><p>{scheduledText("summary", { target: periodLabel({ schoolYear: review.previous.destinationSchoolYear, quarter: review.previous.destinationQuarter }, review.previous.semesterMode), time: time(review.previous.executeAt, review.previous.timeZone), zone: review.previous.timeZone })}</p><p>{scheduledText(`states.${review.previous.state}`)}</p></div>}
      <NextRecruitmentReview snapshot={review.snapshot} />
      <ProgramRefreshEffects target={review.snapshot.target} />
      <p>{scheduledText("catchUp")}</p><p>{scheduledText("staleHelp")}</p>
    </section>;
  }
  if (
    operation === "program.prepareNextRecruitment" ||
    operation === "admin.refresh"
  ) {
    const review = nextRecruitmentApprovalReview(operation, payload, targets);
    if (summaryOnly && review)
      return (
        <section aria-label={t("affected")} className="space-y-3 text-sm">
          <p className="font-medium">
            {review.snapshot.currentName} → {review.snapshot.nextName}
          </p>
          <NextRecruitmentReview {...review} />
          {operation === "admin.refresh" && (
            <ProgramRefreshEffects target={review.snapshot.target} />
          )}
        </section>
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
    if (summaryOnly && review.success)
      return (
        <section aria-label={t("affected")} className="space-y-3 text-sm">
          {review.data.map((record) => (
            <div
              key={record.recordId}
              className="min-w-0 rounded-lg bg-slate-50 p-3"
            >
              <p className="font-semibold">{record.name}</p>
              <p className="text-xs [overflow-wrap:anywhere] text-slate-600">
                {t("recordId", { id: record.recordId })}
              </p>
              <dl className="mt-2 space-y-2">
                {(["rawGrade", "schoolYear"] as const).map((key) => (
                  <div key={key}>
                    <dt className="font-medium">{t(`fields.${key}`)}</dt>
                    <dd>
                      {t("before")}: {record.current[key] ?? t("emptyValue")}
                    </dd>
                    <dd>
                      {t("after")}: {record.proposed[key] ?? t("emptyValue")}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>
      );
    if (review.success)
      return <HistoricalCorrectionReview records={review.data} />;
  }
  const model = approvalPresentation(operation, payload, targets);
  const entity = APPROVAL_OPERATIONS[operation] ?? "";
  const block = roomBlockReview(operation, payload, targets);
  const departureAction =
    operation === "departure.setState"
      ? model.changes.find((field) => field.key === "action")?.requested
      : undefined;
  const signupAnswerLabels: Record<string, string> = {
    englishName: "name",
    phone: "phone",
    gradeLevel: "gradeLevel",
    preferredContact: "preferredContact",
    firstChoiceId: "firstSubject",
    secondChoiceId: "secondSubject",
    slotIds: "availability",
  };
  const label = (key: string, owner = entity) =>
    key === "groups" &&
    operation === "admin.importCourseGroups" &&
    owner === "CourseGroup"
      ? allText(auditEntityLabelKey("CourseGroup")!)
      : key === "targets" && operation === "admin.autoAssignUnassignedRooms"
        ? t("entities.Pairing")
        : key === "rank" && ["SubjectLevel", "CourseGroup"].includes(owner)
          ? allText("auditEventDetails.presentation.fields.sortOrder")
          : key === "answers" && operation === "studentWorkflow.headEditSignup"
            ? allText("signupEditing.title")
            : owner === "SignupAnswers" &&
                Object.hasOwn(signupAnswerLabels, key)
              ? signupText(`labels.${signupAnswerLabels[key]}`)
              : owner === "SignupAnswers" &&
                  NAME_FIELD_KEYS.includes(
                    key as (typeof NAME_FIELD_KEYS)[number],
                  )
                ? namesText(key)
                : key === "offerings" &&
                    [
                      "admin.saveCourseGroup",
                      "admin.importCourseGroups",
                    ].includes(operation)
                  ? t("fields.subjects")
                  : key === "baseName" && owner === "Subject"
                    ? t("fields.name")
                    : key === "recipientCount"
                      ? allText("admin.announcements.recipients.button")
                      : owner === "AnnouncementAudience" &&
                          ["includeTutorIds", "excludeTutorIds"].includes(key)
                        ? allText(
                            `admin.announcements.recipients.${key === "includeTutorIds" ? "include" : "exclude"}`,
                          )
                        : owner === "AnnouncementAudience" &&
                            [
                              "mode",
                              "grades",
                              "statuses",
                              "subjects",
                              "assignment",
                            ].includes(key)
                          ? allText(`admin.announcements.recipients.${key}`)
                          : key === "requestedFeature"
                            ? t("after")
                            : operation === "program.setNameFields" &&
                                key === "states"
                              ? nameFieldsText("title")
                              : operation === "program.setNameFields" &&
                                  key === "accountType"
                                ? nameFieldsText("accountType")
                                : [
                                      "program.setNameFields",
                                      "admin.correctApplicationIdentity",
                                      "admin.updateAccountProfile",
                                      "admin.updateTutor",
                                      "admin.updateTutee",
                                    ].includes(operation) &&
                                    NAME_FIELD_KEYS.includes(
                                      key as (typeof NAME_FIELD_KEYS)[number],
                                    )
                                  ? namesText(key)
                                  : operation === "admin.reorderRooms" &&
                                      key === "roomOrder"
                                    ? roomOrderText("title")
                                    : key === "groupId" &&
                                        ["Pairing", "PairingGroup"].includes(
                                          owner,
                                        ) &&
                                        auditFieldLabelKey(owner, key)
                                      ? allText(auditFieldLabelKey(owner, key)!)
                                      : t.has(`fields.${key}`)
                                        ? t(`fields.${key}`)
                                        : auditFieldLabelKey(owner, key)
                                          ? allText(
                                              auditFieldLabelKey(owner, key)!,
                                            )
                                          : t("unknownField", { field: key });
  const display = (
    value: unknown,
    key = "",
    owner = entity,
    literal = false,
    context = false,
  ): React.ReactNode => {
    if (value === undefined)
      return <span className="text-slate-600">{t("unavailable")}</span>;
    if (isReviewReference(value)) {
      const entityKey = auditEntityLabelKey(value.entity);
      return (
        <div className="space-y-1">
          <span className="block font-medium">
            {value.name ??
              (value.state === "recorded"
                ? entityKey
                  ? allText(entityKey)
                  : value.entity
                : t(
                    value.state === "ambiguous"
                      ? "referenceAmbiguous"
                      : "referenceMissing",
                    {
                      entity: entityKey ? allText(entityKey) : value.entity,
                    },
                  ))}
          </span>
          <div
            className={
              context && key === "id"
                ? "grid gap-x-4 gap-y-2 sm:grid-cols-2"
                : "space-y-1"
            }
          >
            {value.facts.map((fact) => (
              <div
                key={fact.key}
                className={`min-w-0 text-sm ${context && Array.isArray(fact.value) ? "sm:col-span-2" : ""}`}
              >
                <span className="text-slate-600">
                  {label(fact.key, value.entity)}:{" "}
                </span>
                {display(fact.value, fact.key, value.entity, false, context)}
              </div>
            ))}
          </div>
          <span className="block text-xs font-normal [overflow-wrap:anywhere] text-slate-600">
            {t("recordId", { id: value.id })}
          </span>
        </div>
      );
    }
    if (
      ["pending", "pendingOverride", "requestedFeature"].includes(key) &&
      value === null
    )
      return t("noPending");
    if (
      value === null &&
      operation === "messaging.setPermission" &&
      owner === "MessagePermission" &&
      key === "groups"
    ) {
      const target =
        payload && typeof payload === "object" && "target" in payload
          ? payload.target
          : undefined;
      const type =
        target && typeof target === "object" && "type" in target
          ? target.type
          : undefined;
      if (type === "USER" || type === "ROLE")
        return allText(
          type === "USER" ? "messaging.inherit" : "messaging.resetDefault",
        );
    }
    if (value === null)
      return <span className="text-slate-500">{t("emptyValue")}</span>;
    if (value === "")
      return (
        <span className="text-slate-600">
          {allText("auditEventDetails.emptyString")}
        </span>
      );
    if (literal && typeof value === "string") return value;
    if (literal && typeof value === "number") return format.number(value);
    if (literal && typeof value === "boolean") return t(value ? "yes" : "no");
    if (literal && value instanceof Date) return value.toISOString();
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
      if (
        operation === "messaging.setPermission" &&
        owner === "MessagePermission" &&
        key === "groups" &&
        MESSAGE_GROUPS.includes(value as MessageGroup)
      )
        return allText(`messaging.groups.${value}`);
      if (
        operation === "admin.reorderCatalogue" &&
        key === "kind" &&
        ["levels", "groups"].includes(value)
      )
        return allText(
          auditEntityLabelKey(
            value === "levels" ? "SubjectLevel" : "CourseGroup",
          )!,
        );
      if (owner === "AnnouncementAudience") {
        if (
          (key === "mode" && ["all", "filtered", "specific"].includes(value)) ||
          (key === "assignment" && ["any", "with", "without"].includes(value))
        )
          return allText(`admin.announcements.recipients.${value}`);
        if (key === "statuses") {
          const status = auditEnumLabelKey("Tutor", "status", value);
          if (status) return allText(status);
        }
      }
      if (
        owner === "MessagePermission" &&
        key === "type" &&
        ["ROLE", "USER"].includes(value)
      )
        return t(`values.${value}`);
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
      if (["id", "ids", "code", "codes"].includes(key) || /Ids?$/.test(key)) {
        const reference = model.referenceFor(key, value, owner);
        if (reference) return display(reference, key, owner, false, context);
        // An untyped identifier cannot borrow a label from another table.
        return t("recordId", { id: value });
      }
      // User-authored names, reasons and text must be displayed verbatim, even
      // when they happen to match a status or a saved record ID.
      const enumKey = auditEnumLabelKey(owner, key, value);
      if (enumKey) return allText(enumKey);
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
        Object.hasOwn(APPROVAL_OPERATIONS, operation) &&
        t.has(`values.${value}`)
      )
        return t(`values.${value}`);
      return value;
    }
    const childOwner =
      key === "$record"
        ? owner
        : key === "answers" &&
            owner === "StudentSurvey" &&
            operation === "studentWorkflow.headEditSignup"
          ? "SignupAnswers"
          : key === "tutees" && ["Session", "SessionTutee"].includes(owner)
            ? "SessionTutee"
            : key === "observations" &&
                ["Patrol", "PatrolObservation"].includes(owner)
              ? "PatrolObservation"
              : key === "entries" &&
                  operation === "admin.recordMeetingAttendance" &&
                  ["TutorMeeting", "MeetingAttendance"].includes(owner)
                ? "MeetingAttendance"
                : key === "membership" && owner === "User"
                  ? "User"
                  : key === "states" && operation === "program.setNameFields"
                    ? "ProgramSettings"
                    : key === "target" && owner === "MessagePermission"
                      ? "MessagePermission"
                      : key === "assignments" &&
                          ((owner === "StudentSurvey" &&
                            operation === "studentWorkflow.assign") ||
                            (owner === "Tutee" &&
                              operation === "admin.assignSignup"))
                        ? "Pairing"
                        : key === "offerings" &&
                            owner === "CourseGroup" &&
                            [
                              "admin.saveCourseGroup",
                              "admin.importCourseGroups",
                            ].includes(operation)
                          ? "Subject"
                          : key === "subjects" &&
                              owner === "Subject" &&
                              operation === "admin.importSubjects"
                            ? "Subject"
                            : key === "groups" &&
                                owner === "CourseGroup" &&
                                operation === "admin.importCourseGroups"
                              ? "CourseGroup"
                              : key === "targets" &&
                                  owner === "Pairing" &&
                                  operation ===
                                    "admin.autoAssignUnassignedRooms"
                                ? "Pairing"
                                : key === "audience" && owner === "Announcement"
                                  ? "AnnouncementAudience"
                                  : key === "roomOrder" && owner === "Room"
                                    ? "Room"
                                    : key === "completion" &&
                                        owner === "TutorApplication"
                                      ? "TutorApplication"
                                      : undefined;
    if (Array.isArray(value))
      return value.length ? (
        <ul className={context ? "grid gap-2 sm:grid-cols-3" : "space-y-2"}>
          {value.map((item, index) => (
            <li key={index} className="border-l-2 border-slate-200 pl-3">
              {display(
                item,
                item !== null && typeof item === "object" ? "$record" : key,
                childOwner ?? owner,
                literal ||
                  (item !== null && typeof item === "object" && !childOwner),
                context,
              )}
            </li>
          ))}
        </ul>
      ) : (
        t("none")
      );
    if (
      typeof value === "object" &&
      !Object.keys(value).some((field) => !reviewTechnicalFields.has(field))
    )
      return allText("auditEventDetails.emptyObject");
    if (typeof value === "object")
      return (
        <dl className="space-y-2">
          {Object.entries(value)
            .filter(([field]) => !reviewTechnicalFields.has(field))
            .map(([field, item]) => (
              <div key={field}>
                <dt className="text-xs font-medium text-slate-500">
                  {literal || !childOwner ? field : label(field, childOwner)}
                </dt>
                <dd>
                  {display(
                    item,
                    field,
                    childOwner ?? owner,
                    literal || !childOwner,
                    context,
                  )}
                </dd>
              </div>
            ))}
        </dl>
      );
    return t("unavailable");
  };
  // Compact context still retains a secondary ID for every reference: names
  // can collide, including the primary account selected by a userId field.
  const values = (
    entries: [string, unknown][],
    owner = entity,
    context = false,
  ) => (
    <dl className="grid gap-4 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className={`min-w-0 ${context && isReviewReference(value) && value.facts.length ? "sm:col-span-2" : ""}`}
        >
          <dt className="text-xs font-medium text-slate-500">
            {label(key, owner)}
          </dt>
          <dd className="mt-1 text-sm break-words whitespace-pre-wrap text-slate-900">
            {display(value, key, owner, false, context)}
          </dd>
        </div>
      ))}
    </dl>
  );
  // The persistent summary keeps the actual changed values visible when the
  // full review is collapsed. It shares the exact capture and value renderer.
  const summaryValue = (field: ReviewField, owner = entity) => (
    <div
      className={`min-w-0 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap ${model.comparison ? "grid gap-3 sm:grid-cols-2" : ""}`}
    >
      {model.comparison && (
        <div className="text-slate-700">
          <span className="font-medium">{t("before")}: </span>
          {field.hasBefore
            ? display(field.before, field.key, owner)
            : t("unavailable")}
        </div>
      )}
      <div className="text-slate-900">
        <span className="font-medium">{t("after")}: </span>
        {display(field.requested, field.key, owner)}
      </div>
    </div>
  );
  const summaryChange = (field: ReviewField) => {
    const collection = field.collection;
    if (!collection) return summaryValue(field);
    const owner =
      field.key === "archivedOfferings"
        ? "Subject"
        : field.key === "tutees"
          ? "SessionTutee"
          : field.key === "observations"
            ? "PatrolObservation"
            : entity;
    return (
      <ul className="space-y-3 text-sm">
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
              <li
                key={row.id}
                className="min-w-0 border-l-2 border-slate-200 pl-3"
              >
                <span className="block font-medium text-slate-700">
                  {t(`collectionState.${row.state}`)}
                </span>
                {display(row.id, collection.identity, owner)}
                {fields.map((key) => (
                  <div key={key} className="mt-2">
                    <span className="font-medium">{label(key, owner)}</span>
                    {summaryValue(
                      {
                        key,
                        before: left?.[key],
                        requested: right?.[key],
                        hasBefore: !!left && Object.hasOwn(left, key),
                      },
                      owner,
                    )}
                  </div>
                ))}
              </li>
            );
          })}
      </ul>
    );
  };
  const summary = (
    <section aria-label={t("affected")} className="space-y-3">
      {!!model.summary.facts.length &&
        values(
          model.summary.facts.map(({ key, value }) => [key, value]),
          entity,
          true,
        )}
      <p className="text-sm font-medium text-slate-900">{t(model.outcome)}</p>
      {!!model.summary.changes.length && (
        <dl
          aria-label={t("summaryChanges")}
          className="divide-y divide-slate-200 rounded-lg bg-slate-50 px-3"
        >
          {model.summary.changes.map((field) => (
            <div
              key={field.key}
              className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]"
            >
              <dt className="text-sm font-semibold text-slate-800">
                {label(field.key)}
              </dt>
              <dd className="min-w-0">{summaryChange(field)}</dd>
            </div>
          ))}
        </dl>
      )}
      {model.summary.noChange && (
        <p className="text-sm text-slate-700">{t("noFieldChanges")}</p>
      )}
      {model.feature && (
        <p className="text-sm text-slate-600">
          {t(`featureSource.${model.feature.source}`)}
        </p>
      )}
    </section>
  );
  if (summaryOnly) return summary;

  const comparison = (field: ReviewField, owner = entity) => (
    <div className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)]">
      <h4 className="text-sm font-semibold text-slate-800">
        {label(field.key, owner)}
      </h4>
      {model.comparison && (
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-slate-600">
            {t("before")}
          </p>
          <div className="text-sm break-words whitespace-pre-wrap text-slate-700">
            {field.hasBefore
              ? display(field.before, field.key, owner)
              : t("unavailable")}
          </div>
        </div>
      )}
      <div
        className={`bg-accent-50 min-w-0 rounded-md px-3 py-2 ${model.comparison ? "" : "sm:col-span-2"}`}
      >
        <p className="text-accent-800 mb-1 text-xs font-medium">{t("after")}</p>
        <div className="text-sm break-words whitespace-pre-wrap text-slate-900">
          {display(field.requested, field.key, owner)}
        </div>
      </div>
    </div>
  );
  const change = (field: ReviewField) => {
    const collection = field.collection;
    if (!collection) return comparison(field);
    const owner =
      field.key === "archivedOfferings"
        ? "Subject"
        : field.key === "tutees"
          ? "SessionTutee"
          : field.key === "observations"
            ? "PatrolObservation"
            : entity;
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
                <div className="text-sm font-semibold text-slate-900">
                  {display(row.id, collection.identity, owner)}{" "}
                  <span className="ml-2 text-xs font-medium text-slate-600">
                    {t(`collectionState.${row.state}`)}
                  </span>
                </div>
                {fields.length
                  ? fields.map((key) => (
                      <div key={key}>
                        {comparison(
                          {
                            key,
                            before: left?.[key],
                            requested: right?.[key],
                            hasBefore: !!left && Object.hasOwn(left, key),
                          },
                          owner,
                        )}
                      </div>
                    ))
                  : row.state === "changed"
                    ? comparison(
                        {
                          ...field,
                          key: collection.identity,
                          before: row.before,
                          requested: row.requested,
                        },
                        owner,
                      )
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
                  {display(row.requested, "$record", owner)}
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
                  {auditEntityLabelKey(table.split(".").at(-1))
                    ? allText(auditEntityLabelKey(table.split(".").at(-1))!)
                    : t.has(`entities.${table}`)
                      ? t(`entities.${table}`)
                      : humanizeOperation(table)}
                </h4>
                {rows.map((row, index) => (
                  <div key={index} className="border-t border-slate-100 pt-3">
                    {values(
                      Object.entries(row).filter(
                        ([key]) => !reviewTechnicalFields.has(key),
                      ),
                      table,
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
