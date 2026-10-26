import {
  approvalReview,
  type ReviewField,
  type ReviewRecord,
} from "./approval-review";
import { isProgramTimeZone } from "./program-time";
import { recordedEvidenceDiff } from "./recorded-evidence-diff";

const record = (value: unknown): ReviewRecord | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ReviewRecord)
    : undefined;
const rows = (value: unknown) =>
  (Array.isArray(value) ? value : [value]).flatMap((item) => {
    const row = record(record(item)?.record ?? item);
    return row ? [row] : [];
  });
const name = (row: ReviewRecord | undefined) =>
  [
    row?.englishName,
    row?.name,
    row?.title,
    record(row?.payload)?.englishName,
  ].find(
    (value): value is string => typeof value === "string" && !!value.trim(),
  );
const nonblank = (values: unknown[]) =>
  values.find(
    (value): value is string => typeof value === "string" && !!value.trim(),
  );

/** JSON snapshots store instants as strings while SuperJSON restores request
 * dates. Normalize only known date fields for equality, retaining raw evidence. */
const comparisonValue = (value: unknown, key: string) => {
  if (
    !["opensAt", "closesAt"].includes(key) ||
    (typeof value !== "string" && !(value instanceof Date))
  )
    return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
};

/** Operation adapters only project captured evidence. In particular a missing
 * default or translation destination is never filled from the live application. */
export function approvalPresentation(
  operation: string,
  payload: unknown,
  targets: unknown,
) {
  const model = approvalReview(operation, payload, targets);
  const input = record(payload) ?? {},
    evidence = record(targets) ?? {};
  const saved = record(evidence.reviewPresentation);
  const facts = [...model.context];
  let changes = model.changes;
  let unchanged = model.unchanged;
  let comparison = model.kind === "update";
  let outcome: string =
    model.kind === "action" ? "actionHelp" : `${model.kind}Help`;
  let timeZone: string | undefined;
  let feature:
    | {
        source: string;
        effective: unknown;
        pending: unknown;
        known: boolean;
        intent: string;
      }
    | undefined;
  const add = (key: string, value: unknown) => facts.push({ key, value });

  if (operation === "program.setFeaturePending") {
    const captured = saved?.version === 1 ? record(saved.feature) : undefined;
    const row = rows(evidence.programFeature).find(
      (item) => item.key === input.key,
    );
    const snapshot = captured?.key === input.key ? captured : undefined;
    const effective = snapshot?.effective ?? row?.enabled;
    const pending = snapshot ? snapshot.pending : row?.pendingEnabled;
    const known =
      typeof effective === "boolean" &&
      (pending === null || typeof pending === "boolean");
    const requested =
      known && input.enabled === effective ? null : input.enabled;
    const intent = !known
      ? "unknown"
      : requested === null
        ? pending === null
          ? "unchanged"
          : "clear"
        : requested === pending
          ? "unchanged"
          : pending === null
            ? "stage"
            : "replace";
    feature = {
      source:
        snapshot?.source === "default"
          ? "default"
          : row || snapshot
            ? "stored"
            : Array.isArray(evidence.programFeature) &&
                evidence.programFeature.length === 0
              ? "uncapturedDefault"
              : "missing",
      effective,
      pending,
      known,
      intent,
    };
    facts.length = 0;
    add("feature", input.key);
    add("effective", effective);
    add("pending", pending);
    add("requestedFeature", requested);
    changes = [
      { key: "pendingOverride", before: pending, requested, hasBefore: known },
    ];
    unchanged = [];
    comparison = true;
    outcome = `featureOutcome.${intent}`;
  }

  if (operation === "corrections.correctAttendance") {
    const session = rows(evidence.Session).find((row) => row.id === input.id);
    const collection = model.changes.find(
      (field) => field.key === "tutees",
    )?.collection;
    if (session) {
      for (const key of ["date", "startMin", "endMin"])
        if (Object.hasOwn(session, key)) add(key, session[key]);
    }
    if (collection) {
      add(
        "tuteeIds",
        collection.rows
          .filter((row) => row.state !== "unchanged")
          .map((row) => row.id),
      );
      if (!collection.counts.added && !collection.counts.removed)
        outcome = "attendanceOutcome";
    }
  }

  if (operation === "program.setSignupWindow") {
    const term = rows(evidence.term)[0];
    const audience = input.audience ?? "tutee";
    const prefix = audience === "tutor" ? "tutorSignup" : "signup";
    const capturedZone =
      saved?.version === 1
        ? saved.timeZone
        : record(record(evidence.authorityContext)?.programSettings)?.timeZone;
    timeZone =
      typeof capturedZone === "string" && isProgramTimeZone(capturedZone)
        ? capturedZone
        : undefined;
    facts.length = 0;
    add("recruitmentAudience", audience);
    add("periodName", term?.name);
    add("timeZone", timeZone);
    changes = ["enabled", "opensAt", "closesAt", "previewUrl"]
      .filter((key) => Object.hasOwn(input, key))
      .map((key): ReviewField => {
        const column = `${prefix}${key[0]!.toUpperCase()}${key.slice(1)}`;
        return {
          key,
          requested: input[key],
          before: term?.[column],
          hasBefore: !!term && Object.hasOwn(term, column),
        };
      });
    unchanged = changes.filter(
      (field) =>
        field.hasBefore &&
        !recordedEvidenceDiff(
          comparisonValue(field.before, field.key),
          comparisonValue(field.requested, field.key),
        ).size,
    );
    changes = changes.filter((field) => !unchanged.includes(field));
    comparison = true;
    outcome = "recruitmentOutcome";
  }

  if (operation === "studentWorkflow.resolveReview") {
    const review = rows(evidence.StudentRequestReview).find(
      (row) => row.id === input.id,
    );
    const survey = rows(evidence.StudentSurvey).find(
      (row) => row.id === review?.surveyId,
    );
    const tutee = rows(evidence.Tutee).find(
      (row) => row.id === (survey?.tuteeId ?? review?.legacyTuteeId),
    );
    // Resolve only the relationship named by this request, not the first named
    // participant in supporting evidence (which may describe a different person).
    facts.unshift({ key: "participant", value: name(tutee) ?? name(survey) });
    outcome =
      input.approve === true
        ? "approveUnderlying"
        : input.approve === false
          ? "rejectUnderlying"
          : "actionHelp";
  }

  if (operation === "translationReview.decide") {
    const draft = rows(evidence.TranslationDraft).find(
      (row) => row.id === input.id,
    );
    const proposed = record(draft?.payload);
    const destination = record(evidence.destination) ?? {};
    if (draft && proposed) {
      const targetKey = ["key", "postId", "sectionId", "id"].find(
        (key) => typeof proposed[key] === "string",
      );
      const targetId = targetKey ? proposed[targetKey] : undefined;
      const table =
        draft.operation === "home.setNewsTranslation"
          ? "NewsPost"
          : draft.operation === "home.setSectionTranslation"
            ? "LandingSection"
            : draft.operation === "home.setPageTitle"
              ? "CustomPage"
              : undefined;
      const parent = table
        ? rows(destination[table]).find((row) => row.id === targetId)
        : undefined;
      let destinationName: unknown = targetId;
      let originals: ReviewRecord | undefined;
      if (
        draft.operation === "localization.setString" ||
        draft.operation === "home.setContent"
      ) {
        originals = rows(
          destination[
            draft.operation === "localization.setString"
              ? "translation"
              : "content"
          ],
        ).find(
          (row) => row.key === proposed.key && row.locale === proposed.locale,
        );
      } else if (table === "NewsPost" || table === "LandingSection") {
        const foreignKey = table === "NewsPost" ? "postId" : "sectionId";
        const translations = rows(
          destination[
            `${table}.${table === "NewsPost" ? "NewsTranslation" : "LandingSectionTranslation"}`
          ],
        ).filter((row) => row[foreignKey] === targetId);
        originals = translations.find((row) => row.locale === proposed.locale);
        // The label may fall back to a captured English title, but the original
        // comparison must still come only from the exact requested locale.
        destinationName =
          nonblank([
            originals?.title,
            translations.find((row) => row.locale === "en")?.title,
            parent?.slug,
          ]) ?? targetId;
      } else if (table === "CustomPage") {
        const titles = record(parent?.title);
        destinationName =
          nonblank([
            typeof proposed.locale === "string"
              ? titles?.[proposed.locale]
              : undefined,
            titles?.en,
            parent?.slug,
          ]) ?? targetId;
        if (
          titles &&
          typeof proposed.locale === "string" &&
          Object.hasOwn(titles, proposed.locale)
        )
          originals = { value: titles[proposed.locale] };
      }
      facts.unshift(
        { key: "textDestination", value: destinationName },
        { key: "locale", value: proposed.locale },
      );
      const textFields = ["value", "title", "body"].filter((key) =>
        Object.hasOwn(proposed, key),
      );
      if (textFields.length) {
        changes = textFields.map((key) => ({
          key,
          requested: proposed[key],
          before: originals?.[key],
          hasBefore: !!originals && Object.hasOwn(originals, key),
        }));
        unchanged = [];
        comparison = true;
      }
    }
    outcome =
      input.approve === true
        ? "publishOutcome"
        : input.approve === false
          ? "rejectPublicationOutcome"
          : "actionHelp";
  }

  return {
    ...model,
    facts,
    changes,
    unchanged,
    comparison,
    outcome,
    timeZone,
    feature,
  };
}
