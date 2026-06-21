"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

export default function SettingsPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const profile = api.tutor.myProfile.useQuery();

  const updateProfile = api.tutor.updateProfile.useMutation({
    onSuccess: () => utils.tutor.myProfile.invalidate(),
  });
  const changePassword = api.tutor.changePassword.useMutation();

  // Profile form — seeded from the loaded profile.
  const [altNames, setAltNames] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => {
    if (profile.data) {
      setAltNames(profile.data.alternativeNames ?? "");
      setEmail(profile.data.email ?? "");
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
          <div>
            <p className="label">{t("tutor.settings.grade")}</p>
            <p className="mt-1 text-slate-800">
              {profile.data?.gradeLevel != null ? `G${profile.data.gradeLevel}` : "—"}
            </p>
          </div>
        </div>

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
    </main>
  );
}
