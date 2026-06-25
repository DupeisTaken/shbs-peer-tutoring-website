"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { useReadOnly } from "~/app/_components/read-only";

/**
 * Crew admin hub: review crew applications, approve opt-out/reentry requests, manage the crew
 * roster (status + soft-remove + hard-delete crew-only logins), and edit the room patrol order.
 * Crew service hours (0.5h/patrol) are tallied separately from tutoring. VIEWER is read-only.
 */
export default function CrewPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();

  const order = api.admin.patrolOrder.useQuery();
  const roster = api.admin.crewRoster.useQuery();
  const applications = api.admin.crewApplications.useQuery();
  const requests = api.admin.crewRequests.useQuery();
  const issuedCodes = api.admin.crewIssuedCodes.useQuery();

  const invalidateAll = () =>
    Promise.all([
      utils.admin.crewRoster.invalidate(),
      utils.admin.crewApplications.invalidate(),
      utils.admin.crewRequests.invalidate(),
      utils.admin.crewIssuedCodes.invalidate(),
      utils.admin.crewSummary.invalidate(),
    ]);

  const setOrder = api.admin.setPatrolOrder.useMutation({
    onSuccess: () => utils.admin.patrolOrder.invalidate(),
  });
  const setStatus = api.admin.setCrewStatus.useMutation({ onSuccess: invalidateAll });
  const removeCrew = api.admin.deleteCrewMember.useMutation({ onSuccess: invalidateAll });
  const [issuedCode, setIssuedCode] = useState<Record<string, string>>({});
  const decideApp = api.admin.decideCrewApplication.useMutation({
    onSuccess: (res, vars) => {
      if (res.code) setIssuedCode((m) => ({ ...m, [vars.applicationId]: res.code! }));
      void invalidateAll();
    },
  });
  const decideReq = api.admin.decideCrewRequest.useMutation({ onSuccess: invalidateAll });

  // Local, reorderable copy of the room order.
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (order.data) setRooms(order.data.map((r) => ({ id: r.id, name: r.name })));
  }, [order.data]);

  const move = (i: number, dir: -1 | 1) => {
    setRooms((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };

  const apps = applications.data ?? [];
  const reqs = requests.data ?? [];
  const busy = setStatus.isPending || removeCrew.isPending || decideApp.isPending || decideReq.isPending;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">{t("admin.crew.title")}</h1>
        <p className="muted mt-1">{t("admin.crew.subtitle")}</p>
      </div>

      {(decideApp.error ?? decideReq.error ?? setStatus.error ?? removeCrew.error ?? setOrder.error) && (
        <p className="text-sm text-red-600">
          {(decideApp.error ?? decideReq.error ?? setStatus.error ?? removeCrew.error ?? setOrder.error)?.message}
        </p>
      )}

      {/* Crew applications */}
      <section className="card overflow-hidden">
        <div className="px-5 py-3">
          <h2 className="section-title">{t("admin.crew.applicationsHeading")}</h2>
        </div>
        <div className="divide-y divide-slate-100 px-5 pb-3">
          {apps.length === 0 ? (
            <p className="muted py-2">{t("admin.crew.applicationsEmpty")}</p>
          ) : (
            apps.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="font-medium text-slate-800">{a.name}</span>
                {a.gradeLevel != null && <span className="badge-slate">G{a.gradeLevel}</span>}
                <span className="muted text-xs">{a.preferredContact ?? a.email}</span>
                {a.message && <span className="muted truncate text-xs italic">“{a.message}”</span>}
                {issuedCode[a.id] ? (
                  <span className="badge-green ml-auto font-mono tracking-widest">
                    {t("admin.crew.codeIssued", { code: issuedCode[a.id]! })}
                  </span>
                ) : (
                  !readOnly && (
                    <span className="ml-auto flex gap-2">
                      <button
                        className="btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => decideApp.mutate({ applicationId: a.id, action: "ACCEPT" })}
                      >
                        {t("admin.crew.accept")}
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        disabled={busy}
                        onClick={() => decideApp.mutate({ applicationId: a.id, action: "REJECT" })}
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
      {(issuedCodes.data ?? []).length > 0 && (
        <section className="card overflow-hidden">
          <div className="px-5 py-3">
            <h2 className="section-title">{t("admin.crew.issuedHeading")}</h2>
            <p className="muted mt-1 text-xs">{t("admin.crew.issuedHint")}</p>
          </div>
          <div className="divide-y divide-slate-100 px-5 pb-3">
            {(issuedCodes.data ?? []).map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="font-medium text-slate-800">{c.name}</span>
                {c.code && (
                  <span className="badge-green font-mono tracking-widest">{c.code}</span>
                )}
                <span className="muted ml-auto text-xs">
                  {t("admin.crew.issuedExpires", { date: new Date(c.expiresAt).toLocaleDateString() })}
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
          {reqs.length === 0 ? (
            <p className="muted py-2">{t("admin.crew.requestsEmpty")}</p>
          ) : (
            reqs.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="font-medium text-slate-800">{r.member}</span>
                <span className={r.kind === "OPT_OUT" ? "badge-amber" : "badge-green"}>
                  {t(`admin.crew.reqKind.${r.kind}`)}
                </span>
                {r.reason && <span className="muted truncate text-xs italic">“{r.reason}”</span>}
                <span className="muted ml-auto text-xs">
                  {r.approvable
                    ? t("admin.crew.cooldownDone")
                    : r.eligibleAt
                      ? t("admin.crew.cooldownUntil", { date: new Date(r.eligibleAt).toLocaleDateString() })
                      : ""}
                </span>
                {!readOnly && (
                  <span className="flex gap-2">
                    <button
                      className="btn-primary btn-sm"
                      disabled={busy || !r.approvable}
                      onClick={() => decideReq.mutate({ requestId: r.id, action: "APPROVE" })}
                    >
                      {t("admin.crew.approve")}
                    </button>
                    <button
                      className="btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => decideReq.mutate({ requestId: r.id, action: "DENY" })}
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
        <ol className="mt-3 divide-y divide-slate-100">
          {rooms.map((room, i) => (
            <li key={room.id} className="flex items-center gap-3 py-2">
              <span className="w-6 text-sm font-semibold text-slate-400">{i + 1}</span>
              <span className="flex-1 font-medium text-slate-800">{room.name}</span>
              {!readOnly && (
                <div className="flex gap-1">
                  <button
                    className="btn-secondary btn-sm"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={t("admin.crew.moveUp")}
                  >
                    ↑
                  </button>
                  <button
                    className="btn-secondary btn-sm"
                    disabled={i === rooms.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={t("admin.crew.moveDown")}
                  >
                    ↓
                  </button>
                </div>
              )}
            </li>
          ))}
          {rooms.length === 0 && <li className="muted py-2">{t("admin.crew.noRooms")}</li>}
        </ol>
        {!readOnly && rooms.length > 0 && (
          <div className="mt-3 flex items-center gap-3">
            <button
              className="btn-primary btn-sm"
              disabled={setOrder.isPending}
              onClick={() => setOrder.mutate({ roomIds: rooms.map((r) => r.id) })}
            >
              {setOrder.isPending ? t("admin.crew.saving") : t("admin.crew.saveOrder")}
            </button>
            {setOrder.isSuccess && <span className="text-sm text-green-600">{t("admin.crew.saved")}</span>}
          </div>
        )}
      </section>

      {/* Crew roster */}
      <section className="card overflow-x-auto">
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="section-title">{t("admin.crew.rosterHeading")}</h2>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("admin.crew.col.member")}</th>
              <th>{t("admin.crew.col.status")}</th>
              <th className="text-right">{t("admin.crew.col.patrols")}</th>
              <th className="text-right">{t("admin.crew.col.hours")}</th>
              <th>{t("admin.crew.col.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {(roster.data ?? []).map((u) => (
              <tr key={u.id} className={u.status === "ACTIVE" ? "" : "text-slate-400"}>
                <td>
                  <span className="font-medium text-slate-800">{u.name}</span>
                  {u.tutor ? (
                    <span className="muted ml-2 text-xs">{t("admin.crew.alsoTutor")}</span>
                  ) : (
                    <span className="muted ml-2 text-xs">{t("admin.crew.crewOnly")}</span>
                  )}
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
                <td className="text-right">{u.hours > 0 ? `${u.hours.toFixed(1)} h` : ""}</td>
                <td>
                  {!readOnly && (
                    <div className="flex flex-wrap gap-2">
                      {u.status !== "ACTIVE" && (
                        <button
                          className="btn-secondary btn-sm"
                          disabled={busy}
                          onClick={() => setStatus.mutate({ userId: u.id, status: "ACTIVE" })}
                        >
                          {t("admin.crew.enable")}
                        </button>
                      )}
                      {u.status === "ACTIVE" && (
                        <button
                          className="btn-secondary btn-sm"
                          disabled={busy}
                          onClick={() => setStatus.mutate({ userId: u.id, status: "INACTIVE" })}
                        >
                          {t("admin.crew.softRemove")}
                        </button>
                      )}
                      {u.crewOnly && (
                        <button
                          className="btn-danger btn-sm"
                          disabled={busy}
                          onClick={() => {
                            if (confirm(t("admin.crew.deleteConfirm", { name: u.name }))) {
                              removeCrew.mutate({ userId: u.id });
                            }
                          }}
                        >
                          {t("admin.crew.delete")}
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {(roster.data ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="text-slate-500">
                  {t("admin.crew.rosterEmpty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
