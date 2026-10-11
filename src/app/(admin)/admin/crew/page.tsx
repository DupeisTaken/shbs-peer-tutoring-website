"use client";
import { EmailDetails } from "~/app/_components/email-details";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { StatePanel } from "~/app/_components/ui/patterns";
import { Button } from "~/app/_components/ui/button";

import { api } from "~/trpc/react";
import { AcademicError } from "~/app/_components/academic-error";
import { useReadOnly } from "~/app/_components/read-only";
import { PatrolCorrections } from "~/app/_components/patrol-corrections";
import {
  useActionReview,
  type ReviewedAction,
} from "~/app/_components/ui/action-review";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { queuedApprovalId } from "~/lib/approval-outcome";
import {
  SummaryTable,
  TableActions,
  TableAction,
  TableDetails,
} from "~/app/_components/ui/summary-table";

/**
 * Crew admin hub: review crew applications, approve opt-out/reentry requests, manage the crew
 * roster (status + soft-remove + hard-delete crew-only logins), and edit the room patrol order.
 * Crew service hours (0.5h/patrol) are tallied separately from tutoring. VIEWER is read-only.
 */
export default function CrewPage() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const readOnly = useReadOnly();
  const review = useActionReview();
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  type Scope = "order" | "roster" | "applications" | "requests" | "codes";
  const [reviewScope, setReviewScope] = useState<Scope | null>(null);
  const [denied, setDenied] = useState<ReadonlySet<Scope>>(() => new Set());
  const order = api.admin.patrolOrder.useQuery(undefined, {
    enabled: !denied.has("order"),
  });
  const roster = api.admin.crewRoster.useQuery(undefined, {
    enabled: !denied.has("roster"),
  });
  const applications = api.admin.crewApplications.useQuery(undefined, {
    enabled: !denied.has("applications"),
  });
  const requests = api.admin.crewRequests.useQuery(undefined, {
    enabled: !denied.has("requests"),
  });
  const issuedCodes = api.admin.crewIssuedCodes.useQuery(undefined, {
    enabled: !denied.has("codes"),
  });
  const sources = useMemo(
    () => ({
      order: {
        query: order,
        title: t("admin.crew.orderHeading"),
        key: () => getQueryKey(api.admin.patrolOrder, undefined, "query"),
      },
      roster: {
        query: roster,
        title: t("admin.crew.rosterHeading"),
        key: () => getQueryKey(api.admin.crewRoster, undefined, "query"),
      },
      applications: {
        query: applications,
        title: t("admin.crew.applicationsHeading"),
        key: () => getQueryKey(api.admin.crewApplications, undefined, "query"),
      },
      requests: {
        query: requests,
        title: t("admin.crew.requestsHeading"),
        key: () => getQueryKey(api.admin.crewRequests, undefined, "query"),
      },
      codes: {
        query: issuedCodes,
        title: t("admin.crew.issuedHeading"),
        key: () => getQueryKey(api.admin.crewIssuedCodes, undefined, "query"),
      },
    }),
    [order, roster, applications, requests, issuedCodes, t],
  );
  const accessDenied = (scope: Scope) => {
    const code = sources[scope].query.error?.data?.code;
    return code === "FORBIDDEN" || code === "UNAUTHORIZED";
  };
  const hidden = (scope: Scope) => denied.has(scope) || accessDenied(scope);
  const reviewRevoked = reviewScope !== null && hidden(reviewScope);
  const openReview = (scope: Scope, action: ReviewedAction) => {
    if (review.blocked(action.key)) return;
    setReviewScope(scope);
    review.open(action);
  };
  const revokeReview = review.revoke;
  useEffect(() => {
    if (reviewRevoked) revokeReview();
  }, [reviewRevoked, revokeReview]);
  // Each crew section owns an independent read and denial. A failed application
  // query must neither empty unrelated roster data nor expose stale private text.
  useEffect(() => {
    const next = new Set(denied);
    for (const scope of Object.keys(sources) as Scope[]) {
      const source = sources[scope];
      const code = source.query.error?.data?.code;
      if (code === "FORBIDDEN" || code === "UNAUTHORIZED") {
        if (!denied.has(scope))
          queryClient.removeQueries({ queryKey: source.key(), exact: true });
        next.add(scope);
      } else if (source.query.isSuccess && !source.query.isFetching)
        next.delete(scope);
    }
    if (
      next.size !== denied.size ||
      [...next].some((scope) => !denied.has(scope))
    )
      setDenied(next);
  }, [sources, denied, queryClient]);
  const feedback = (scope: Scope) => {
    const { query, title } = sources[scope];
    const retry = () => {
      void query.refetch();
    };
    return hidden(scope) ? (
      <StatePanel
        kind="denied"
        title={t("managementRecovery.denied", { section: title })}
        action={
          <Button disabled={query.isFetching} onClick={retry}>
            {t("managementRecovery.retry", { section: title })}
          </Button>
        }
      />
    ) : (
      <QueryFeedback
        hasData={query.data !== undefined}
        loading={query.data === undefined}
        error={!!query.error}
        retrying={query.isFetching}
        loadingTitle={t("managementRecovery.loading", { section: title })}
        errorTitle={t(
          query.data === undefined
            ? "managementRecovery.loadFailed"
            : "managementRecovery.refreshFailed",
          { section: title },
        )}
        retryLabel={t("managementRecovery.retry", { section: title })}
        onRetry={retry}
      />
    );
  };
  const orderDirty = useRef(false);
  const [hasOrderChanges, setHasOrderChanges] = useState(false);
  const orderAdmission = useRef(false);

  const setOrder = api.admin.setPatrolOrder.useMutation({
    onSuccess: async () => {
      await utils.admin.patrolOrder.invalidate();
      orderDirty.current = false;
      setHasOrderChanges(false);
    },
    onSettled: () => {
      orderAdmission.current = false;
    },
  });
  const setStatus = api.admin.setCrewStatus.useMutation();
  const removeCrew = api.admin.deleteCrewMember.useMutation();
  const refreshReviewed = () =>
    settleRefreshes([
      () => invalidateAndReport(utils.admin.crewRoster),
      () => invalidateAndReport(utils.admin.crewApplications),
      () => invalidateAndReport(utils.admin.crewRequests),
      () => invalidateAndReport(utils.admin.crewIssuedCodes),
      () => invalidateAndReport(utils.admin.crewSummary),
    ]);
  const [issuedCode, setIssuedCode] = useState<Record<string, string>>({});
  const decideApp = api.admin.decideCrewApplication.useMutation({
    onSuccess: (res, vars) => {
      if (res.code)
        setIssuedCode((m) => ({ ...m, [vars.applicationId]: res.code! }));
    },
  });
  const decideReq = api.admin.decideCrewRequest.useMutation();

  // Local, reorderable copy of the room order.
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (order.data && !orderDirty.current)
      setRooms(order.data.map((r) => ({ id: r.id, name: r.name })));
  }, [order.data]);

  const move = (i: number, dir: -1 | 1) => {
    orderDirty.current = true;
    setHasOrderChanges(true);
    setRooms((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };

  const apps = hidden("applications") ? [] : (applications.data ?? []);
  const reqs = hidden("requests") ? [] : (requests.data ?? []);
  const busy =
    review.busy ||
    setStatus.isPending ||
    removeCrew.isPending ||
    decideApp.isPending ||
    decideReq.isPending;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">{t("admin.crew.title")}</h1>
        <p className="muted mt-1">{t("admin.crew.subtitle")}</p>
      </div>

      {setOrder.error && (
        <p role="alert" className="text-sm text-red-600">
          <AcademicError message={setOrder.error.message} />
        </p>
      )}

      <PatrolCorrections />
      {/* Crew applications */}
      <section className="card overflow-hidden">
        <div className="px-5 py-3">
          <h2 className="section-title">
            {t("admin.crew.applicationsHeading")}
          </h2>
        </div>
        <div className="divide-y divide-slate-100 px-5 pb-3">
          {feedback("applications")}
          {applications.data !== undefined &&
          !applications.error &&
          !hidden("applications") &&
          apps.length === 0 ? (
            <p className="muted py-2">{t("admin.crew.applicationsEmpty")}</p>
          ) : (
            apps.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-3 py-3 text-sm"
              >
                <span className="font-medium text-slate-800">{a.name}</span>
                {a.gradeLevel != null && (
                  <span className="badge-slate">G{a.gradeLevel}</span>
                )}
                {a.preferredContact && a.preferredContact !== a.email && (
                  <span className="muted max-w-64 text-xs [overflow-wrap:anywhere]">
                    {a.preferredContact}
                  </span>
                )}
                <EmailDetails contactOnly email={a.email} name={a.name} />
                {a.message && (
                  <TableDetails
                    title={`${t("admin.crew.originalApplication")} · ${a.name}`}
                  >
                    <p className="[overflow-wrap:anywhere] whitespace-pre-wrap">
                      {a.message}
                    </p>
                  </TableDetails>
                )}
                {issuedCode[a.id] ? (
                  <span className="badge-green ml-auto font-mono tracking-widest">
                    {t("admin.crew.codeIssued", { code: issuedCode[a.id]! })}
                  </span>
                ) : (
                  !readOnly && (
                    <span className="ml-auto flex gap-2">
                      <button
                        className="btn-primary btn-sm"
                        disabled={
                          busy ||
                          !!applications.error ||
                          review.blocked(a.id + ":application")
                        }
                        onClick={() =>
                          openReview("applications", {
                            key: a.id + ":application",
                            title: t("admin.crew.accept") + " · " + a.name,
                            description: t("actionReview.crewApplicationHelp"),
                            details: (
                              <div className="space-y-2">
                                <h3 className="font-semibold">
                                  {t("admin.crew.originalApplication")}
                                </h3>
                                <p className="[overflow-wrap:anywhere] whitespace-pre-wrap">
                                  {a.message ?? "—"}
                                </p>
                              </div>
                            ),
                            confirmLabel: t("admin.crew.accept"),
                            commit: () =>
                              decideApp.mutateAsync({
                                applicationId: a.id,
                                action: "ACCEPT",
                              }),
                            refresh: refreshReviewed,
                            approvalId: queuedApprovalId,
                            renderError: (message) => (
                              <AcademicError message={message} />
                            ),
                          })
                        }
                      >
                        {t("admin.crew.accept")}
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        disabled={
                          busy ||
                          !!applications.error ||
                          review.blocked(a.id + ":application")
                        }
                        onClick={() =>
                          openReview("applications", {
                            key: a.id + ":application",
                            title: t("admin.crew.reject") + " · " + a.name,
                            description: t("actionReview.crewApplicationHelp"),
                            details: (
                              <div className="space-y-2">
                                <h3 className="font-semibold">
                                  {t("admin.crew.originalApplication")}
                                </h3>
                                <p className="[overflow-wrap:anywhere] whitespace-pre-wrap">
                                  {a.message ?? "—"}
                                </p>
                              </div>
                            ),
                            confirmLabel: t("admin.crew.reject"),
                            commit: () =>
                              decideApp.mutateAsync({
                                applicationId: a.id,
                                action: "REJECT",
                              }),
                            refresh: refreshReviewed,
                            approvalId: queuedApprovalId,
                            renderError: (message) => (
                              <AcademicError message={message} />
                            ),
                          })
                        }
                      >
                        {t("admin.crew.reject")}
                      </button>
                    </span>
                  )
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* Issued codes — accepted applicants awaiting registration. Revoking the code on
          /admin/registration-codes returns the application to the queue above. */}
      {feedback("codes")}
      {!hidden("codes") && (issuedCodes.data ?? []).length > 0 && (
        <section className="card overflow-hidden">
          <div className="px-5 py-3">
            <h2 className="section-title">{t("admin.crew.issuedHeading")}</h2>
            <p className="muted mt-1 text-xs">{t("admin.crew.issuedHint")}</p>
          </div>
          <div className="divide-y divide-slate-100 px-5 pb-3">
            {(issuedCodes.data ?? []).map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center gap-3 py-3 text-sm"
              >
                <span className="font-medium text-slate-800">{c.name}</span>
                {c.code && (
                  <span className="badge-green font-mono tracking-widest">
                    {c.code}
                  </span>
                )}
                <span className="muted ml-auto text-xs">
                  {t("admin.crew.issuedExpires", {
                    date: programFormat.dateTime(new Date(c.expiresAt), {
                      dateStyle: "medium",
                    }),
                  })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Opt-out / reentry requests */}
      <section className="card overflow-hidden">
        <div className="px-5 py-3">
          <h2 className="section-title">{t("admin.crew.requestsHeading")}</h2>
        </div>
        <div className="divide-y divide-slate-100 px-5 pb-3">
          {feedback("requests")}
          {requests.data !== undefined &&
          !requests.error &&
          !hidden("requests") &&
          reqs.length === 0 ? (
            <p className="muted py-2">{t("admin.crew.requestsEmpty")}</p>
          ) : (
            reqs.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-3 py-3 text-sm"
              >
                <span className="font-medium text-slate-800">{r.member}</span>
                <span
                  className={
                    r.kind === "OPT_OUT" ? "badge-amber" : "badge-green"
                  }
                >
                  {t(`admin.crew.reqKind.${r.kind}`)}
                </span>
                {r.reason && (
                  <TableDetails
                    title={`${t("admin.crew.originalRequest")} · ${r.member}`}
                  >
                    <p className="[overflow-wrap:anywhere] whitespace-pre-wrap">
                      {r.reason}
                    </p>
                  </TableDetails>
                )}
                <span className="muted ml-auto text-xs">
                  {r.approvable
                    ? t("admin.crew.cooldownDone")
                    : r.eligibleAt
                      ? t("admin.crew.cooldownUntil", {
                          date: programFormat.dateTime(new Date(r.eligibleAt), {
                            dateStyle: "medium",
                          }),
                        })
                      : ""}
                </span>
                {!readOnly && (
                  <span className="flex gap-2">
                    <button
                      className="btn-primary btn-sm"
                      disabled={
                        busy ||
                        !!requests.error ||
                        !r.approvable ||
                        review.blocked(r.id + ":request")
                      }
                      onClick={() =>
                        openReview("requests", {
                          key: r.id + ":request",
                          title: t("admin.crew.approve") + " · " + r.member,
                          description: t("actionReview.crewRequestHelp"),
                          details: (
                            <div className="space-y-2">
                              <p>{t(`admin.crew.reqKind.${r.kind}`)}</p>
                              <h3 className="font-semibold">
                                {t("admin.crew.originalRequest")}
                              </h3>
                              <p className="[overflow-wrap:anywhere] whitespace-pre-wrap">
                                {r.reason ?? "—"}
                              </p>
                            </div>
                          ),
                          confirmLabel: t("admin.crew.approve"),
                          commit: () =>
                            decideReq.mutateAsync({
                              requestId: r.id,
                              action: "APPROVE",
                            }),
                          refresh: refreshReviewed,
                          approvalId: queuedApprovalId,
                          renderError: (message) => (
                            <AcademicError message={message} />
                          ),
                        })
                      }
                    >
                      {t("admin.crew.approve")}
                    </button>
                    <button
                      className="btn-secondary btn-sm"
                      disabled={
                        busy ||
                        !!requests.error ||
                        review.blocked(r.id + ":request")
                      }
                      onClick={() =>
                        openReview("requests", {
                          key: r.id + ":request",
                          title: t("admin.crew.deny") + " · " + r.member,
                          description: t("actionReview.crewRequestHelp"),
                          details: (
                            <div className="space-y-2">
                              <p>{t(`admin.crew.reqKind.${r.kind}`)}</p>
                              <h3 className="font-semibold">
                                {t("admin.crew.originalRequest")}
                              </h3>
                              <p className="[overflow-wrap:anywhere] whitespace-pre-wrap">
                                {r.reason ?? "—"}
                              </p>
                            </div>
                          ),
                          confirmLabel: t("admin.crew.deny"),
                          commit: () =>
                            decideReq.mutateAsync({
                              requestId: r.id,
                              action: "DENY",
                            }),
                          refresh: refreshReviewed,
                          approvalId: queuedApprovalId,
                          renderError: (message) => (
                            <AcademicError message={message} />
                          ),
                        })
                      }
                    >
                      {t("admin.crew.deny")}
                    </button>
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* Patrol order */}
      <section className="card p-5">
        <h2 className="section-title">{t("admin.crew.orderHeading")}</h2>
        <p className="muted mt-1 text-xs">{t("admin.crew.orderHelp")}</p>
        {feedback("order")}
        {!hidden("order") && order.data !== undefined && (
          <>
            <ol className="mt-3 divide-y divide-slate-100">
              {rooms.map((room, i) => (
                <li key={room.id} className="flex items-center gap-3 py-2">
                  <span className="w-6 text-sm font-semibold text-slate-400">
                    {i + 1}
                  </span>
                  <span className="flex-1 font-medium text-slate-800">
                    {room.name}
                  </span>
                  {!readOnly && (
                    <div className="flex gap-1">
                      <button
                        className="btn-secondary btn-sm"
                        disabled={
                          i === 0 || setOrder.isPending || !!order.error
                        }
                        onClick={() => move(i, -1)}
                        aria-label={t("admin.crew.moveUp")}
                      >
                        ↑
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        disabled={
                          i === rooms.length - 1 ||
                          setOrder.isPending ||
                          !!order.error
                        }
                        onClick={() => move(i, 1)}
                        aria-label={t("admin.crew.moveDown")}
                      >
                        ↓
                      </button>
                    </div>
                  )}
                </li>
              ))}
              {rooms.length === 0 && !order.error && (
                <li className="muted py-2">{t("admin.crew.noRooms")}</li>
              )}
            </ol>
            {!readOnly && rooms.length > 0 && (
              <div className="mt-3 flex items-center gap-3">
                <button
                  className="btn-primary btn-sm"
                  disabled={
                    setOrder.isPending || !!order.error || !hasOrderChanges
                  }
                  onClick={() => {
                    if (
                      orderAdmission.current ||
                      !orderDirty.current ||
                      order.error
                    )
                      return;
                    orderAdmission.current = true;
                    setOrder.mutate({ roomIds: rooms.map((r) => r.id) });
                  }}
                >
                  {setOrder.isPending
                    ? t("admin.crew.saving")
                    : t("admin.crew.saveOrder")}
                </button>
                {setOrder.isSuccess && (
                  <span className="text-sm text-green-600">
                    {t("admin.crew.saved")}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* Crew roster */}
      <section className="card">
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="section-title">{t("admin.crew.rosterHeading")}</h2>
        </div>
        {feedback("roster")}
        {!hidden("roster") && roster.data !== undefined && (
          <SummaryTable label={t("admin.crew.rosterHeading")}>
            <thead>
              <tr>
                <th>{t("admin.crew.col.member")}</th>
                <th>{t("admin.crew.col.status")}</th>
                <th className="text-right">{t("admin.crew.col.patrols")}</th>
                <th className="text-right">{t("admin.crew.col.hours")}</th>
                <th className="table-actions-heading">
                  {t("tablePatterns.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(roster.data ?? []).map((u) => (
                <tr
                  key={u.id}
                  className={u.status === "ACTIVE" ? "" : "text-slate-400"}
                >
                  <td>
                    <span className="font-medium text-slate-800">{u.name}</span>
                  </td>
                  <td>
                    <span
                      className={
                        u.status === "ACTIVE"
                          ? "badge-green"
                          : u.status === "OPTED_OUT"
                            ? "badge-amber"
                            : "badge-slate"
                      }
                    >
                      {t(`admin.crew.status.${u.status}`)}
                    </span>
                  </td>
                  <td className="text-right">{u.patrols || ""}</td>
                  <td className="text-right">
                    {u.hours > 0 ? `${u.hours.toFixed(1)} h` : ""}
                  </td>
                  <TableActions>
                    {/* Membership context and status changes share the trailing text-link entry point. */}
                    <TableDetails title={u.name}>
                      <p>
                        {t(
                          u.tutor
                            ? "admin.crew.alsoTutor"
                            : "admin.crew.crewOnly",
                        )}
                      </p>
                      <dl className="space-y-3">
                        <div>
                          <dt className="muted">
                            {t("admin.crew.col.status")}
                          </dt>
                          <dd>{t(`admin.crew.status.${u.status}`)}</dd>
                        </div>
                        <div>
                          <dt className="muted">
                            {t("admin.crew.col.patrols")}
                          </dt>
                          <dd>{u.patrols}</dd>
                        </div>
                        <div>
                          <dt className="muted">{t("admin.crew.col.hours")}</dt>
                          <dd>{u.hours.toFixed(1)} h</dd>
                        </div>
                      </dl>
                    </TableDetails>
                    {!readOnly && (
                      <>
                        {u.status !== "ACTIVE" && (
                          <TableAction
                            disabled={
                              busy ||
                              !!roster.error ||
                              review.blocked(u.id + ":membership")
                            }
                            onClick={() =>
                              openReview("roster", {
                                key: u.id + ":membership",
                                title: t("actionReview.crewEnableTitle", {
                                  name: u.name,
                                }),
                                description: t("actionReview.crewEnableHelp"),
                                confirmLabel: t("admin.crew.enable"),
                                commit: () =>
                                  setStatus.mutateAsync({
                                    userId: u.id,
                                    status: "ACTIVE",
                                  }),
                                refresh: refreshReviewed,
                                approvalId: queuedApprovalId,
                                renderError: (message) => (
                                  <AcademicError message={message} />
                                ),
                                repeatAfterRefresh: true,
                              })
                            }
                          >
                            {t("admin.crew.enable")}
                          </TableAction>
                        )}
                        {u.status === "ACTIVE" && (
                          <TableAction
                            disabled={
                              busy ||
                              !!roster.error ||
                              review.blocked(u.id + ":membership")
                            }
                            onClick={() =>
                              openReview("roster", {
                                key: u.id + ":membership",
                                title: t("actionReview.crewDisableTitle", {
                                  name: u.name,
                                }),
                                description: t("actionReview.crewDisableHelp"),
                                confirmLabel: t("admin.crew.softRemove"),
                                commit: () =>
                                  setStatus.mutateAsync({
                                    userId: u.id,
                                    status: "INACTIVE",
                                  }),
                                refresh: refreshReviewed,
                                approvalId: queuedApprovalId,
                                renderError: (message) => (
                                  <AcademicError message={message} />
                                ),
                                repeatAfterRefresh: true,
                              })
                            }
                          >
                            {t("admin.crew.softRemove")}
                          </TableAction>
                        )}
                        {u.crewOnly && (
                          <TableAction
                            className="text-red-600"
                            disabled={
                              busy ||
                              !!roster.error ||
                              review.blocked(u.id + ":delete")
                            }
                            onClick={() =>
                              openReview("roster", {
                                key: u.id + ":delete",
                                title: t("admin.crew.deleteConfirm", {
                                  name: u.name,
                                }),
                                description: t("actionReview.crewDeleteHelp"),
                                confirmLabel: t("common.delete"),
                                commit: () =>
                                  removeCrew.mutateAsync({ userId: u.id }),
                                refresh: refreshReviewed,
                                approvalId: queuedApprovalId,
                                renderError: (message) => (
                                  <AcademicError message={message} />
                                ),
                              })
                            }
                          >
                            {t("admin.crew.delete")}
                          </TableAction>
                        )}
                      </>
                    )}
                  </TableActions>
                </tr>
              ))}
              {(roster.data ?? []).length === 0 && !roster.error && (
                <tr>
                  <td colSpan={5} className="text-slate-500">
                    {t("admin.crew.rosterEmpty")}
                  </td>
                </tr>
              )}
            </tbody>
          </SummaryTable>
        )}
      </section>
      {!readOnly && !reviewRevoked && review.dialog}
    </div>
  );
}
