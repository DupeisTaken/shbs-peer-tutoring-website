"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

type RefreshResult = {
  name: string;
  crossedYear: boolean;
  archivedTutees: number;
  archivedUnavailableTutors: number;
  graduatedTutors: number;
  agedTutors: number;
};

export default function ProgramPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const current = api.admin.currentPeriod.useQuery();
  const tutors = api.admin.tutors.useQuery();

  const [confirm, setConfirm] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [available, setAvailable] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<RefreshResult | null>(null);

  const refresh = api.admin.refresh.useMutation({
    onSuccess: async (res) => {
      setConfirm("");
      setReviewing(false);
      setAvailable({});
      setDone(res);
      await utils.admin.invalidate();
    },
  });

  const period = current.data;
  const activeTutors = useMemo(
    () => (tutors.data ?? []).filter((tu) => tu.active),
    [tutors.data],
  );
  const confirmOk = confirm.trim().toUpperCase() === "REFRESH";
  const isGraduating = (gradeLevel: number | null) =>
    !!period?.next.graduates && (gradeLevel ?? 0) >= 12;

  const submit = () => {
    if (!period) return;
    setDone(null);
    // On a semester rollover, archive active tutors the crew unchecked (graduating ones leave anyway).
    const unavailableTutorIds = period.next.crossesSemester
      ? activeTutors
          .filter((tu) => !isGraduating(tu.gradeLevel) && available[tu.id] === false)
          .map((tu) => tu.id)
      : undefined;
    refresh.mutate({ confirm, unavailableTutorIds });
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="page-title">{t("admin.program.title")}</h1>
        <p className="muted mt-1">{t("admin.program.subtitle")}</p>
      </div>

      {current.isLoading ? (
        <p className="muted">{t("admin.program.loading")}</p>
      ) : !period ? (
        <p className="text-sm text-red-600">{t("admin.program.noPeriod")}</p>
      ) : (
        <>
          <section className="card p-5">
            <p className="muted text-xs">{t("admin.program.currentPeriod")}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{period.name}</p>
            <p className="muted mt-1">
              {t("admin.program.semester", { semester: period.semester })}
            </p>
          </section>

          <section className="card border-amber-200 p-5">
            <h2 className="section-title">{t("admin.program.refreshHeading")}</h2>
            <p className="muted mt-1">
              {t("admin.program.advancesTo", { name: period.next.name })}
            </p>

            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>{t("admin.program.effectPending")}</li>
              <li>{t("admin.program.effectTutees")}</li>
              <li>{t("admin.program.effectPairings")}</li>
              {period.next.crossesSemester && <li>{t("admin.program.effectAvailability")}</li>}
              {period.next.graduates && <li>{t("admin.program.effectGraduate")}</li>}
              {period.next.crossesYear && <li>{t("admin.program.effectAgeUp")}</li>}
              <li>
                {period.next.crossesSemester
                  ? t("admin.program.effectHoursReset", { semester: period.next.semester })
                  : t("admin.program.effectHoursKeep")}
              </li>
            </ul>

            <div className="mt-4">
              {period.next.crossesSemester ? (
                <button className="btn-primary" onClick={() => { setDone(null); setReviewing(true); }}>
                  {t("admin.program.reviewButton")}
                </button>
              ) : (
                <div className="space-y-2">
                  <label className="label">{t("admin.program.confirmLabel")}</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder={t("admin.program.confirmPlaceholder")}
                      className="input field-auto min-w-44"
                    />
                    <button className="btn-danger" disabled={!confirmOk || refresh.isPending} onClick={submit}>
                      {refresh.isPending
                        ? t("admin.program.refreshing")
                        : t("admin.program.refreshButton", { name: period.next.name })}
                    </button>
                  </div>
                </div>
              )}
              {refresh.error && <p className="mt-2 text-sm text-red-600">{refresh.error.message}</p>}
              {done && (
                <p className="mt-2 text-sm text-green-700">
                  {t("admin.program.done", { name: done.name, count: done.archivedTutees })}
                  {(done.graduatedTutors > 0 || done.agedTutors > 0) &&
                    ` ${t("admin.program.doneGrad", { graduated: done.graduatedTutors, aged: done.agedTutors })}`}
                </p>
              )}
            </div>
          </section>
        </>
      )}

      {/* Semester-rollover availability review modal */}
      {reviewing && period && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="card flex max-h-[85vh] w-full max-w-lg flex-col p-5">
            <h2 className="section-title">
              {t("admin.program.modalTitle", { name: period.next.name })}
            </h2>
            <p className="muted mt-1 text-sm">{t("admin.program.modalIntro")}</p>
            {period.next.graduates && (
              <p className="mt-1 text-sm text-amber-700">{t("admin.program.modalGradNote")}</p>
            )}

            <div className="mt-3 flex-1 space-y-1 overflow-auto border-y border-slate-100 py-2">
              {activeTutors.length === 0 && (
                <p className="muted text-sm">{t("admin.program.noActiveTutors")}</p>
              )}
              {activeTutors.map((tu) => {
                const grad = isGraduating(tu.gradeLevel);
                return (
                  <div key={tu.id} className="flex items-center justify-between gap-2 px-1 py-1 text-sm">
                    <span className="truncate">
                      {tu.englishName}
                      {tu.gradeLevel != null && (
                        <span className="muted ml-1 text-xs">G{tu.gradeLevel}</span>
                      )}
                    </span>
                    {grad ? (
                      <span className="badge-amber shrink-0">{t("admin.program.graduating")}</span>
                    ) : (
                      <label className="flex shrink-0 items-center gap-1 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={available[tu.id] !== false}
                          onChange={(e) =>
                            setAvailable((a) => ({ ...a, [tu.id]: e.target.checked }))
                          }
                        />
                        {t("admin.program.available")}
                      </label>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 space-y-2">
              <label className="label">{t("admin.program.confirmLabel")}</label>
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t("admin.program.confirmPlaceholder")}
                className="input field-auto min-w-44"
              />
              <div className="flex items-center gap-3">
                <button className="btn-danger" disabled={!confirmOk || refresh.isPending} onClick={submit}>
                  {refresh.isPending
                    ? t("admin.program.refreshing")
                    : t("admin.program.refreshButton", { name: period.next.name })}
                </button>
                <button
                  className="link text-sm"
                  onClick={() => { setReviewing(false); setConfirm(""); }}
                >
                  {t("admin.program.cancel")}
                </button>
                {refresh.error && <span className="text-sm text-red-600">{refresh.error.message}</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
