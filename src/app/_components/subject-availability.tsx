"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { tutorSubjectRows } from "~/lib/subject-availability";
import { sortTutorSubjectRows } from "~/lib/subject-display-order";
import { DisclosureIcon } from "./icons";
import { Button, ChoiceButton } from "./ui/button";
import { FilterToolbar, InlineNotice } from "./ui/patterns";
import { ProfileDialog } from "./profile-dialog";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { useSessionPageScroll, useSessionViewState } from "./session-view-state";
import { viewEnum, viewSearch } from "~/lib/session-view-state";

export function SubjectAvailability() {
  const t = useTranslations("subjectAvailability");
  const workflow = useTranslations("workflows");
  const ui = useTranslations("uiPatterns");
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const data = api.subjectAvailability.options.useQuery(undefined, {
    enabled: !denied,
  });
  const authorizationDenied =
    data.error?.data?.code === "FORBIDDEN" ||
    data.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    if (authorizationDenied) {
      setDenied(true);
      // Retaining cached content for ordinary failures must never revive revoked
      // staff evidence during a later transport failure or a reopened feature.
      queryClient.removeQueries({
        queryKey: getQueryKey(api.subjectAvailability.options),
        exact: false,
      });
    } else if (data.isSuccess && !data.isFetching) setDenied(false);
  }, [authorizationDenied, data.isSuccess, data.isFetching, queryClient]);
  const utils = api.useUtils();
  const [editing, setEditing] = useState<{
    tutorId: string;
    subjectId: string;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const admitted = useRef(false);
  // Accepted writes recover only through reads; a failed synchronization cannot replay them.
  const refresh = async () => {
    setRefreshing(true);
    try {
      await settleRefreshes([
        () => invalidateAndReport(utils.subjectAvailability.options),
        () => invalidateAndReport(utils.admin.subjectEligibility),
      ]);
      setRefreshFailed(false);
      admitted.current = false;
    } catch {
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
    }
  };
  // Retain the qualification mutation path so queued approvals and replay remain valid.
  const qualify = api.interviewManagement.qualify.useMutation({
    onSuccess: refresh,
    onError: () => {
      admitted.current = false;
    },
  });
  const willingness = api.subjectAvailability.setWillingness.useMutation({
    onSuccess: refresh,
    onError: () => {
      admitted.current = false;
    },
  });
  const viewEnabled = !denied && !authorizationDenied;
  const [search, setSearch] = useSessionViewState({ id: "subject-availability.search.v1", initialState: "", parse: viewSearch, enabled: viewEnabled });
  const [filter, setFilter] = useSessionViewState({ id: "subject-availability.filter.v1", initialState: "ALL", parse: viewEnum(["ALL", "QUALIFIED", "WILLING", "AVAILABLE"]), enabled: viewEnabled });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Each expanded tutor owns one toggle filter; selecting it again restores all rows.
  const [tutorFilters, setTutorFilters] = useSessionViewState<Record<string, string | null>>({
    id: "subject-availability.tutor-filters.v1", initialState: {}, enabled: viewEnabled,
    restoreReady: !!data.data,
    parse: (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const ids = new Set((data.data?.tutors ?? []).map((tutor) => tutor.id));
      // Bound recent per-tutor choices; removed tutors cannot reappear from storage.
      return Object.fromEntries(Object.entries(value).filter(([id, choice]) =>
        ids.has(id) && (choice === null || ["qualified", "pendingReview", "willing"].includes(String(choice))),
      ).slice(-20)) as Record<string, string | null>;
    },
  });
  useSessionPageScroll({ id: "subject-availability", scope: JSON.stringify([search, filter, tutorFilters]), ready: !!data.data, enabled: viewEnabled });
  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  if (denied || authorizationDenied || (data.error && !data.data))
    return (
      <div className="space-y-3">
        <p role="alert">{data.error?.message ?? ui("loadFailed")}</p>
        <Button
          size="compact"
          disabled={
            data.isFetching ||
            qualify.isPending ||
            willingness.isPending ||
            refreshing
          }
          onClick={() => void data.refetch()}
        >
          {ui("retry")}
        </Button>
      </div>
    );
  if (!data.data) return <p role="status">{workflow("loading")}</p>;
  const {
    tutors,
    subjects,
    qualifications,
    grants,
    willingness: intents,
    pendingRequests,
  } = data.data;
  const needle = search.trim().toLocaleLowerCase();
  const groups = tutors
    .map((tutor) => ({
      ...tutor,
      rows: tutorSubjectRows(
        tutor.id,
        subjects,
        qualifications,
        grants,
        intents,
      ),
    }))
    .filter(
      (tutor) =>
        tutor.status === "ACTIVE" ||
        tutor.rows.some(
          (row) =>
            row.qualification !== null || row.willing !== null || row.qualified,
        ),
    )
    .map((tutor) => ({
      ...tutor,
      visible: tutor.rows.filter(
        (row) =>
          (!needle ||
            [
              tutor.englishName,
              row.name,
              row.group?.name ?? "",
              row.level?.name ?? "",
            ].some((text) => text.toLocaleLowerCase().includes(needle))) &&
          (filter === "ALL" ||
            (filter === "QUALIFIED" && row.qualified) ||
            (filter === "WILLING" && row.willing === true) ||
            (filter === "AVAILABLE" &&
              row.qualified &&
              row.willing === true &&
              row.active &&
              tutor.status === "ACTIVE" &&
              !tutor.user?.tutorAccessRevoked)),
      ),
    }))
    .filter(
      (tutor) => tutor.visible.length > 0 || (!needle && filter === "ALL"),
    );
  const pending = qualify.isPending || willingness.isPending || refreshing;
  const locked = pending || refreshFailed || !!data.error;
  return (
    <div className="space-y-4 max-lg:[&_button]:min-h-11 max-lg:[&_input]:min-h-11 max-lg:[&_select]:min-h-11">
      <div className="card grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label>
          <span className="label">{t("search")}</span>
          <input
            className="input w-full"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span className="label">{t("filter")}</span>
          <select
            className="select w-full"
            value={filter}
            onChange={(event) => setFilter(event.target.value as typeof filter)}
          >
            <option value="ALL">{t("all")}</option>
            <option value="QUALIFIED">{t("qualified")}</option>
            <option value="WILLING">{t("willing")}</option>
            <option value="AVAILABLE">{t("available")}</option>
          </select>
        </label>
      </div>
      {data.error && (
        <InlineNotice
          tone="warning"
          announcement="alert"
          action={
            <Button
              size="compact"
              disabled={pending || data.isFetching}
              onClick={() => void data.refetch()}
            >
              {ui("retry")}
            </Button>
          }
        >
          {data.error.message}
        </InlineNotice>
      )}
      {(qualify.error ?? willingness.error) && (
        <p role="alert">{(qualify.error ?? willingness.error)?.message}</p>
      )}
      {(qualify.isSuccess || willingness.isSuccess) && (
        <p role="status">{workflow("saved")}</p>
      )}
      {groups.map((tutor) => {
        const open = expanded.has(tutor.id);
        const id = `subject-availability-${tutor.id}`;
        const selected = tutorFilters[tutor.id] ?? null;
        const visible = sortTutorSubjectRows(
          tutor.visible.filter((row) =>
            selected === "qualified"
              ? row.qualified
              : selected === "pendingReview"
                ? row.qualification === "PENDING" ||
                  pendingRequests.some(
                    (request) =>
                      request.requestedTutorId === tutor.id &&
                      request.requestedSubjectId === row.id,
                  )
                : selected === "willing"
                  ? row.willing === true
                  : true,
          ),
        );
        return (
          <section className="card overflow-hidden" key={tutor.id}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => toggle(tutor.id)}
              className="flex min-h-11 w-full items-center gap-3 p-4 text-left"
            >
              <DisclosureIcon open={open} />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span className="block font-semibold">{tutor.englishName}</span>{" "}
                <span className="muted mt-1 block text-sm">
                  {t("summary", {
                    qualified: tutor.rows.filter((row) => row.qualified).length,
                    willing: tutor.rows.filter((row) => row.willing === true)
                      .length,
                  })}
                </span>
              </span>
              {(tutor.status !== "ACTIVE" ||
                tutor.user?.tutorAccessRevoked) && (
                <span className="badge-slate">{t("inactiveTutor")}</span>
              )}
            </button>
            {/* Mount only expanded catalogues; large rosters should not create hidden form trees. */}
            {open && (
              <div id={id} className="space-y-3 border-t border-slate-100 p-4">
                <FilterToolbar
                  label={t("filtersFor", { name: tutor.englishName })}
                >
                  <div
                    role="group"
                    aria-label={t("filtersFor", { name: tutor.englishName })}
                    className="flex flex-wrap gap-2 lg:justify-end"
                  >
                    {(["qualified", "pendingReview", "willing"] as const).map(
                      (value) => (
                        <ChoiceButton
                          key={value}
                          selected={selected === value}
                          onClick={() =>
                            setTutorFilters((previous) => ({
                              ...previous,
                              [tutor.id]:
                                previous[tutor.id] === value ? null : value,
                            }))
                          }
                        >
                          {t(value)}
                        </ChoiceButton>
                      ),
                    )}
                  </div>
                </FilterToolbar>
                {visible.map((row) => (
                  <article
                    key={row.id}
                    className="grid items-center gap-3 rounded-lg border border-slate-200 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                    aria-label={row.name}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="font-semibold [overflow-wrap:anywhere]">
                        {row.name}
                      </h3>
                      {row.level && (
                        <span className="badge-slate">{row.level.name}</span>
                      )}
                      {!row.active && (
                        <span className="badge-slate mt-2">
                          {t("inactiveSubject")}
                        </span>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span
                        className={
                          row.qualified ? "badge-green" : "badge-slate"
                        }
                      >
                        {t(row.qualified ? "qualified" : "notQualified")}
                      </span>
                      {row.qualified && (
                        <span
                          className={
                            row.willing === true ? "badge-green" : "badge-slate"
                          }
                        >
                          {t(
                            row.willing === null
                              ? "notRecorded"
                              : row.willing
                                ? "willing"
                                : "notWilling",
                          )}
                        </span>
                      )}
                    </div>
                    <Button
                      size="compact"
                      aria-haspopup="dialog"
                      onClick={() =>
                        setEditing({ tutorId: tutor.id, subjectId: row.id })
                      }
                    >
                      {t("edit")}
                    </Button>
                  </article>
                ))}
                {visible.length === 0 && (
                  <p role="status" className="muted">
                    {t("noMatchingSubjects")}
                  </p>
                )}
              </div>
            )}
          </section>
        );
      })}
      {/* The editor lives above filtered rows: changing filters cannot destroy admitted work. */}
      {editing &&
        (() => {
          const tutor = tutors.find((entry) => entry.id === editing.tutorId);
          const row = tutorSubjectRows(
            editing.tutorId,
            subjects,
            qualifications,
            grants,
            intents,
          ).find((entry) => entry.id === editing.subjectId);
          if (!tutor || !row) return null;
          return (
            <ProfileDialog
              title={t("editTitle", {
                tutor: tutor.englishName,
                subject: row.name,
              })}
              pending={pending}
              onClose={() => {
                if (!pending) setEditing(null);
              }}
            >
              <div className="space-y-4">
                {data.error && (
                  <InlineNotice
                    tone="warning"
                    announcement="alert"
                    action={
                      <Button
                        size="compact"
                        disabled={pending || data.isFetching}
                        onClick={() => void data.refetch()}
                      >
                        {ui("retry")}
                      </Button>
                    }
                  >
                    {data.error.message}
                  </InlineNotice>
                )}
                <p className="text-sm text-slate-600">
                  {row.group?.name ?? t("ungrouped")}
                  {row.level ? " · " + row.level.name : ""}
                </p>
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
                {(qualify.error ?? willingness.error) && (
                  <p role="alert">
                    {(qualify.error ?? willingness.error)?.message}
                  </p>
                )}
                <div className="space-y-2">
                  <p className="label">{t("qualification")}</p>
                  <span
                    className={row.qualified ? "badge-green" : "badge-slate"}
                  >
                    {t(row.qualified ? "qualified" : "notQualified")}
                  </span>
                  {row.qualification && (
                    <p className="text-sm">
                      {t("sourceStatus", {
                        status: t(`status.${row.qualification}`),
                      })}
                    </p>
                  )}
                  {row.inheritedFrom.length > 0 && (
                    <p className="muted text-sm">
                      {t("inherited", {
                        subjects: row.inheritedFrom.join(", "),
                      })}
                    </p>
                  )}
                  <div>
                    {row.qualification === "APPROVED" ? (
                      <button
                        className="btn-secondary btn-sm"
                        disabled={locked}
                        onClick={() => {
                          if (locked || admitted.current) return;
                          admitted.current = true;
                          qualify.mutate({
                            tutorId: tutor.id,
                            subjectId: row.id,
                            qualified: false,
                          });
                        }}
                      >
                        {t("removeSource")}
                      </button>
                    ) : (
                      row.active &&
                      tutor.status === "ACTIVE" && (
                        <button
                          className="btn-secondary btn-sm"
                          disabled={locked}
                          onClick={() => {
                            if (locked || admitted.current) return;
                            admitted.current = true;
                            qualify.mutate({
                              tutorId: tutor.id,
                              subjectId: row.id,
                              qualified: true,
                            });
                          }}
                        >
                          {t("approveSource")}
                        </button>
                      )
                    )}
                  </div>
                </div>
                <div>
                  <label>
                    <span className="label">{t("willingness")}</span>
                    <select
                      className="select w-full"
                      aria-label={t("willingnessFor", {
                        subject: row.name,
                      })}
                      value={
                        row.willing === null
                          ? "UNKNOWN"
                          : row.willing
                            ? "YES"
                            : "NO"
                      }
                      disabled={locked}
                      onChange={(event) => {
                        if (
                          locked ||
                          admitted.current ||
                          event.target.value === "UNKNOWN"
                        )
                          return;
                        admitted.current = true;
                        willingness.mutate({
                          tutorId: tutor.id,
                          subjectId: row.id,
                          willing: event.target.value === "YES",
                        });
                      }}
                    >
                      <option value="UNKNOWN" disabled>
                        {t("notRecorded")}
                      </option>
                      <option value="YES" disabled={!row.active}>
                        {t("willing")}
                      </option>
                      <option value="NO">{t("notWilling")}</option>
                    </select>
                  </label>
                  <p className="muted mt-2 text-xs">{t("independent")}</p>
                </div>
              </div>
            </ProfileDialog>
          );
        })()}
      {groups.length === 0 && <p className="muted card p-4">{t("empty")}</p>}
    </div>
  );
}
