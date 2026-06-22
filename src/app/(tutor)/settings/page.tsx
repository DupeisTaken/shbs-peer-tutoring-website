"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

export default function SettingsPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const profile = api.tutor.myProfile.useQuery();
  const me = api.tutor.me.useQuery();
  const statusReq = api.tutor.myStatusRequest.useQuery();

  const updateProfile = api.tutor.updateProfile.useMutation({
    onSuccess: () => utils.tutor.myProfile.invalidate(),
  });
  const changePassword = api.tutor.changePassword.useMutation();

  const refreshMembership = async () => {
    await Promise.all([
      utils.tutor.me.invalidate(),
      utils.tutor.myStatusRequest.invalidate(),
    ]);
  };
  const optOut = api.tutor.requestOptOut.useMutation({ onSuccess: refreshMembership });
  const reentry = api.tutor.requestReentry.useMutation({ onSuccess: refreshMembership });
  const recall = api.tutor.recallStatusRequest.useMutation({ onSuccess: refreshMembership });

  // Profile form — seeded from the loaded profile.
  const [altNames, setAltNames] = useState("");
  const [email, setEmail] = useState("");
  const [grade, setGrade] = useState("");
  const [optOutReason, setOptOutReason] = useState("");
  useEffect(() => {
    if (profile.data) {
      setAltNames(profile.data.alternativeNames ?? "");
      setEmail(profile.data.email ?? "");
      setGrade(profile.data.gradeLevel != null ? String(profile.data.gradeLevel) : "");
    }
  }, [profile.data]);

  // Password form.
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);

  const submitPassword = () => {
    setPwError(null);
    if (next.length < 8) {
      setPwError(t("tutor.settings.pwTooShort"));
      return;
    }
    if (next !== confirm) {
      setPwError(t("tutor.settings.pwMismatch"));
      return;
    }
    changePassword.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          setCurrent("");
          setNext("");
          setConfirm("");
        },
      },
    );
  };

  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-8">
      <div>
        <h1 className="page-title">{t("tutor.settings.title")}</h1>
        <p className="muted mt-1">{t("tutor.settings.subtitle")}</p>
      </div>

      {/* Profile */}
      <section className="card space-y-4 p-5">
        <h2 className="section-title">{t("tutor.settings.profileHeading")}</h2>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="label">{t("tutor.settings.name")}</p>
            <p className="mt-1 text-slate-800">{profile.data?.englishName ?? "—"}</p>
          </div>
          <div>
            <p className="label">{t("tutor.settings.username")}</p>
            <p className="mt-1 text-slate-800">
              {profile.data?.username ? `@${profile.data.username}` : "—"}
            </p>
          </div>
        </div>

        <label className="block space-y-1">
          <span className="label">{t("tutor.settings.grade")}</span>
          <input
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            type="number"
            min={6}
            max={12}
            className="input field-auto min-w-20"
          />
          <span className="muted text-xs">{t("tutor.settings.gradeHelp")}</span>
        </label>

        <label className="block space-y-1">
          <span className="label">{t("tutor.settings.altNames")}</span>
          <input
            value={altNames}
            onChange={(e) => setAltNames(e.target.value)}
            placeholder="中文名 / preferred name"
            lang="zh"
            className="input"
          />
          <span className="muted text-xs">{t("tutor.settings.altNamesHelp")}</span>
        </label>

        <label className="block space-y-1">
          <span className="label">{t("tutor.settings.email")}</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            className="input"
          />
          <span className="muted text-xs">{t("tutor.settings.emailHelp")}</span>
        </label>

        <div className="flex items-center gap-3">
          <button
            className="btn-primary"
            disabled={updateProfile.isPending}
            onClick={() =>
              updateProfile.mutate({
                alternativeNames: altNames.trim() || null,
                email: email.trim() || undefined,
                gradeLevel: grade.trim() ? Number(grade) : null,
              })
            }
          >
            {updateProfile.isPending ? t("tutor.settings.saving") : t("tutor.settings.save")}
          </button>
          {updateProfile.isSuccess && (
            <span className="text-sm text-green-600">{t("tutor.settings.saved")}</span>
          )}
          {updateProfile.error && (
            <span className="text-sm text-red-600">{updateProfile.error.message}</span>
          )}
        </div>
      </section>

      {/* Password */}
      <section className="card space-y-4 p-5">
        <h2 className="section-title">{t("tutor.settings.passwordHeading")}</h2>

        <label className="block space-y-1">
          <span className="label">{t("tutor.settings.currentPassword")}</span>
          <input
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            type="password"
            autoComplete="current-password"
            className="input"
          />
        </label>
        <label className="block space-y-1">
          <span className="label">{t("tutor.settings.newPassword")}</span>
          <input
            value={next}
            onChange={(e) => setNext(e.target.value)}
            type="password"
            autoComplete="new-password"
            minLength={8}
            className="input"
          />
          <span className="muted text-xs">{t("tutor.settings.pwHelp")}</span>
        </label>
        <label className="block space-y-1">
          <span className="label">{t("tutor.settings.confirmPassword")}</span>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            type="password"
            autoComplete="new-password"
            className="input"
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            className="btn-primary"
            disabled={changePassword.isPending || !current || !next}
            onClick={submitPassword}
          >
            {changePassword.isPending
              ? t("tutor.settings.changing")
              : t("tutor.settings.changePasswordBtn")}
          </button>
          {changePassword.isSuccess && (
            <span className="text-sm text-green-600">{t("tutor.settings.passwordChanged")}</span>
          )}
          {(pwError ?? changePassword.error) && (
            <span className="text-sm text-red-600">
              {pwError ?? changePassword.error?.message}
            </span>
          )}
        </div>
      </section>

      {/* Membership — opt-out / reentry */}
      <section className="card space-y-4 p-5">
        <h2 className="section-title">{t("tutor.settings.membershipHeading")}</h2>

        {statusReq.data ? (
          // There's an open request — show its state + a recall control.
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              {statusReq.data.kind === "OPT_OUT"
                ? statusReq.data.eligibleAt
                  ? t("tutor.settings.optOutPending", {
                      date: new Date(statusReq.data.eligibleAt).toLocaleDateString(),
                    })
                  : t("tutor.settings.optOutPendingNoDate")
                : t("tutor.settings.reentryPending")}
            </p>
            <button
              className="btn-secondary"
              disabled={recall.isPending}
              onClick={() => recall.mutate({ requestId: statusReq.data!.id })}
            >
              {t("tutor.settings.recall")}
            </button>
            {recall.error && <p className="text-sm text-red-600">{recall.error.message}</p>}
          </div>
        ) : me.data?.status === "ACTIVE" ? (
          // Active tutor — offer opt-out (with optional reason).
          <div className="space-y-3">
            <p className="muted text-sm">{t("tutor.settings.optOutHelp")}</p>
            <textarea
              value={optOutReason}
              onChange={(e) => setOptOutReason(e.target.value)}
              placeholder={t("tutor.settings.optOutReasonPlaceholder")}
              className="textarea w-full"
              rows={2}
            />
            <button
              className="btn-secondary"
              disabled={optOut.isPending}
              onClick={() => optOut.mutate({ reason: optOutReason.trim() || undefined })}
            >
              {t("tutor.settings.optOutBtn")}
            </button>
            {optOut.error && <p className="text-sm text-red-600">{optOut.error.message}</p>}
          </div>
        ) : me.data?.status === "OPTED_OUT" ? (
          // Opted out — offer reentry.
          <div className="space-y-3">
            <p className="muted text-sm">{t("tutor.settings.reentryHelp")}</p>
            <button
              className="btn-primary"
              disabled={reentry.isPending}
              onClick={() => reentry.mutate({})}
            >
              {t("tutor.settings.reentryBtn")}
            </button>
            {reentry.error && <p className="text-sm text-red-600">{reentry.error.message}</p>}
          </div>
        ) : (
          // Graduated / archived — informational only.
          <p className="muted text-sm">
            {t("tutor.settings.statusNote", {
              status: me.data ? t(`tutor.status.${me.data.status}`) : "",
            })}
          </p>
        )}
      </section>
    </main>
  );
}
