"use client";
import { participantNameLabel } from "./participant-name";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { navigateNotificationFragment } from "~/lib/notification-navigation";
import { useTranslations, useFormatter } from "next-intl";
import { FilterToolbar, InlineNotice } from "./ui/patterns";
import { Button } from "./ui/button";
import {
  InterviewCompletionReview,
  InterviewWorkflowStatus,
  type InterviewRecord,
  type CompletionDraft,
} from "./interview-completion-review";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { api } from "~/trpc/react";
import { DisclosureIcon } from "./icons";
import { InvalidityBadge, InvalidityNotice } from "./request-invalidity";
import {
  useSessionAccessDenied,
  useSessionViewState,
} from "./session-view-state";
import { viewEnum, viewPage, viewSearch } from "~/lib/session-view-state";

/** Opaque IDs stay in an encoded fragment and a parameterized API read. Reject
 * malformed/unbounded links before mounting a private completion reader. */
function completionArrivalId(hash: string) {
  const match = /^#interview-completion-([A-Za-z0-9_.!~*'()%-]{1,2048})$/.exec(
    hash,
  );
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]!);
    const printable = [...id].every(
      (character) =>
        character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    );
    return id.trim() && id.length <= 200 && printable ? id : null;
  } catch {
    return null;
  }
}

/** Explicit disclosure state survives filtering; form state stays mounted while collapsed. */
function InterviewDisclosure({
  id,
  open,
  toggle,
  summary,
  children,
}: {
  id: string;
  open: boolean;
  toggle: () => void;
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className="flex w-full min-w-0 items-start gap-3 p-4 text-left hover:bg-slate-50"
      >
        <span className="mt-1 shrink-0">
          <DisclosureIcon open={open} />
        </span>{" "}
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {summary}
        </span>
      </button>
      <div id={id} hidden={!open} className="border-t border-slate-100 p-4">
        {children}
      </div>
    </div>
  );
}

export function InterviewManagement({
  enabled = true,
  hoursEnabled = true,
  onViewReadyChange,
}: {
  enabled?: boolean;
  hoursEnabled?: boolean;
  onViewReadyChange?: (ready: boolean, scope: string, denied: boolean) => void;
}) {
  const t = useTranslations("workflows");
  const allT = useTranslations();
  const format = useFormatter();
  const [review, setReview] = useState<InterviewRecord | null>(null);
  const [arrival, setArrival] = useState<{
    id: string;
    sequence: number;
  } | null>(null);
  const [arrivalError, setArrivalError] = useState<string | null>(null);
  const arrivalSequence = useRef(0);
  const attemptedArrival = useRef(0);
  const [opening, setOpening] = useState<string | null>(null);
  const openingRef = useRef<string | null>(null);
  const evidenceGeneration = useRef(0);
  const readAvailableRef = useRef(false);
  const [evidenceError, setEvidenceError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, CompletionDraft | undefined>
  >({});
  const utils = api.useUtils();
  const [accessDenied, setAccessDenied] = useState(false);
  const concealAccess = useCallback(() => {
    // A delayed evidence response from before denial must never reopen a reader.
    evidenceGeneration.current += 1;
    arrivalSequence.current += 1;
    setArrival(null);
    setArrivalError(null);
    openingRef.current = null;
    setOpening(null);
    setEvidenceError(null);
    setReview(null);
    setDrafts({});
    setAccessDenied(true);
  }, []);
  const [recovering, setRecovering] = useState(false);
  const recoveringRef = useRef(false);
  const [page, setPage] = useSessionViewState({
    id: "interviews.page.v1",
    initialState: 0,
    parse: viewPage,
    enabled: !accessDenied,
  });
  const [search, setSearch] = useSessionViewState({
    id: "interviews.search.v1",
    initialState: "",
    parse: viewSearch,
    enabled: !accessDenied,
  });
  const [searchEditor, setSearchEditor] = useState({
    source: search,
    value: search,
  });
  // Restored/applied search owns this input; unrelated filter reads retain edits.
  if (searchEditor.source !== search) {
    setSearchEditor({ source: search, value: search });
  }
  const searchDraft = searchEditor.value;
  const setSearchDraft = (value: string) =>
    setSearchEditor({ source: search, value });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [completion, setCompletion] = useSessionViewState({
    id: "interviews.completion.v1",
    initialState: "OPEN",
    parse: viewEnum(["OPEN", "COMPLETED", "ALL"]),
    enabled: !accessDenied,
  });
  const [status, setStatus] = useSessionViewState({
    id: "interviews.status.v1",
    initialState: "",
    parse: viewEnum([
      "",
      "PENDING",
      "INTERVIEW",
      "ACCEPTED",
      "REJECTED",
      "RECALLED",
    ]),
    enabled: !accessDenied,
  });
  const [sort, setSort] = useSessionViewState({
    id: "interviews.sort.v1",
    initialState: "CREATED_DESC",
    parse: viewEnum([
      "COMPLETED_DESC",
      "COMPLETED_ASC",
      "CREATED_DESC",
      "CREATED_ASC",
      "NAME_ASC",
      "NAME_DESC",
    ]),
    enabled: !accessDenied,
  });
  const data = api.interviewManagement.options.useQuery({
    page,
    search,
    completion,
    status,
    sort,
  });
  const denied = useSessionAccessDenied(data);
  const [observedDenied, setObservedDenied] = useState(false);
  // Preserve the explicit-recovery latch after the query helper recovers. Only
  // a new denial transition latches again, so a successful manual read can clear it.
  if (denied !== observedDenied) {
    setObservedDenied(denied);
    if (denied) {
      setArrival(null);
      setArrivalError(null);
      setOpening(null);
      setEvidenceError(null);
      setReview(null);
      setDrafts({});
      setAccessDenied(true);
    }
  }
  const viewReady = !!data.data && !accessDenied && !denied;
  const readAvailable = viewReady && !data.error && !data.isFetching;
  // Conceal in render; fence asynchronous readers at commit before callbacks can
  // publish stale private evidence. Speculative renders must not mutate refs.
  useLayoutEffect(() => {
    if (accessDenied) {
      evidenceGeneration.current += 1;
      arrivalSequence.current += 1;
      openingRef.current = null;
    }
  }, [accessDenied]);
  useLayoutEffect(() => {
    readAvailableRef.current = readAvailable;
  }, [readAvailable]);
  // The parent Applications page owns viewport position; nested history owns only its read controls.
  useEffect(() => {
    onViewReadyChange?.(
      viewReady,
      JSON.stringify([page, search, completion, status, sort]),
      denied || accessDenied,
    );
  }, [
    viewReady,
    page,
    search,
    completion,
    status,
    sort,
    denied,
    accessDenied,
    onViewReadyChange,
  ]);
  const refresh = () =>
    settleRefreshes([
      () => invalidateAndReport(utils.interviewManagement.options),
      () => invalidateAndReport(utils.interviewManagement.completionEvidence),
      () => invalidateAndReport(utils.admin.tutorApplications),
      () => invalidateAndReport(utils.tutor.myInterviews),
      () => invalidateAndReport(utils.admin.registrationCodes),
    ]);
  const openReview = useCallback(
    async (
      application: InterviewRecord | { id: string },
      arrivalRequest?: number,
    ) => {
      const retained = drafts[application.id];
      if (retained?.outcome && retained.evidence) {
        setReview(retained.evidence);
        return true;
      }
      if (openingRef.current || !readAvailableRef.current) return false;
      const generation = ++evidenceGeneration.current;
      const currentRequest = () =>
        generation === evidenceGeneration.current &&
        (arrivalRequest === undefined ||
          arrivalRequest === arrivalSequence.current);
      openingRef.current = application.id;
      setOpening(application.id);
      setEvidenceError(null);
      if (arrivalRequest !== undefined) setArrivalError(null);
      try {
        let record = application as InterviewRecord;
        if (arrivalRequest !== undefined) {
          // Exact source arrivals use an independent read. Saved list filters,
          // page, expanded records and retained drafts remain the user's own view.
          const exact = await utils.interviewManagement.options.fetch(
            {
              applicationId: application.id,
              page: 0,
              search: "",
              completion: "ALL",
              status: "",
              sort: "CREATED_DESC",
            },
            { staleTime: 0 },
          );
          if (!currentRequest()) return false;
          const row = exact.applications.rows.find(
            (candidate) => candidate.id === application.id,
          );
          if (!row) throw new Error(allT("uiPatterns.loadFailed"));
          record = row;
        }
        const current =
          await utils.interviewManagement.completionEvidence.fetch(
            { applicationId: application.id },
            { staleTime: 0 },
          );
        if (!currentRequest()) return false;
        if (current.id !== application.id)
          throw new Error(allT("uiPatterns.loadFailed"));
        if (current.isInvalid || current.status === "RECALLED")
          throw new Error(allT("uiPatterns.loadFailed"));
        if (!readAvailableRef.current)
          throw new Error(
            allT("interviewReview.correctionEvidence.readUnavailable"),
          );
        // Source participants, ledger and version come from this one fresh reader;
        // a background list version must not be merged into its captured evidence.
        setReview({ ...record, ...current });
        return true;
      } catch (caught) {
        if (!currentRequest()) return false;
        const code = (caught as { data?: { code?: string } }).data?.code;
        if (code === "FORBIDDEN" || code === "UNAUTHORIZED") concealAccess();
        else if (arrivalRequest !== undefined)
          setArrivalError(
            caught instanceof Error
              ? caught.message
              : allT("uiPatterns.loadFailed"),
          );
        else
          setEvidenceError({
            id: application.id,
            message:
              caught instanceof Error
                ? caught.message
                : allT("uiPatterns.loadFailed"),
          });
        return false;
      } finally {
        if (generation === evidenceGeneration.current) {
          openingRef.current = null;
          setOpening(null);
        }
      }
    },
    [drafts, utils, allT, concealAccess],
  );
  useEffect(() => {
    const reveal = () => {
      const id = completionArrivalId(window.location.hash);
      const sequence = ++arrivalSequence.current;
      setArrivalError(null);
      setArrival(id ? { id, sequence } : null);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  useEffect(() => {
    if (
      !arrival ||
      attemptedArrival.current === arrival.sequence ||
      !readAvailable ||
      review ||
      opening !== null
    )
      return;
    attemptedArrival.current = arrival.sequence;
    const heading = document.getElementById("interview-heading");
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView?.({ block: "center" });
    void openReview({ id: arrival.id }, arrival.sequence).then((opened) => {
      if (opened && arrivalSequence.current === arrival.sequence) {
        setArrival(null);
        setArrivalError(null);
      }
    });
  }, [arrival, readAvailable, review, opening, openReview]);
  const recoverAccess = async () => {
    if (recoveringRef.current) return;
    recoveringRef.current = true;
    setRecovering(true);
    try {
      // A successful cached read predating revocation is not recovery evidence.
      const result = await data.refetch({ throwOnError: true });
      if (result.error || !result.data)
        throw new Error(allT("uiPatterns.loadFailed"));
      setAccessDenied(false);
    } catch {
      setAccessDenied(true);
    } finally {
      recoveringRef.current = false;
      setRecovering(false);
    }
  };
  if (denied || accessDenied)
    return (
      <div className="space-y-3">
        <p role="alert">{allT("interviewReview.accessDenied")}</p>
        <Button
          disabled={recovering || data.isFetching}
          onClick={() => void recoverAccess()}
        >
          {allT("interviewReview.refreshOnly")}
        </Button>
      </div>
    );
  if (!data.data)
    return data.error ? (
      <p role="alert">
        {data.error.message}{" "}
        <Button onClick={() => void data.refetch()}>
          {allT("interviewReview.refreshOnly")}
        </Button>
      </p>
    ) : (
      <p>{t("loading")}</p>
    );
  const { applications } = data.data;
  const first = applications.total === 0 ? 0 : page * applications.pageSize + 1;
  const last = Math.min(applications.total, (page + 1) * applications.pageSize);
  const date = (value: Date) =>
    format.dateTime(value, { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="space-y-6 max-lg:[&_.input]:min-h-11 max-lg:[&_button]:min-h-11 max-lg:[&_select]:min-h-11">
      {!enabled && (
        <p className="muted card p-4">{t("interviewsDisabledHistory")}</p>
      )}
      {data.error && (
        <InlineNotice
          tone="warning"
          announcement="status"
          action={
            <Button onClick={() => void data.refetch()}>
              {allT("interviewReview.refreshOnly")}
            </Button>
          }
        >
          {allT("uiPatterns.loadFailed")}
        </InlineNotice>
      )}
      <section className="space-y-3" aria-labelledby="interview-heading">
        {opening === arrival?.id && !review && (
          <InlineNotice announcement="status">
            {allT("interviewReview.correctionEvidence.loading")}
          </InlineNotice>
        )}
        {arrivalError && arrival && (
          <InlineNotice
            tone="error"
            announcement="alert"
            action={
              <Button
                disabled={!readAvailable || opening !== null || !!review}
                onClick={() => {
                  setArrivalError(null);
                  setArrival({
                    id: arrival.id,
                    sequence: ++arrivalSequence.current,
                  });
                }}
              >
                {allT("interviewReview.correctionEvidence.retryArrival")}
              </Button>
            }
          >
            {arrivalError}
          </InlineNotice>
        )}
        <h2 id="interview-heading" tabIndex={-1} className="section-title">
          {t("interviewRecords")}
        </h2>
        <div className="card p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setPage(0);
              setSearch(searchDraft.trim());
            }}
          >
            <FilterToolbar
              label={t("interviewFilters")}
              summary={
                <p role="status">
                  {t("interviewCount", {
                    first,
                    last,
                    total: applications.total,
                  })}
                </p>
              }
              actions={
                <Button
                  variant="ghost"
                  size="compact"
                  disabled={
                    !search &&
                    !searchDraft &&
                    completion === "OPEN" &&
                    !status &&
                    sort === "CREATED_DESC"
                  }
                  onClick={() => {
                    // Reset only the read controls. Expanded records and pending
                    // completion drafts retain their independent lifetimes.
                    setPage(0);
                    setSearch("");
                    setSearchDraft("");
                    setCompletion("OPEN");
                    setStatus("");
                    setSort("CREATED_DESC");
                  }}
                >
                  {allT("admin.applications.filters.reset")}
                </Button>
              }
            >
              <label className="min-w-0 flex-[2_1_20rem]">
                <span className="label">{t("interviewSearch")}</span>
                {/* Native controls explicitly retain the toolbar's 32 px desktop
                    baseline; their default 44 px touch target stays intact. */}
                <input
                  type="search"
                  className="input control-compact mt-1 min-h-11 w-full lg:min-h-8 lg:py-1"
                  maxLength={100}
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                />
              </label>
              <label className="min-w-0 flex-[1_1_12rem]">
                <span className="label">{t("interviewFilter")}</span>
                <select
                  className="input control-compact mt-1 min-h-11 w-full lg:min-h-8 lg:py-1"
                  value={completion}
                  onChange={(event) => {
                    setPage(0);
                    setCompletion(event.target.value as typeof completion);
                    // The completed view opens on recent interviews instead of application age.
                    if (
                      event.target.value === "COMPLETED" &&
                      sort === "CREATED_DESC"
                    )
                      setSort("COMPLETED_DESC");
                  }}
                >
                  <option value="OPEN">{t("interviewOpen")}</option>
                  <option value="COMPLETED">{t("interviewCompleted")}</option>
                  <option value="ALL">{t("interviewAll")}</option>
                </select>
              </label>
              <label className="min-w-0 flex-[1_1_12rem]">
                <span className="label">
                  {allT("admin.applications.filters.status")}
                </span>
                <select
                  className="input control-compact mt-1 min-h-11 w-full lg:min-h-8 lg:py-1"
                  value={status}
                  onChange={(event) => {
                    setPage(0);
                    setStatus(event.target.value as typeof status);
                  }}
                >
                  <option value="">
                    {allT("admin.applications.filters.allStatuses")}
                  </option>
                  {(
                    [
                      "PENDING",
                      "INTERVIEW",
                      "ACCEPTED",
                      "REJECTED",
                      "RECALLED",
                    ] as const
                  ).map((choice) => (
                    <option key={choice} value={choice}>
                      {allT(`admin.applications.status.${choice}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 flex-[1_1_14rem]">
                <span className="label">
                  {allT("admin.applications.filters.sort")}
                </span>
                <select
                  className="input control-compact mt-1 min-h-11 w-full lg:min-h-8 lg:py-1"
                  value={sort}
                  onChange={(event) => {
                    // Read preferences never replace the unsubmitted search or completion drafts.
                    setPage(0);
                    setSort(event.target.value as typeof sort);
                  }}
                >
                  {(
                    [
                      "CREATED_DESC",
                      "CREATED_ASC",
                      "COMPLETED_DESC",
                      "COMPLETED_ASC",
                      "NAME_ASC",
                      "NAME_DESC",
                    ] as const
                  ).map((choice) => (
                    <option key={choice} value={choice}>
                      {allT(`admin.applications.filters.sortOptions.${choice}`)}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="compact" type="submit">
                {t("searchInterviews")}
              </Button>
            </FilterToolbar>
          </form>
        </div>
        {applications.rows.map((a) => {
          // Application identity keeps unrelated people with matching names separate.
          const id = `interview-${a.id}`;
          // Pending workflow labels need readable names; completed interview evidence stays raw.
          const currentName = (name: string) =>
            a.interviewCompletedAt
              ? name
              : participantNameLabel(
                  name,
                  undefined,
                  allT("participantNames.unnamed"),
                );
          const chair = a.interviewers.find((panelist) => panelist.isHead);
          return (
            <InterviewDisclosure
              key={id}
              id={id}
              open={expanded.has(id)}
              toggle={() => toggle(id)}
              summary={
                <>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{currentName(a.name)}</span>{" "}
                    {a.isInvalid && <InvalidityBadge />}
                    <span
                      className={
                        a.interviewCompletedAt ? "badge-green" : "badge-amber"
                      }
                    >
                      {t(
                        a.interviewCompletedAt
                          ? "interviewCompleted"
                          : "interviewOpen",
                      )}
                    </span>{" "}
                    <span className="badge-slate">
                      {allT(`admin.applications.status.${a.status}`)}
                    </span>
                  </span>{" "}
                  <span className="muted mt-2 block text-sm">
                    {a.subjectIntents
                      .map((intent) => intent.subject.name)
                      .join(" · ") || t("noInterviewSubjects")}
                  </span>{" "}
                  <span className="mt-1 block text-sm">
                    {t("panelSummaryNames", {
                      names:
                        a.interviewers
                          .map((panelist) =>
                            currentName(panelist.tutor.englishName),
                          )
                          .join(", ") || t("unassignedPanel"),
                    })}
                  </span>{" "}
                  <span className="muted mt-1 block text-sm">
                    {t("chairSummary", {
                      name: chair
                        ? currentName(chair.tutor.englishName)
                        : t("unassignedPanel"),
                    })}
                  </span>{" "}
                  <span className="muted mt-1 block text-sm">
                    {t("scheduleSummary", {
                      date: a.interviewAt
                        ? date(a.interviewAt)
                        : t("unscheduled"),
                    })}
                  </span>
                  {a.interviewCompletedAt && (
                    <span className="mt-1 block text-sm">
                      {t("completionSummary", {
                        date: date(a.interviewCompletedAt),
                        minutes: a.interviewDurationMin ?? 0,
                      })}
                    </span>
                  )}
                </>
              }
            >
              <Link
                href={`/admin/applications#application-${a.id}`}
                scroll={false}
                // Next changes fragments without hashchange. Reuse the record
                // adapter handoff, including repeated fragments and native modifiers.
                onNavigate={(event) =>
                  navigateNotificationFragment(
                    `/admin/applications#application-${a.id}`,
                    event,
                  )
                }
                className="link inline-flex min-h-11 items-center text-sm lg:min-h-8"
              >
                {t("manageApplicantPanel")}
              </Link>
              <InterviewWorkflowStatus application={a} />
              {a.isInvalid ? (
                <div className="mt-3">
                  <InvalidityNotice />
                </div>
              ) : !a.interviewCompletedAt && a.interviewers.length === 0 ? (
                <p className="muted mt-3 text-sm">{t("panelRequired")}</p>
              ) : enabled && a.status !== "RECALLED" ? (
                <Button
                  variant="primary"
                  className="mt-4"
                  disabled={
                    !hoursEnabled ||
                    a.pendingCompletion ||
                    (!drafts[a.id]?.outcome &&
                      (!readAvailable || opening !== null))
                  }
                  onClick={() => void openReview(a)}
                >
                  {opening === a.id
                    ? allT("interviewReview.correctionEvidence.loading")
                    : allT(
                        drafts[a.id]?.outcome
                          ? "interviewReview.refreshOnly"
                          : a.interviewCompletedAt
                            ? "interviewReview.correct"
                            : "interviewReview.record",
                      )}
                </Button>
              ) : null}
              {evidenceError?.id === a.id && (
                <InlineNotice
                  tone="error"
                  announcement="alert"
                  action={
                    <Button
                      disabled={!readAvailable || opening !== null}
                      onClick={() => void openReview(a)}
                    >
                      {allT("interviewReview.refreshOnly")}
                    </Button>
                  }
                >
                  {evidenceError.message}
                </InlineNotice>
              )}
            </InterviewDisclosure>
          );
        })}
        {applications.rows.length === 0 && (
          <p className="muted card p-6 text-center">{t("interviewEmpty")}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            size="compact"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            {t("previous")}
          </Button>
          <Button
            size="compact"
            disabled={last >= applications.total}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("next")}
          </Button>
        </div>
      </section>
      {Object.entries(drafts)
        .filter(([, draft]) => draft?.outcome && draft.evidence)
        .map(([id, draft]) => (
          <InlineNotice
            key={id}
            tone="warning"
            announcement="status"
            action={
              <Button onClick={() => setReview(draft!.evidence!)}>
                {allT("interviewReview.refreshOnly")}
              </Button>
            }
          >
            {draft!.evidence!.name}:{" "}
            {allT(
              draft!.outcome === "queued"
                ? "interviewReview.queuedRefreshFailed"
                : "interviewReview.refreshFailed",
            )}
          </InlineNotice>
        ))}
      {review && (
        <InterviewCompletionReview
          key={review.id}
          application={review}
          readAvailable={readAvailable && enabled && hoursEnabled}
          initialDraft={drafts[review.id]}
          onAccessDenied={() => {
            concealAccess();
          }}
          refresh={refresh}
          reload={async () => {
            const current =
              await utils.interviewManagement.completionEvidence.fetch(
                { applicationId: review.id },
                { staleTime: 0 },
              );
            if (current.id !== review.id)
              throw new Error(allT("uiPatterns.loadFailed"));
            return { ...review, ...current };
          }}
          onClose={(draft) => {
            setDrafts((current) => ({ ...current, [review.id]: draft }));
            setReview(null);
            requestAnimationFrame(() => {
              if (document.activeElement === document.body)
                document.getElementById("interview-heading")?.focus();
            });
          }}
        />
      )}
      <p className="muted text-sm">{allT("approvals.reversalHelp")}</p>
    </div>
  );
}
