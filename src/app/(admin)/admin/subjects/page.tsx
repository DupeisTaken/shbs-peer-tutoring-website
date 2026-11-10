"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSessionAccessDenied } from "~/app/_components/session-view-state";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { courseName } from "~/lib/course-catalogue";
import { MAX_IMPORT_BYTES, parseCourseImport } from "~/lib/course-import";
import { CourseCatalogueTable } from "~/app/_components/course-catalogue-table";
import { useReadOnly } from "~/app/_components/read-only";
import { useActionReview } from "~/app/_components/ui/action-review";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { queuedApprovalId } from "~/lib/approval-outcome";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";

type Group = RouterOutputs["admin"]["courseGroups"][number];
type Level = RouterOutputs["admin"]["subjectLevels"][number];
type Variant = RouterOutputs["admin"]["subjects"][number];
type Catalogue = { groups: Group[]; levels: Level[]; variants: Variant[] };
const catalogueIntent = (procedure: string, input: unknown) =>
  JSON.stringify([procedure, input]);

/** Local drafts keep toggles, per-level names and previews together until a deliberate save. */
function GroupEditor({
  group,
  levels,
  variants,
  done,
  invalidate,
  blocked,
  admit,
  release,
  onQueued,
  isQueued,
}: {
  group?: Group;
  levels: Level[];
  variants: Variant[];
  done: () => void;
  invalidate: (onReady?: () => void) => Promise<unknown>;
  blocked: boolean;
  admit: (procedure: string, input: unknown) => boolean;
  release: () => void;
  onQueued: (error: unknown) => void;
  isQueued: (procedure: string, input: unknown) => boolean;
}) {
  const t = useTranslations("courseGroups");
  const saveText = useTranslations("saveBoundary");
  const [name, setName] = useState(group?.name ?? "");
  const [accepted, setAccepted] = useState(false);
  const [queued, setQueued] = useState(false);
  const reviewText = useTranslations("actionReview");
  const [offers, setOffers] = useState<
    Record<string, { baseName: string; subjectId?: string }>
  >(() =>
    Object.fromEntries(
      (group?.subjects ?? [])
        .filter((s) => s.active)
        .map((s) => [
          s.levelId ?? "",
          { baseName: s.baseName || s.name, subjectId: s.id },
        ]),
    ),
  );
  const save = api.admin.saveCourseGroup.useMutation({
    onSuccess: async () => {
      // Acceptance is final even when the following catalogue read fails.
      setAccepted(true);
      await invalidate(done);
    },
    onError: (error) => {
      if (!queuedApprovalId(error)) return;
      setAccepted(true);
      setQueued(true);
      onQueued(error);
    },
    onSettled: release,
  });
  const choices = [
    ...levels.map((l) => ({ id: l.id, name: l.name, prefix: l.prefix })),
    ...(offers[""] || group?.subjects.some((s) => !s.levelId)
      ? [{ id: "", name: t("noLevel"), prefix: "" }]
      : []),
  ];
  const input = {
    id: group?.id,
    name,
    offerings: Object.entries(offers).map(([levelId, value]) => ({
      ...value,
      levelId: levelId || null,
    })),
  };
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          accepted ||
          !Object.keys(offers).length ||
          !admit("saveCourseGroup", input)
        )
          return;
        save.mutate(input);
      }}
    >
      <fieldset
        disabled={blocked || accepted || save.isPending}
        className="space-y-4"
      >
        <label className="block">
          <span className="label">{t("groupName")}</span>
          <input
            className="input min-h-11 w-full lg:min-h-9"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset className="space-y-3">
          <legend className="label">{t("offeredLevels")}</legend>
          {choices.map((level) => (
            <div
              key={level.id}
              className="rounded-lg border border-slate-200 p-3"
            >
              <label className="flex min-h-11 items-center gap-3 lg:min-h-8">
                <input
                  type="checkbox"
                  checked={!!offers[level.id]}
                  onChange={(e) =>
                    setOffers((current) => {
                      const next = { ...current };
                      if (e.target.checked) {
                        const existing = group?.subjects.find(
                          (s) => s.levelId === level.id,
                        );
                        next[level.id] = {
                          baseName: (existing?.baseName ?? "") || name,
                          subjectId: existing?.id,
                        };
                      } else delete next[level.id];
                      return next;
                    })
                  }
                />
                <span className="font-medium">{level.name}</span>
              </label>
              {offers[level.id] && (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className="label">
                      {t("baseName", { level: level.name })}
                    </span>
                    <input
                      className="input min-h-11 w-full lg:min-h-9"
                      required
                      maxLength={160}
                      value={offers[level.id]!.baseName}
                      onChange={(e) =>
                        setOffers({
                          ...offers,
                          [level.id]: {
                            ...offers[level.id]!,
                            baseName: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span className="label">{t("existingVariant")}</span>
                    <select
                      className="select min-h-11 w-full lg:min-h-9"
                      value={offers[level.id]!.subjectId ?? ""}
                      onChange={(e) => {
                        const subject = variants.find(
                          (s) => s.id === e.target.value,
                        );
                        setOffers({
                          ...offers,
                          [level.id]: {
                            baseName:
                              (subject?.baseName ?? "") ||
                              (subject?.name ?? name),
                            subjectId: subject?.id,
                          },
                        });
                      }}
                    >
                      <option value="">{t("newVariant")}</option>
                      {variants
                        .filter((s) => (s.levelId ?? "") === level.id)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className="text-sm text-slate-600 sm:col-span-2">
                    {t("preview")}:{" "}
                    <strong>
                      {courseName(offers[level.id]!.baseName, level.prefix)}
                    </strong>
                  </p>
                </div>
              )}
            </div>
          ))}
        </fieldset>
      </fieldset>
      <p className="muted text-sm">{t("archiveHelp")}</p>
      {save.error && !queuedApprovalId(save.error) && (
        <p role="alert" className="text-sm text-red-600">
          {save.error.message}
        </p>
      )}
      {accepted && (
        <p role="status">
          {queued ? reviewText("queued") : t("savedRefreshing")}
        </p>
      )}
      <p className="muted text-sm">{saveText("form")}</p>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary min-h-11 lg:min-h-9"
          disabled={
            blocked ||
            accepted ||
            isQueued("saveCourseGroup", input) ||
            save.isPending ||
            !Object.keys(offers).length
          }
        >
          {t("save")}
        </button>
        <button
          className="btn-secondary min-h-11 lg:min-h-9"
          type="button"
          disabled={save.isPending}
          onClick={done}
        >
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

export default function SubjectsPage() {
  const t = useTranslations("courseGroups");
  const saveText = useTranslations("saveBoundary");
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const groups = api.admin.courseGroups.useQuery();
  const levels = api.admin.subjectLevels.useQuery();
  const variants = api.admin.subjects.useQuery();
  const denied = useSessionAccessDenied(groups, levels, variants);
  const viewReady =
    groups.data != null && levels.data != null && variants.data != null;
  const currentCatalogue =
    !denied && viewReady
      ? { groups: groups.data, levels: levels.data, variants: variants.data }
      : null;
  const signature = currentCatalogue ? JSON.stringify(currentCatalogue) : "";
  const [snapshot, setSnapshot] = useState<{
    signature: string;
    catalogue: Catalogue;
  } | null>(null);
  // Retain render state rather than reading a mutable ref. Equal catalogues may
  // arrive as new arrays; their content identity prevents a mirror render loop.
  if (denied && snapshot) setSnapshot(null);
  else if (currentCatalogue && snapshot?.signature !== signature)
    setSnapshot({ signature, catalogue: currentCatalogue });
  const catalogue = denied
    ? null
    : (currentCatalogue ?? snapshot?.catalogue ?? null);
  const [editing, setEditing] = useState<string | null>(null);
  const [newLevel, setNewLevel] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [readingImport, setReadingImport] = useState(false);
  const [writePending, setWritePending] = useState(false);
  const admission = useRef(false);
  const [acceptedSave, setAcceptedSave] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailure, setRefreshFailure] = useState<Error | null>(null);
  const refreshLease = useRef<Promise<void> | null>(null);
  const completions = useRef<(() => void)[]>([]);
  const review = useActionReview();
  const [reviewDenied, setReviewDenied] = useState(false);
  if (denied !== reviewDenied) {
    setReviewDenied(denied);
    if (denied) review.revoke();
  }
  const [queuedIntents, setQueuedIntents] = useState<Record<string, string>>(
    {},
  );
  const admittedIntent = useRef("");
  const isQueued = (procedure: string, input: unknown) =>
    !!queuedIntents[catalogueIntent(procedure, input)];
  const acceptQueued = (error: unknown) => {
    const approvalId = queuedApprovalId(error);
    if (approvalId) {
      const intent = admittedIntent.current;
      setQueuedIntents((current) => ({ ...current, [intent]: approvalId }));
    }
  };
  const readFailure =
    groups.error ?? levels.error ?? variants.error ?? refreshFailure;
  const missingRead = [groups, levels, variants].some(
    (query) => query.isSuccess && query.data == null,
  );
  const catalogueAvailable =
    !readOnly &&
    viewReady &&
    !denied &&
    !readFailure &&
    !missingRead &&
    !acceptedSave &&
    !refreshing &&
    !review.blocked("catalogue");
  const availability = useRef(catalogueAvailable);
  useLayoutEffect(() => {
    availability.current = catalogueAvailable;
  }, [catalogueAvailable]);
  const writesBlocked = !catalogueAvailable || writePending;
  const admit = (procedure: string, input: unknown) => {
    // All writes derive catalogue relationships/ranks from these same three reads.
    // The ref closes same-turn admission before React publishes pending state.
    if (
      !availability.current ||
      admission.current ||
      isQueued(procedure, input)
    )
      return false;
    admittedIntent.current = catalogueIntent(procedure, input);
    admission.current = true;
    setWritePending(true);
    return true;
  };
  const release = () => {
    admission.current = false;
    setWritePending(false);
  };
  const refreshCatalogue = () => {
    if (refreshLease.current) return refreshLease.current;
    setRefreshing(true);
    const refresh = async () => {
      try {
        // Inspect actual refetch results: default invalidation suppresses GET errors.
        // allSettled keeps ownership until every prerequisite read has finished.
        const results = await Promise.allSettled(
          [
            () => groups.refetch({ throwOnError: true }),
            () => levels.refetch({ throwOnError: true }),
            () => variants.refetch({ throwOnError: true }),
          ].map(async (read) => read()),
        );
        for (const result of results) {
          if (result.status === "rejected") {
            const cause: unknown = result.reason;
            throw cause instanceof Error
              ? cause
              : new Error(t("loadFailed"), { cause });
          }
          if (result.value.error) {
            const cause = result.value.error;
            throw cause instanceof Error
              ? cause
              : Object.assign(new Error(t("loadFailed"), { cause }), {
                  data: cause.data,
                });
          }
          if (result.value.data == null) throw new Error(t("loadFailed"));
        }
        setRefreshFailure(null);
        setAcceptedSave(false);
        const ready = completions.current;
        completions.current = [];
        ready.forEach((complete) => complete());
      } catch (error) {
        setRefreshFailure(
          error instanceof Error ? error : new Error(t("loadFailed")),
        );
      } finally {
        refreshLease.current = null;
        setRefreshing(false);
      }
    };
    refreshLease.current = refresh();
    return refreshLease.current;
  };
  const invalidate = async (onReady?: () => void) => {
    setAcceptedSave(true);
    if (onReady) completions.current.push(onReady);
    await refreshCatalogue();
  };
  const batchUpdate = api.admin.batchUpdateSubjects.useMutation({
    onSuccess: () => invalidate(),
    onError: acceptQueued,
    onSettled: release,
  });
  const reorder = api.admin.reorderCatalogue.useMutation({
    onSuccess: () => invalidate(),
    onError: acceptQueued,
    onSettled: release,
  });
  const updateLevel = api.admin.updateSubjectLevel.useMutation({
    onSuccess: () => invalidate(),
    onError: acceptQueued,
    onSettled: release,
  });
  const createLevel = api.admin.createSubjectLevel.useMutation({
    onSuccess: () => invalidate(() => setNewLevel("")),
    onError: acceptQueued,
    onSettled: release,
  });
  const removeLevel = api.admin.deleteSubjectLevel.useMutation();
  const reviewText = useTranslations("actionReview");
  const importSubjects = api.admin.importSubjects.useMutation({
    onSuccess: async (result) => {
      setImportMessage(t("importResult", result));
      await invalidate();
    },
    onError: acceptQueued,
    onSettled: release,
  });
  const importGroups = api.admin.importCourseGroups.useMutation({
    onSuccess: async (result) => {
      setImportMessage(t("groupImportResult", result));
      await invalidate();
    },
    onError: acceptQueued,
    onSettled: release,
  });
  const move = (
    kind: "groups" | "levels",
    index: number,
    direction: number,
  ) => {
    const ids = (
      kind === "groups" ? (groups.data ?? []) : (levels.data ?? [])
    ).map((row) => row.id);
    [ids[index], ids[index + direction]] = [
      ids[index + direction]!,
      ids[index]!,
    ];
    const input = { kind, ids };
    if (!admit("reorderCatalogue", input)) return;
    reorder.mutate(input);
  };
  const errors = [
    batchUpdate.error,
    reorder.error,
    updateLevel.error,
    createLevel.error,
  ].filter((error) => error && !queuedApprovalId(error));
  const importFailure =
    importError ??
    (!queuedApprovalId(importSubjects.error)
      ? importSubjects.error?.message
      : undefined) ??
    (!queuedApprovalId(importGroups.error)
      ? importGroups.error?.message
      : undefined);
  return (
    <div className="space-y-6">
      {!readOnly && !denied && review.dialog}
      <div>
        <h1 className="page-title">{t("title")}</h1>
        <p className="muted mt-1">{t("intro")}</p>
      </div>
      <QueryFeedback
        hasData={!!catalogue}
        loading={!catalogue && !readFailure && !missingRead}
        error={denied || !!readFailure || missingRead}
        retrying={refreshing}
        loadingTitle={t("loading")}
        errorTitle={t(
          denied
            ? "accessDenied"
            : acceptedSave
              ? "savedRefreshFailed"
              : catalogue
                ? "refreshFailed"
                : "loadFailed",
        )}
        errorDetail={readFailure?.message}
        retryLabel={t("retry")}
        onRetry={() => void refreshCatalogue()}
      />
      {acceptedSave && !readFailure && (
        <p role="status">{t("savedRefreshing")}</p>
      )}
      {catalogue && (
        <>
          {Object.values(queuedIntents).map((approvalId) => (
            <p key={approvalId} role="status" className="card p-4">
              {reviewText("queued")}{" "}
              <Link
                className="link inline-flex min-h-11 items-center lg:min-h-8"
                href={`/admin/approvals?request=${encodeURIComponent(approvalId)}`}
              >
                {reviewText("viewRequest")}
              </Link>
            </p>
          ))}
          {errors.map((error, index) => (
            <p key={index} role="alert" className="card p-4 text-red-600">
              {error!.message}
            </p>
          ))}
          <section
            className="card space-y-4 p-4 sm:p-5"
            aria-labelledby="levels-heading"
          >
            <div>
              <h2 id="levels-heading" className="section-title">
                {t("levels")}
              </h2>
              <p className="text-accent-700 mt-1 font-medium">
                {t("direction")}
              </p>
              <p className="muted mt-1 text-sm">{t("snapshotHelp")}</p>
              <p id="subject-level-save-help" className="muted mt-1 text-xs">
                {saveText("blur")}
              </p>
            </div>
            <ol className="space-y-3">
              {catalogue.levels.map((level, index) => (
                <li
                  key={level.id}
                  className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-3"
                >
                  <span className="flex min-h-11 items-center font-semibold text-slate-500 lg:min-h-9">
                    {index + 1}
                  </span>
                  <label className="min-w-28 flex-1">
                    <span className="label">{t("levelName")}</span>
                    <input
                      aria-label={t("levelLabel", { name: level.name })}
                      className="input min-h-11 w-full lg:min-h-9"
                      aria-describedby="subject-level-save-help"
                      defaultValue={level.name}
                      readOnly={writesBlocked}
                      onBlur={(e) => {
                        if (
                          e.target.value.trim() &&
                          e.target.value.trim() !== level.name
                        ) {
                          const input = {
                            id: level.id,
                            name: e.target.value.trim(),
                          };
                          if (admit("updateSubjectLevel", input))
                            updateLevel.mutate(input);
                        }
                      }}
                    />
                  </label>
                  <label className="min-w-28 flex-1">
                    <span className="label">{t("prefix")}</span>
                    <input
                      aria-label={t("prefixLabel", { name: level.name })}
                      className="input min-h-11 w-full lg:min-h-9"
                      aria-describedby="subject-level-save-help"
                      defaultValue={level.prefix}
                      readOnly={writesBlocked}
                      onBlur={(e) => {
                        if (e.target.value.trim() !== level.prefix) {
                          const input = {
                            id: level.id,
                            prefix: e.target.value.trim(),
                          };
                          if (admit("updateSubjectLevel", input))
                            updateLevel.mutate(input);
                        }
                      }}
                    />
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm lg:min-h-9">
                    <input
                      type="checkbox"
                      checked={level.apScored}
                      disabled={writesBlocked || updateLevel.isPending}
                      onChange={(e) => {
                        const input = {
                          id: level.id,
                          apScored: e.target.checked,
                        };
                        if (admit("updateSubjectLevel", input))
                          updateLevel.mutate(input);
                      }}
                    />
                    {t("apScore")}
                  </label>
                  {!readOnly && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="btn-secondary min-h-11 lg:min-h-9"
                        aria-label={t("moveUp", { name: level.name })}
                        disabled={
                          writesBlocked || index === 0 || reorder.isPending
                        }
                        onClick={() => move("levels", index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="btn-secondary min-h-11 lg:min-h-9"
                        aria-label={t("moveDown", { name: level.name })}
                        disabled={
                          writesBlocked ||
                          index === catalogue.levels.length - 1 ||
                          reorder.isPending
                        }
                        onClick={() => move("levels", index, 1)}
                      >
                        ↓
                      </button>
                      <button
                        className="btn-secondary min-h-11 lg:min-h-9"
                        disabled={writesBlocked || review.blocked(level.id)}
                        onClick={() => {
                          if (writesBlocked || admission.current) return;
                          review.open({
                            key: level.id,
                            title: reviewText("levelTitle", {
                              name: level.name,
                            }),
                            description: reviewText("levelHelp"),
                            confirmLabel: t("remove"),
                            commit: async () => {
                              if (
                                !admit("deleteSubjectLevel", { id: level.id })
                              )
                                throw new Error(t("refreshFailed"));
                              try {
                                return await removeLevel.mutateAsync({
                                  id: level.id,
                                });
                              } finally {
                                release();
                              }
                            },
                            refresh: () =>
                              settleRefreshes([
                                () =>
                                  invalidateAndReport(utils.admin.courseGroups),
                                () =>
                                  invalidateAndReport(
                                    utils.admin.subjectLevels,
                                  ),
                                () => invalidateAndReport(utils.admin.subjects),
                              ]),
                            approvalId: queuedApprovalId,
                          });
                        }}
                      >
                        {t("remove")}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {!readOnly && (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const input = {
                    name: newLevel,
                    rank:
                      Math.max(-1, ...(levels.data ?? []).map((l) => l.rank)) +
                      1,
                  };
                  if (!newLevel.trim() || !admit("createSubjectLevel", input))
                    return;
                  createLevel.mutate(input);
                }}
              >
                <label className="min-w-28 flex-1">
                  <span className="label">{t("newLevel")}</span>
                  <input
                    className="input min-h-11 w-full lg:min-h-9"
                    required
                    maxLength={60}
                    value={newLevel}
                    disabled={writesBlocked}
                    onChange={(e) => setNewLevel(e.target.value)}
                  />
                </label>
                <button
                  className="btn-secondary min-h-11 lg:min-h-9"
                  disabled={
                    writesBlocked || !newLevel.trim() || createLevel.isPending
                  }
                >
                  {t("addLevel")}
                </button>
              </form>
            )}
          </section>
          {/* The server owns the level-first signup order; filters retain it. */}
          <CourseCatalogueTable
            viewReady={viewReady && !readFailure && !missingRead}
            viewEnabled={!denied}
            ownsPageScroll
            subjects={catalogue.variants}
            levels={catalogue.levels}
            readOnly={readOnly}
            pending={writesBlocked || batchUpdate.isPending}
            onApply={async (input) => {
              if (!admit("batchUpdateSubjects", input))
                throw new Error(t("refreshFailed"));
              await batchUpdate.mutateAsync(input);
            }}
          />
          <section className="space-y-4" aria-labelledby="groups-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="groups-heading" className="section-title">
                {t("groups")}
              </h2>
              {!readOnly && (
                <button
                  className="btn-primary min-h-11 lg:min-h-9"
                  disabled={writesBlocked}
                  onClick={() => setEditing("new")}
                >
                  {t("addGroup")}
                </button>
              )}
            </div>
            {editing === "new" && (
              <div className="card p-4 sm:p-5">
                <GroupEditor
                  levels={catalogue.levels}
                  variants={catalogue.variants}
                  done={() => setEditing(null)}
                  invalidate={invalidate}
                  blocked={writesBlocked}
                  admit={admit}
                  release={release}
                  onQueued={acceptQueued}
                  isQueued={isQueued}
                />
              </div>
            )}
            {catalogue.groups.map((group, index) => (
              <article className="card space-y-3 p-4 sm:p-5" key={group.id}>
                <div className="grid items-center gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0 space-y-3">
                    <h3 className="font-semibold">{group.name}</h3>
                    {editing !== group.id && (
                      <ul className="flex flex-wrap gap-2">
                        {group.subjects.map((subject) => (
                          <li className="badge-slate" key={subject.id}>
                            {subject.name}
                            {!subject.active && ` · ${t("inactive")}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {!readOnly && (
                    <div className="flex gap-2">
                      <button
                        className="btn-secondary min-h-11 lg:min-h-9"
                        aria-label={t("moveUp", { name: group.name })}
                        disabled={
                          writesBlocked || index === 0 || reorder.isPending
                        }
                        onClick={() => move("groups", index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="btn-secondary min-h-11 lg:min-h-9"
                        aria-label={t("moveDown", { name: group.name })}
                        disabled={
                          writesBlocked ||
                          index === catalogue.groups.length - 1 ||
                          reorder.isPending
                        }
                        onClick={() => move("groups", index, 1)}
                      >
                        ↓
                      </button>
                      <button
                        className="btn-secondary min-h-11 lg:min-h-9"
                        disabled={writesBlocked}
                        onClick={() => setEditing(group.id)}
                      >
                        {t("edit")}
                      </button>
                    </div>
                  )}
                </div>
                {editing === group.id ? (
                  <GroupEditor
                    group={group}
                    levels={catalogue.levels}
                    variants={catalogue.variants}
                    done={() => setEditing(null)}
                    invalidate={invalidate}
                    blocked={writesBlocked}
                    admit={admit}
                    release={release}
                    onQueued={acceptQueued}
                    isQueued={isQueued}
                  />
                ) : null}
              </article>
            ))}
            {catalogue.groups.length === 0 && !readFailure && !missingRead && (
              <p className="card p-5 text-slate-500">{t("empty")}</p>
            )}
          </section>
          {!readOnly && (
            <section className="card space-y-3 p-4">
              <h2 className="section-title">{t("import")}</h2>
              <p className="muted text-sm">{t("importHelp")}</p>
              <a
                className="link inline-flex min-h-11 items-center"
                href="/examples/course-groups.json"
                download
              >
                {t("importExample")}
              </a>
              <label className="block">
                <span className="label">{t("importFile")}</span>
                <input
                  className="min-h-11 max-w-full"
                  type="file"
                  accept=".json,application/json,.csv,text/csv"
                  disabled={
                    writesBlocked ||
                    readingImport ||
                    importSubjects.isPending ||
                    importGroups.isPending
                  }
                  onChange={async (event) => {
                    const input = event.currentTarget;
                    const file = input.files?.[0];
                    if (!file) return;
                    if (
                      !admit("readImport", { name: file.name, size: file.size })
                    )
                      return;
                    setImportError(null);
                    setImportMessage("");
                    importSubjects.reset();
                    importGroups.reset();
                    setReadingImport(true);
                    let submitted = false;
                    try {
                      if (file.size > MAX_IMPORT_BYTES)
                        throw new Error(t("importTooLarge"));
                      const text = await file.text();
                      if (!availability.current) return;
                      if (file.name.toLowerCase().endsWith(".json")) {
                        const input = parseCourseImport(text);
                        if (isQueued("importCourseGroups", input)) return;
                        admittedIntent.current = catalogueIntent(
                          "importCourseGroups",
                          input,
                        );
                        importGroups.mutate(input);
                        submitted = true;
                      } else if (file.name.toLowerCase().endsWith(".csv")) {
                        const rows = text
                          .split(/\r?\n/)
                          .map((line) =>
                            line.split(",").map((cell) => cell.trim()),
                          )
                          .filter(
                            ([name]) => name && name.toLowerCase() !== "name",
                          )
                          .map(([name, level]) => ({
                            name: name!,
                            level: level ?? undefined,
                          }));
                        if (!rows.length) throw new Error(t("importEmpty"));
                        const input = { subjects: rows };
                        if (isQueued("importSubjects", input)) return;
                        admittedIntent.current = catalogueIntent(
                          "importSubjects",
                          input,
                        );
                        importSubjects.mutate(input);
                        submitted = true;
                      } else throw new Error(t("importFileType"));
                    } catch (error) {
                      setImportError(
                        t("importInvalid", {
                          detail:
                            error instanceof Error
                              ? error.message
                              : String(error),
                        }),
                      );
                    } finally {
                      // Reset even after a failure so selecting the same corrected file triggers change.
                      input.value = "";
                      setReadingImport(false);
                      if (!submitted) release();
                    }
                  }}
                />
              </label>
              {importMessage && <p role="status">{importMessage}</p>}
              {importFailure && (
                <p role="alert" className="text-sm break-words text-red-600">
                  {importFailure}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
