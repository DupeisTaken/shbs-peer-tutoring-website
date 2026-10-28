"use client";
import {
  useSessionViewState,
  useSessionPageScroll,
  useSessionAccessDenied,
  useSessionViewVerified,
} from "~/app/_components/session-view-state";
import {
  useNotificationRecordReveal,
  type NotificationRecordArrival,
} from "~/app/_components/use-notification-record-reveal";
import {
  tutorDirectoryAnchor,
  tutorIdFromDirectoryHash,
} from "~/lib/tutor-directory-link";
import { useRosterSort } from "~/app/_components/roster-view-state";
import {
  userDirectoryView,
  userDirectoryViewParser,
  userDirectoryFilters,
  type UserDirectoryView,
} from "~/lib/management-view-state";
import { participantNameLabel } from "~/app/_components/participant-name";

import { accountMembership } from "~/lib/account-membership";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";

import { Button, ChoiceButton } from "~/app/_components/ui/button";
import {
  FormActions,
  FilterToolbar,
  InlineNotice,
  StatePanel,
} from "~/app/_components/ui/patterns";
import { AccountDeletion } from "~/app/_components/account-deletion";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { useReadOnly } from "~/app/_components/read-only";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { UserDetails } from "./user-details";
import { LoginSetup, MembershipBadges } from "./presentation";
import { DisclosureSection } from "~/app/_components/ui/disclosure-section";
import Link from "next/link";
import { CombineRecords } from "~/app/_components/combine-records";
import { TuteeEditor } from "~/app/_components/tutee-editor";
import { AccountProfileEditor } from "~/app/_components/account-profile-editor";
import { TutorProfileEditor } from "~/app/_components/tutor-profile-editor";
import { TutorDetailsButton } from "~/app/_components/tutor-details";
import { MultiFilter } from "~/app/_components/multi-filter";
import {
  emptyUserFilters,
  isTutorStatusApplicable,
  matchesUserFilters,
  normalizeUserFilters,
  type UserFilters,
} from "~/lib/user-filters";
import { api } from "~/trpc/react";
import { SortHeader, compare } from "~/app/_components/sortable";
import { useDialog } from "~/app/_components/confirm-dialog";
import {
  SummaryTable,
  TableActions,
  TableAction,
} from "~/app/_components/ui/summary-table";

const ALL_ROLES = [
  "STUDENT",
  "VIEWER",
  "TUTOR",
  "COORDINATOR",
  "ADMIN",
  "HEAD",
  "CREW",
  "TRANSLATOR",
] as const;
const TUTOR_STATUSES = [
  "ACTIVE",
  "PENDING",
  "GRADUATED",
  "OPTED_OUT",
  "ARCHIVED",
] as const;
const ACCOUNT_STATES = ["registered", "setup", "invited", "none"] as const;

export default function UsersPage() {
  const t = useTranslations();
  const locale = useLocale();
  const nameFor = (name: string | null | undefined, username?: string | null) =>
    participantNameLabel(name, username, t("participantNames.unnamed"));
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const accounts = api.admin.accounts.useQuery();
  const directoryDenied = useSessionAccessDenied(accounts);
  const verified = useSessionViewVerified();
  const [linkedTutorId, setLinkedTutorId] = useState<string | null>(null);
  const [directoryDetailsOpen, setDirectoryDetailsOpen] = useState(false);
  const [arrival, setArrival] = useState<NotificationRecordArrival | null>(
    null,
  );
  const arrivalSequence = useRef(0);
  // Incoming setup links temporarily select one authorized roster identity. They
  // never overwrite the caller's saved search/filter choices or provision a login.
  useEffect(() => {
    const reveal = () => {
      const id =
        verified && !directoryDenied
          ? tutorIdFromDirectoryHash(window.location.hash)
          : null;
      setLinkedTutorId(id);
      setArrival(
        id
          ? {
              hash: window.location.hash,
              pathname: window.location.pathname,
              sequence: ++arrivalSequence.current,
            }
          : null,
      );
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    window.addEventListener("popstate", reveal);
    return () => {
      window.removeEventListener("hashchange", reveal);
      window.removeEventListener("popstate", reveal);
    };
  }, [verified, directoryDenied]);
  const leaveLinkedTutor = () => {
    setLinkedTutorId(null);
    setArrival(null);
    if (tutorIdFromDirectoryHash(window.location.hash))
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
  };
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingTutorId, setEditingTutorId] = useState<string | null>(null);
  const [editingTuteeId, setEditingTuteeId] = useState<string | null>(null);
  // Fetch the full roster record only when staff open an unlinked profile.
  const tutorProfiles = api.admin.tutors.useQuery(undefined, {
    enabled: !!editingTutorId,
  });
  const editingTutor = tutorProfiles.data?.find(
    (row) => row.id === editingTutorId,
  );
  const editingProfile = accounts.data?.rows.find(
    (row) => row.userId === editingProfileId,
  );
  const invalidate = () => utils.admin.accounts.invalidate();

  // Designed confirm/prompt dialog (replaces native window.prompt for the suspension reason).
  const { promptText, confirm: confirmUsername, dialog } = useDialog();
  const assignUsername = api.admin.backfillStudentUsernames.useMutation({
    onSuccess: async () => {
      await Promise.all([invalidate(), utils.account.me.invalidate()]);
    },
  });

  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [combinePending, setCombinePending] = useState(false);
  const [deletionRecoveryBlocked, setDeletionRecoveryBlocked] = useState(false);
  const queryClient = useQueryClient();
  const [appealDenial, setAppealDenial] = useState(false);
  const canReadAppeals =
    !readOnly &&
    !directoryDenied &&
    ["HEAD", "ADMIN"].includes(accounts.data?.caller.role ?? "");
  const appeals = api.admin.appeals.useQuery(undefined, {
    enabled: canReadAppeals && !appealDenial,
  });
  const appealAccessDenied = [
    appeals.error?.data?.code,
    accounts.error?.data?.code,
  ].some((code) => code === "FORBIDDEN" || code === "UNAUTHORIZED");
  const appealDenied = appealAccessDenied || appealDenial;
  useEffect(() => {
    if (appealAccessDenied) {
      setAppealDenial(true);
      queryClient.removeQueries({
        queryKey: getQueryKey(api.admin.appeals, undefined, "query"),
        exact: true,
      });
    } else if (appeals.isSuccess && !appeals.isFetching && !accounts.error) {
      setAppealDenial(false);
    }
  }, [
    appealAccessDenied,
    appeals.isSuccess,
    appeals.isFetching,
    accounts.error,
    queryClient,
  ]);
  const [appealReview, setAppealReview] = useState<
    NonNullable<typeof appeals.data>[number] | null
  >(null);
  const [acceptedAppeals, setAcceptedAppeals] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [appealRefreshing, setAppealRefreshing] = useState(false);
  const [appealRefreshFailed, setAppealRefreshFailed] = useState(false);
  const appealAdmission = useRef(false);
  const appealRefreshInFlight = useRef(false);
  const refreshAppeals = async () => {
    if (appealRefreshInFlight.current) return;
    appealRefreshInFlight.current = true;
    setAppealRefreshing(true);
    try {
      await settleRefreshes([
        () => invalidateAndReport(utils.admin.accounts),
        () => invalidateAndReport(utils.admin.appeals),
      ]);
      setAppealRefreshFailed(false);
      setAppealReview(null);
    } catch {
      setAppealRefreshFailed(true);
    } finally {
      appealRefreshInFlight.current = false;
      setAppealRefreshing(false);
    }
  };
  useEffect(() => {
    if (!canReadAppeals || appealDenied) setAppealReview(null);
  }, [canReadAppeals, appealDenied]);
  const refreshUsers = () =>
    Promise.all([invalidate(), utils.admin.appeals.invalidate()]);
  const suspendUser = api.admin.suspendUser.useMutation({
    onSuccess: refreshUsers,
  });
  const reinstateUser = api.admin.reinstateUser.useMutation({
    onSuccess: refreshUsers,
  });
  const decideAppeal = api.admin.decideAppeal.useMutation({
    onSuccess: async (_result, input) => {
      // Keep accepted decisions blocked even if stale rows survive a failed read.
      setAcceptedAppeals((previous) => new Set(previous).add(input.appealId));
      await refreshAppeals();
    },
    onSettled: () => {
      appealAdmission.current = false;
    },
  });
  const sendSetup = api.admin.sendTutorSetup.useMutation({
    onSuccess: (data, variables) =>
      setSetupInfo({
        tutorId: variables.tutorId,
        emailed: data.emailed,
      }),
  });
  const [setupInfo, setSetupInfo] = useState<{
    tutorId: string;
    emailed: boolean;
  } | null>(null);

  const callerRole = accounts.data?.caller.role;
  const isHead = !readOnly && !directoryDenied && callerRole === "HEAD";
  const isAdminTier = !readOnly && !directoryDenied && ["HEAD", "ADMIN"].includes(callerRole ?? "");
  // Profile proposals are permitted to Coordinators; direct security and role grants remain Admin/Head.
  const canEditProfiles = !readOnly && !directoryDenied && ["HEAD", "ADMIN", "COORDINATOR"].includes(callerRole ?? "");
  const sort = useRosterSort(
    "users-sort-v1",
    ["name", "account", "role"],
    "name",
    !directoryDenied,
  );

  // Replace cross-session localStorage without migration. Editors, passwords,
  // appeal reviews and selected targets never enter the flat view allowlist.
  const [view, setView] = useSessionViewState<UserDirectoryView>({
    id: "user-directory-v1",
    initialState: userDirectoryView(),
    parse: userDirectoryViewParser,
    enabled: !directoryDenied,
    restoreReady: accounts.data !== undefined,
  });
  const filters = useMemo(() => userDirectoryFilters(view), [view]);
  const search = view.search;
  const setSearch = (search: string) =>
    setView((previous) => ({ ...previous, search }));
  const updateFilters = (next: UserFilters) =>
    setView((previous) =>
      userDirectoryView(normalizeUserFilters(next), previous.search),
    );
  useSessionPageScroll({
    id: "users-v1",
    scope: JSON.stringify({ ...view, sort: [sort.key, sort.dir] }),
    ready: accounts.data !== undefined && !directoryDenied,
    enabled: !directoryDenied && !linkedTutorId,
  });
  // Keep accepted deletion authoritative beside the session-owned directory
  // view: failed list refreshes cannot restore a removed combine candidate.
  const directoryRows = useMemo(
    () =>
      (accounts.data?.rows ?? []).filter(
        (row) => !row.userId || !deletedIds.has(row.userId),
      ),
    [accounts.data, deletedIds],
  );
  const scopedRows = directoryRows.filter((row) =>
    matchesUserFilters(row, filters),
  );
  const linkedTutor = linkedTutorId
    ? directoryRows
        .flatMap((row) => row.tutorDestinations)
        .find((source) => source.tutorId === linkedTutorId)
    : undefined;
  const linkedReadReady =
    accounts.data !== undefined &&
    !accounts.isFetching &&
    !accounts.error &&
    !directoryDenied;
  useNotificationRecordReveal(
    arrival,
    linkedReadReady && !!linkedTutor && !directoryDetailsOpen,
    (cancelled) =>
      setArrival((current) =>
        current?.sequence === cancelled.sequence ? null : current,
      ),
  );
  const hadDirectoryDetailsOpen = useRef(false);
  const hasLinkedTutor = !!linkedTutor;
  useEffect(() => {
    const closed = hadDirectoryDetailsOpen.current && !directoryDetailsOpen;
    hadDirectoryDetailsOpen.current = directoryDetailsOpen;
    if (
      !closed ||
      !verified ||
      directoryDenied ||
      !linkedTutorId ||
      !hasLinkedTutor
    )
      return;
    let cancelled = false;
    const pathname = window.location.pathname;
    // Editing gestures deliberately cancel incoming reveal. After native dialog
    // cleanup, recover only lost focus from its now-hidden browsing opener;
    // this does not restart that arrival or scroll away from the user's position.
    queueMicrotask(() => {
      if (
        cancelled ||
        window.location.pathname !== pathname ||
        tutorIdFromDirectoryHash(window.location.hash) !== linkedTutorId ||
        document.querySelector("dialog[open]")
      )
        return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active !== document.body &&
        active.isConnected &&
        !active.matches(":disabled") &&
        !active.closest("[hidden], [inert]") &&
        active.getClientRects().length
      )
        return;
      const target = document.getElementById(
        tutorDirectoryAnchor(linkedTutorId),
      );
      if (
        !target?.getClientRects().length ||
        target.closest("[hidden], [inert]")
      )
        return;
      if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    });
    return () => {
      cancelled = true;
    };
  }, [
    directoryDetailsOpen,
    directoryDenied,
    verified,
    linkedTutorId,
    hasLinkedTutor,
  ]);
  const rows = useMemo(() => {
    const data = directoryRows;
    // Navigation hides browsing, but does not remove its row-owned editors.
    // Their drafts and pending writes survive Back/Forward to a source hash.
    const filtered = data.filter((u) => matchesUserFilters(u, filters, search));
    if (sort.dir === "none") return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    const compareText = (a: string, b: string) => compare(a, b, locale);
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "account":
          return compareText(a.account, b.account) * dir;
        case "role":
          return compareText(a.role ?? "", b.role ?? "") * dir;
        case "name":
        default:
          return compareText(a.name, b.name) * dir;
      }
    });
  }, [locale, directoryRows, sort.key, sort.dir, filters, search]);

  if (directoryDenied)
    return (
      <div className="space-y-6">
        <h1 className="page-title">{t("admin.users.title")}</h1>
        <StatePanel
          kind="denied"
          title={t("managementRecovery.denied", {
            section: t("admin.users.title"),
          })}
          action={
            <Button
              disabled={accounts.isFetching}
              onClick={() => void accounts.refetch()}
            >
              {t("uiPatterns.retry")}
            </Button>
          }
        />
      </div>
    );
  return (
    <div className="space-y-6">
      {canEditProfiles && editingTuteeId && (
        <DirectoryTuteeEditor
          tuteeId={editingTuteeId}
          canApply={isAdminTier}
          onClose={() => setEditingTuteeId(null)}
        />
      )}
      {canEditProfiles && editingTutor && !editingTutor.user && (
        <TutorProfileEditor
          key={editingTutor.id}
          row={editingTutor}
          canEditUsername={isAdminTier}
          canApply={isAdminTier}
          onClose={() => setEditingTutorId(null)}
        />
      )}
      {editingTutorId && tutorProfiles.isLoading && (
        <p role="status">{t("common.loading")}</p>
      )}
      {editingTutorId && tutorProfiles.error && (
        <p role="alert">{tutorProfiles.error.message}</p>
      )}
      {canEditProfiles &&
        editingProfile?.userId &&
        editingProfile.profileVersion !== null && (
          <AccountProfileEditor
            profile={{
              userId: editingProfile.userId,
              username: editingProfile.username,
              name: editingProfile.name,
              firstName: editingProfile.firstName,
              lastName: editingProfile.lastName,
              preferredName: editingProfile.preferredName,
              legacyName: editingProfile.legacyName,
              alternativeNames: editingProfile.alternativeNames,
              profileVersion: editingProfile.profileVersion,
            }}
            membership={accountMembership(editingProfile)}
            canPropose
            canApply={isAdminTier}
            isHead={isHead}
            onClose={() => setEditingProfileId(null)}
          />
        )}
      <div>
        <h1 className="page-title">{t("admin.users.title")}</h1>
        <p className="muted mt-1">
          {isAdminTier
            ? t("admin.users.subtitle")
            : t("admin.users.coordinatorHint")}
        </p>
      </div>

      <section className="card space-y-3 p-4 text-sm">
        <DisclosureSection title={t("usersDirectory.pathways")} lifetime="lazy">
          <div className="space-y-3 pt-3 text-slate-700">
            <p>{t("usersDirectory.intro")}</p>
            <p>
              {t("usersDirectory.pathwaysTutee")}{" "}
              <Link href="/admin/tutees" className="link">
                {t("usersDirectory.tuteeList")}
              </Link>
            </p>
            <p>
              {t("usersDirectory.pathwaysInvite")}{" "}
              <Link href="/admin/registration-codes" className="link">
                {t("usersDirectory.invitations")}
              </Link>
            </p>
            <p>{t("usersDirectory.pathwaysExisting")}</p>
            <p>{t("usersDirectory.pathwaysHistory")}</p>
          </div>
        </DisclosureSection>
      </section>
      {linkedTutorId && (
        <InlineNotice
          announcement="status"
          tone={linkedReadReady && !linkedTutor ? "warning" : "info"}
          action={
            <div className="flex flex-wrap gap-2">
              {!linkedTutor && (
                <Button
                  size="compact"
                  disabled={accounts.isFetching}
                  onClick={() => void accounts.refetch()}
                >
                  {t("uiPatterns.retry")}
                </Button>
              )}
              <Button size="compact" onClick={leaveLinkedTutor}>
                {t("usersDirectory.showAll")}
              </Button>
            </div>
          }
        >
          {!linkedReadReady
            ? t(accounts.error ? "uiPatterns.loadFailed" : "common.loading")
            : linkedTutor
              ? t("usersDirectory.targetFound", {
                  name: nameFor(linkedTutor.name, linkedTutor.username),
                })
              : t("usersDirectory.targetUnavailable")}
        </InlineNotice>
      )}
      {isAdminTier && !readOnly && (
        // Keep an in-flight review owner alive when a new hash focuses a source.
        // Hidden browsing controls return with their existing recovery state.
        <div hidden={!!linkedTutorId}>
          <CombineRecords canApply={isAdminTier} onPendingChange={setCombinePending} />
        </div>
      )}
      <fieldset
        hidden={!!linkedTutorId}
        disabled={!!linkedTutorId || (isAdminTier && combinePending)}
        className="card min-w-0 space-y-3 p-4"
      >
        <FilterToolbar
          label={t("rosterSearch.label")}
          summary={t("rosterSearch.results", {
            count: rows.length,
            total: linkedTutorId ? rows.length : scopedRows.length,
          })}
        >
          <label className="min-w-0 flex-1">
            <span className="label">{t("rosterSearch.label")}</span>
            <input
              type="search"
              className="input w-full"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("rosterSearch.placeholder")}
            />
          </label>
          {search && (
            <Button size="compact" onClick={() => setSearch("")}>
              {t("rosterSearch.clear")}
            </Button>
          )}
        </FilterToolbar>
        {!linkedTutorId &&
          search.trim() &&
          rows.length === 0 &&
          scopedRows.length > 0 && (
            <p role="status" className="muted">
              {t("rosterSearch.noMatches")}
            </p>
          )}
        <p className="muted text-sm">{t("userMultiFilters.hint")}</p>
        <p className="muted text-sm">{t("usersDirectory.visibility")}</p>
        <div
          className={`grid items-start gap-3 ${isTutorStatusApplicable(filters.role) ? "md:grid-cols-3" : "md:grid-cols-2"}`}
        >
          <MultiFilter
            label={t("admin.users.filters.role")}
            options={[
              ...ALL_ROLES.map((value) => ({
                value,
                label:
                  value === "TRANSLATOR"
                    ? t("membership.translator")
                    : t(`admin.users.roles.${value}`),
              })),
              { value: "__none__", label: t("userMultiFilters.noRole") },
            ]}
            value={filters.role}
            onChange={(role) => updateFilters({ ...filters, role })}
          />
          {isTutorStatusApplicable(filters.role) && (
            <MultiFilter
              label={t("admin.users.filters.status")}
              options={[
                ...TUTOR_STATUSES.map((value) => ({
                  value,
                  label: t(`admin.tutorStatus.${value}`),
                })),
                { value: "__none__", label: t("userMultiFilters.noTutor") },
              ]}
              value={filters.status}
              onChange={(status) => updateFilters({ ...filters, status })}
            />
          )}
          <MultiFilter
            label={t("admin.users.filters.account")}
            options={ACCOUNT_STATES.map((value) => ({
              value,
              label: t(`usersDirectory.setup.${value}`),
            }))}
            value={filters.account}
            onChange={(account) => updateFilters({ ...filters, account })}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="muted text-sm">
            {t("usersDirectory.count", {
              count: rows.length,
              total: directoryRows.length,
              hidden: directoryRows.length - rows.length,
            })}
          </p>
          <FilterToolbar label={t("usersDirectory.visibility")}>
            <ChoiceButton
              selected={filters.showUnverified}
              onClick={() =>
                updateFilters({
                  ...filters,
                  showUnverified: !filters.showUnverified,
                })
              }
            >
              {t(
                filters.showUnverified
                  ? "tuteeHistory.hideUnverified"
                  : "tuteeHistory.showUnverified",
              )}
            </ChoiceButton>
            <ChoiceButton
              selected={filters.showPastTutors}
              onClick={() =>
                updateFilters({
                  ...filters,
                  showPastTutors: !filters.showPastTutors,
                })
              }
            >
              {t(
                filters.showPastTutors
                  ? "tuteeHistory.hideHistorical"
                  : "tuteeHistory.showHistorical",
              )}
            </ChoiceButton>
            <button
              type="button"
              className="btn-secondary btn-sm min-h-11 lg:min-h-8"
              onClick={() => updateFilters(emptyUserFilters())}
            >
              {t("userMultiFilters.clear")}
            </button>
          </FilterToolbar>
        </div>
      </fieldset>
      {sendSetup.error && (
        <InlineNotice tone="error" announcement="alert">
          {sendSetup.error.message}
        </InlineNotice>
      )}

      {setupInfo && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <p className="text-slate-700">
              {setupInfo.emailed
                ? t("admin.tutors.account.linkEmailed")
                : t("admin.tutors.account.linkManual")}
            </p>
            <button className="link text-xs" onClick={() => setSetupInfo(null)}>
              {t("admin.tutors.account.dismiss")}
            </button>
          </div>
        </div>
      )}

      {/* Pending reinstatement appeals from suspended viewers. */}
      {canReadAppeals &&
        (appealDenied ? (
          <StatePanel
            kind="denied"
            title={t("managementRecovery.denied", {
              section: t("admin.users.appeals.heading"),
            })}
            action={
              <Button
                disabled={appeals.isFetching || accounts.isFetching}
                onClick={() => {
                  void accounts.refetch();
                  void appeals.refetch();
                }}
              >
                {t("managementRecovery.retry", {
                  section: t("admin.users.appeals.heading"),
                })}
              </Button>
            }
          />
        ) : (
          <QueryFeedback
            hasData={appeals.data !== undefined}
            loading={appeals.data === undefined}
            error={!!appeals.error}
            retrying={appeals.isFetching}
            loadingTitle={t("managementRecovery.loading", {
              section: t("admin.users.appeals.heading"),
            })}
            errorTitle={t(
              appeals.data === undefined
                ? "managementRecovery.loadFailed"
                : "managementRecovery.refreshFailed",
              { section: t("admin.users.appeals.heading") },
            )}
            retryLabel={t("managementRecovery.retry", {
              section: t("admin.users.appeals.heading"),
            })}
            onRetry={() => void appeals.refetch()}
          />
        ))}
      {canReadAppeals && !appealDenied && (appeals.data ?? []).length > 0 && (
        <section className="card overflow-hidden">
          <div className="px-5 py-3">
            <h2 className="section-title">
              {t("admin.users.appeals.heading")}
            </h2>
          </div>
          <div className="divide-y divide-slate-100 px-5 pb-3">
            {(appeals.data ?? []).map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-3 py-3 text-sm"
              >
                <span className="font-medium text-slate-800">
                  {nameFor(a.name)}
                </span>
                {a.affiliation && (
                  <span className="muted text-xs">{a.affiliation}</span>
                )}
                <button
                  className="table-action-link ml-auto"
                  disabled={decideAppeal.isPending || appealRefreshing}
                  onClick={() => {
                    decideAppeal.reset();
                    setAppealReview(a);
                  }}
                >
                  {t("admin.users.appeals.review")}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {canReadAppeals && !appealDenied && appealReview && (
        <ProfileDialog
          title={`${t("admin.users.appeals.review")} · ${nameFor(appealReview.name)}`}
          pending={decideAppeal.isPending || appealRefreshing}
          onClose={() => setAppealReview(null)}
        >
          <div className="space-y-4">
            {appealReview.affiliation && (
              <p className="muted">{appealReview.affiliation}</p>
            )}
            <section aria-label={t("admin.users.appeals.message")}>
              <h3 className="font-semibold">
                {t("admin.users.appeals.message")}
              </h3>
              <p className="mt-2 [overflow-wrap:anywhere] whitespace-pre-wrap">
                {appealReview.message}
              </p>
            </section>
            {/* Decisions stay beside complete original evidence, within the
                existing server-authorized mutation and its pending lifetime. */}
            <FormActions>
              {(["APPROVE", "DENY"] as const).map((action) => (
                <Button
                  key={action}
                  variant={action === "APPROVE" ? "primary" : "secondary"}
                  disabled={
                    decideAppeal.isPending ||
                    appealRefreshing ||
                    appealRefreshFailed ||
                    acceptedAppeals.has(appealReview.id) ||
                    !!appeals.error ||
                    !!accounts.error
                  }
                  onClick={() => {
                    if (
                      appealAdmission.current ||
                      acceptedAppeals.has(appealReview.id) ||
                      appealRefreshFailed ||
                      appeals.error ||
                      accounts.error
                    )
                      return;
                    appealAdmission.current = true;
                    decideAppeal.mutate({ appealId: appealReview.id, action });
                  }}
                >
                  {t(
                    action === "APPROVE"
                      ? "admin.users.appeals.approve"
                      : "admin.users.appeals.deny",
                  )}
                </Button>
              ))}
            </FormActions>
            {decideAppeal.error && (
              <p role="alert" className="text-sm text-red-700">
                {decideAppeal.error.message}
              </p>
            )}
            {appealRefreshFailed && (
              <InlineNotice
                tone="warning"
                announcement="alert"
                action={
                  <Button
                    disabled={appealRefreshing}
                    onClick={() => void refreshAppeals()}
                  >
                    {t("managementRecovery.retry", {
                      section: t("admin.users.appeals.heading"),
                    })}
                  </Button>
                }
              >
                {t("admin.users.appeals.refreshFailed")}
              </InlineNotice>
            )}
          </div>
        </ProfileDialog>
      )}
      {canReadAppeals &&
        !appealDenied &&
        !appealReview &&
        appealRefreshFailed && (
          <InlineNotice
            tone="warning"
            announcement="alert"
            action={
              <Button
                disabled={appealRefreshing}
                onClick={() => void refreshAppeals()}
              >
                {t("managementRecovery.retry", {
                  section: t("admin.users.appeals.heading"),
                })}
              </Button>
            }
          >
            {t("admin.users.appeals.refreshFailed")}
          </InlineNotice>
        )}

      {assignUsername.error && (
        <p role="alert" className="text-sm text-red-600">
          {assignUsername.error.message}
        </p>
      )}
      {accounts.error && (
        <StatePanel
          kind="error"
          title={t("uiPatterns.loadFailed")}
          action={
            <Button
              size="compact"
              disabled={accounts.isFetching}
              onClick={() => void accounts.refetch()}
            >
              {t("uiPatterns.retry")}
            </Button>
          }
        />
      )}
      {accounts.data && accounts.isFetching && (
        <p role="status" className="muted text-sm">
          {t("common.loading")}
        </p>
      )}
      <div className="card" hidden={!linkedTutorId}>
        <SummaryTable label={t("admin.users.title")}>
          <thead>
            <tr>
              <SortHeader sort={sort} sortKey="name">
                {t("admin.users.columns.user")}
              </SortHeader>
              <SortHeader sort={sort} sortKey="account">
                {t("usersDirectory.loginSetup")}
              </SortHeader>
              <SortHeader sort={sort} sortKey="role">
                {t(
                  linkedTutorId
                    ? "usersDirectory.lifecycle"
                    : "usersDirectory.rolesParticipation",
                )}
              </SortHeader>
              <th className="table-actions-heading">
                {t("tablePatterns.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {/* This source-only view deliberately has no group login/profile actions.
                Both details and setup are bound to the incoming immutable Tutor ID. */}
            {linkedTutor && (
              <tr
                id={tutorDirectoryAnchor(linkedTutor.tutorId)}
                className="bg-accent-50"
              >
                <td>
                  <p className="font-medium text-slate-900">
                    {nameFor(linkedTutor.name, linkedTutor.username)}
                  </p>
                  {linkedTutor.username && (
                    <p className="muted text-xs">@{linkedTutor.username}</p>
                  )}
                </td>
                <td className="max-w-56 min-w-32">
                  {linkedTutor.account === null ? (
                    <p className="text-sm text-slate-700">
                      {t("usersDirectory.retainedBy", {
                        name: nameFor(linkedTutor.retainedOwnerName),
                      })}
                    </p>
                  ) : (
                    <LoginSetup
                      account={linkedTutor.account}
                      suspended={linkedTutor.suspended}
                    />
                  )}
                </td>
                <td className="min-w-32">
                  <span className="badge-slate">
                    {t(`usersDirectory.status.${linkedTutor.status}`)}
                  </span>
                </td>
                <TableActions>
                  {/* A read-only source reader belongs to one exact selection;
                      history navigation dismisses it rather than replacing its subject. */}
                  <TutorDetailsButton
                    key={linkedTutor.tutorId}
                    tutorId={linkedTutor.tutorId}
                    name={linkedTutor.name}
                    username={linkedTutor.username}
                  />
                  {!readOnly &&
                    (linkedTutor.account === "setup" ||
                      (linkedTutor.account === "none" && isAdminTier)) && (
                      <TableAction
                        disabled={
                          !linkedReadReady ||
                          !linkedTutor.hasEmail ||
                          sendSetup.isPending
                        }
                        title={
                          !linkedTutor.hasEmail
                            ? t("admin.tutors.account.needEmail")
                            : undefined
                        }
                        onClick={() =>
                          sendSetup.mutate({ tutorId: linkedTutor.tutorId })
                        }
                      >
                        {t("admin.tutors.account.sendSetup")}
                      </TableAction>
                    )}
                  {!readOnly && linkedTutor.account === "none" && !isAdminTier && (
                    <span className="muted max-w-56 text-xs">
                      {t("usersDirectory.setupHeadRequired")}
                    </span>
                  )}
                </TableActions>
              </tr>
            )}
            {!linkedTutor && (
              <tr>
                <td colSpan={4} className="text-slate-500">
                  {t(accounts.data ? "admin.users.empty" : "common.loading")}
                </td>
              </tr>
            )}
          </tbody>
        </SummaryTable>
      </div>
      {/* Hide the browsing table, retaining the real UserDetails subtree. Its
          already-open portal stays available until the user finishes or closes
          it; source reveal waits so navigation cannot steal dialog focus. */}
      <div className="card" hidden={!!linkedTutorId}>
        <SummaryTable label={t("admin.users.title")}>
          <thead>
            <tr>
              <SortHeader sort={sort} sortKey="name">
                {t("admin.users.columns.user")}
              </SortHeader>
              <SortHeader sort={sort} sortKey="account">
                {t("usersDirectory.loginSetup")}
              </SortHeader>
              <SortHeader sort={sort} sortKey="role">
                {t("usersDirectory.rolesParticipation")}
              </SortHeader>
              <th className="table-actions-heading">
                {t("tablePatterns.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {!accounts.data && !accounts.error && (
              <tr>
                <td colSpan={4}>
                  <StatePanel kind="loading" title={t("common.loading")} />
                </td>
              </tr>
            )}
            {rows.map((u) => {
              const key =
                u.personId ??
                u.userId ??
                (u.tutorId ? `tutor-${u.tutorId}` : `tutee-${u.tuteeId}`);
              return (
                <tr
                  key={key}
                  id={
                    !linkedTutorId && u.tutorId
                      ? tutorDirectoryAnchor(u.tutorId)
                      : undefined
                  }
                >
                  {/* Identity contains names and the handle; all row actions live in the last column. */}
                  <td>
                    <div className="leading-tight">
                      <p className="font-medium text-slate-900">
                        {nameFor(u.name, u.username)}
                      </p>
                      {(u.username ?? u.tutor?.username) ? (
                        <p className="muted text-xs">
                          @{u.username ?? u.tutor?.username}
                        </p>
                      ) : (
                        <p className="muted text-xs">
                          {t(
                            u.userId
                              ? "academics.usernameMissing"
                              : "tuteeHistory.noAccount",
                          )}
                        </p>
                      )}
                      {u.combinedRecordCount > 1 && (
                        <p className="muted mt-1 text-xs">
                          {t("combineRecords.combinedRecords", {
                            count: u.combinedRecordCount,
                          })}
                        </p>
                      )}
                      {u.identityReviewRequired && (
                        <p className="mt-1 text-xs text-amber-800">
                          {t("combineRecords.reviewRequired")}
                        </p>
                      )}
                    </div>
                  </td>

                  <td className="max-w-56 min-w-32">
                    <LoginSetup account={u.account} suspended={u.suspended} />
                  </td>
                  {/* Measured 68px mobile columns fragmented Chinese role labels.
                      Keep readable columns inside the existing local scroll region. */}
                  <td className="max-w-56 min-w-40">
                    <MembershipBadges membership={accountMembership(u)} />
                  </td>

                  {/* Contact/profile actions stay available to permitted staff. Only deletion is head-only. */}
                  <TableActions>
                    <UserDetails
                      row={u}
                      onOpenChange={setDirectoryDetailsOpen}
                    />
                    {/* Registered accounts recover access themselves; only unfinished tutor logins are provisioned. */}
                    {!readOnly &&
                      u.tutorId &&
                      (u.account === "setup" ||
                        (u.account === "none" && isAdminTier)) && (
                        <TableAction
                          disabled={!u.tutorHasEmail || sendSetup.isPending}
                          title={
                            !u.tutorHasEmail
                              ? t("admin.tutors.account.needEmail")
                              : undefined
                          }
                          onClick={() =>
                            u.tutorId &&
                            sendSetup.mutate({ tutorId: u.tutorId })
                          }
                        >
                          {t("admin.tutors.account.sendSetup")}
                        </TableAction>
                      )}
                    {!readOnly &&
                      u.tutorId &&
                      u.account === "none" &&
                      !isAdminTier && (
                        <span className="muted max-w-56 text-xs">
                          {t("usersDirectory.setupHeadRequired")}
                        </span>
                      )}
                    {!u.tutorId &&
                      u.role === "VIEWER" &&
                      u.userId &&
                      !u.isSelf &&
                      (u.suspended ? (
                        <TableAction
                          disabled={reinstateUser.isPending}
                          onClick={() =>
                            reinstateUser.mutate({ userId: u.userId })
                          }
                        >
                          {isAdminTier
                            ? t("admin.users.reinstate")
                            : t("approvals.requestAdmin")}
                        </TableAction>
                      ) : (
                        <TableAction
                          variant="danger"
                          disabled={suspendUser.isPending}
                          onClick={async () => {
                            const reason = await promptText({
                              title: t("admin.users.suspendTitle"),
                              reasonLabel: t("admin.users.suspendPrompt"),
                              confirmLabel: t("admin.users.suspend"),
                              cancelLabel: t("common.cancel"),
                              danger: true,
                            });
                            if (reason === null || !u.userId) return;
                            suspendUser.mutate({
                              userId: u.userId,
                              reason: reason.length > 0 ? reason : undefined,
                            });
                          }}
                        >
                          {t("admin.users.suspend")}
                        </TableAction>
                      ))}
                    {canEditProfiles && u.userId && (
                      <TableAction
                        onClick={() => setEditingProfileId(u.userId)}
                      >
                        {t("accountProfile.editProfile")}
                      </TableAction>
                    )}
                    {canEditProfiles && !u.userId && u.tutorId && (
                      <TableAction onClick={() => setEditingTutorId(u.tutorId)}>
                        {t("accountProfile.editProfile")}
                      </TableAction>
                    )}
                    {canEditProfiles && !u.userId && !u.tutorId && u.tuteeId && (
                      <TableAction onClick={() => setEditingTuteeId(u.tuteeId)}>
                        {t("accountProfile.editProfile")}
                      </TableAction>
                    )}
                    {isAdminTier &&
                      u.userId &&
                      u.role === "STUDENT" &&
                      u.emailVerifiedAt &&
                      !u.username && (
                        <TableAction
                          disabled={assignUsername.isPending}
                          onClick={async () => {
                            if (!u.userId) return;
                            if (
                              await confirmUsername({
                                title: t("identityUsername.assignTitle", {
                                  name: nameFor(u.name, u.username),
                                }),
                                message: t("identityUsername.assignHelp"),
                                confirmLabel: t("identityUsername.assign"),
                                cancelLabel: t("common.cancel"),
                              })
                            )
                              assignUsername.mutate({ userIds: [u.userId] });
                          }}
                        >
                          {t("identityUsername.assign")}
                        </TableAction>
                      )}
                    {isAdminTier && u.userId && !u.isSelf && u.role !== "HEAD" ? (
                      <TableAction
                        variant="danger"
                        disabled={
                          deletionRecoveryBlocked || deletedIds.has(u.userId)
                        }
                        onClick={() => {
                          const userId = u.userId;
                          if (!userId) return;
                          setDeleteTarget({
                            id: userId,
                            name: nameFor(u.name, u.username),
                          });
                        }}
                      >
                        {t("admin.users.delete")}
                      </TableAction>
                    ) : null}
                  </TableActions>
                </tr>
              );
            })}
            {accounts.data && rows.length === 0 && !linkedTutor && (
              <tr>
                <td colSpan={4} className="text-slate-500">
                  {t("admin.users.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </SummaryTable>
      </div>
      {/* Errors from the dangerous (dialog-gated) actions surface inside the dialog itself. */}

      {isAdminTier && (
        <AccountDeletion
          target={deleteTarget}
          onRecoveryChange={setDeletionRecoveryBlocked}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(id) => {
            setDeletedIds((previous) => new Set(previous).add(id));
            setDeleteTarget(null);
          }}
        />
      )}
      {dialog}
    </div>
  );
}

/** Only an opened accountless enrollment editor loads its full roster evidence. */
function DirectoryTuteeEditor({
  tuteeId,
  canApply,
  onClose,
}: {
  tuteeId: string;
  canApply: boolean;
  onClose: () => void;
}) {
  const t = useTranslations();
  const records = api.admin.tutees.useQuery();
  const record = records.data?.find((row) => row.id === tuteeId);
  if (record)
    return (
      <TuteeEditor
        row={record}
        canApply={canApply}
        historyPermissions={canApply ? { canLink: true, canCorrectOwnership: canApply } : undefined}
        onClose={onClose}
      />
    );
  return (
    <ProfileDialog title={t("accountProfile.editProfile")} onClose={onClose}>
      <QueryFeedback
        hasData={records.data !== undefined}
        loading={records.isLoading}
        error={!!records.error}
        retrying={records.isFetching}
        loadingTitle={t("common.loading")}
        errorTitle={t("uiPatterns.loadFailed")}
        retryLabel={t("uiPatterns.retry")}
        onRetry={() => void records.refetch()}
      />
      {records.data && !record && <p>{t("tuteeHistory.HISTORY_NOT_FOUND")}</p>}
    </ProfileDialog>
  );
}
