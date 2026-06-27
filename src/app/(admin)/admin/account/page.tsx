"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { SYMBOLS } from "~/lib/symbols";

/** Monogram initials for the identity pass — first+last initial, else the first two characters
 *  of whatever handle we have. Always uppercase; never empty. */
function initialsOf(name?: string | null, username?: string | null, email?: string | null): string {
  const display = (name ?? "").trim();
  if (display) {
    const parts = display.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
    return display.slice(0, 2).toUpperCase();
  }
  const handle = (username ?? email ?? "").trim();
  return handle.slice(0, 2).toUpperCase() || "··";
}

/**
 * Self-service account page for the admin area (admins, coordinators, head, viewers). Reachable
 * by clicking your name in the top bar. Edit your display name and change your password; for an
 * account that also tutors, a link through to the tutor settings is shown.
 */
export default function AccountPage() {
  const t = useTranslations();
  const router = useRouter();
  const utils = api.useUtils();
  const me = api.account.me.useQuery();
  const features = api.program.features.useQuery();
  const email2fa = features.data?.EMAIL_2FA ?? true;

  const updateName = api.account.updateName.useMutation({
    onSuccess: () => utils.account.me.invalidate(),
  });

  // Name form — seeded from the loaded account.
  const [name, setName] = useState("");
  useEffect(() => {
    if (me.data) setName(me.data.name ?? "");
  }, [me.data]);

  // Password form — a two-step flow: verify the current password to get an emailed code, then
  // submit the code with the new password (step-up email 2FA).
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  const resetPasswordForm = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setCode("");
    setSentTo(null);
    setPwError(null);
  };

  const requestCode = api.account.requestPasswordChangeCode.useMutation({
    onSuccess: (data) => setSentTo(data.email),
  });
  const changePassword = api.account.changePassword.useMutation({
    onSuccess: resetPasswordForm,
  });

  // Step 1: validate the new password locally, then ask for the emailed code.
  const sendCode = () => {
    setPwError(null);
    if (next.length < 8) {
      setPwError(t("tutor.settings.pwTooShort"));
      return;
    }
    if (next !== confirm) {
      setPwError(t("tutor.settings.pwMismatch"));
      return;
    }
    if (email2fa) {
      requestCode.mutate({ currentPassword: current });
    } else {
      // Email 2FA off — no emailed code step; change directly with the current password.
      changePassword.mutate({ currentPassword: current, newPassword: next });
    }
  };

  // Step 2: submit the new password with the emailed code.
  const submitPassword = () => {
    setPwError(null);
    changePassword.mutate({ currentPassword: current, newPassword: next, code: code.trim() });
  };

  const role = me.data?.role;
  const roleBadge = role === "HEAD" ? "badge-green" : "badge-slate";
  const initials = initialsOf(me.data?.name, me.data?.username, me.data?.email);

  return (
    // A VIEWER may still manage their OWN login here — this self-service page is intentionally
    // interactive for everyone (the read-only treatment hides cross-program mutation panels, not
    // your own account controls).
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{t("account.title")}</h1>
          <p className="muted mt-1">{t("account.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("common.close")}
          title={t("common.close")}
          className="-mr-1 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-none"
        >
          <span aria-hidden className="text-lg leading-none">
            {SYMBOLS.close}
          </span>
        </button>
      </div>

      {/* Identity pass — the account's monogram, name, @handle (its call-sign) and role. */}
      <section className="card overflow-hidden">
        <div className="bg-gradient-to-br from-accent-50 to-white px-5 py-5 sm:px-6">
          <div className="flex items-start gap-4">
            <div
              aria-hidden
              className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent-600 text-lg font-bold text-white shadow-sm ring-2 ring-white"
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="truncate text-xl font-bold tracking-tight text-slate-900">
                  {me.data?.name ?? "—"}
                </h2>
                {role && (
                  <span className={roleBadge}>{t(`admin.users.roles.${role}`)}</span>
                )}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <span className="font-mono font-medium text-accent-700">
                  {me.data?.username ? `@${me.data.username}` : "—"}
                </span>
                {me.data?.email && (
                  <>
                    <span className="text-slate-300" aria-hidden>
                      {SYMBOLS.dot}
                    </span>
                    <span className="truncate text-slate-500">{me.data.email}</span>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Editable display name + the optional tutor cross-link. */}
        <div className="space-y-4 border-t border-slate-100 px-5 py-5 sm:px-6">
          <label className="block space-y-1">
            <span className="label">{t("tutor.settings.name")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input min-w-60 flex-1"
              />
              <button
                className="btn-secondary"
                disabled={updateName.isPending || !name.trim()}
                onClick={() => updateName.mutate({ name: name.trim() })}
              >
                {updateName.isPending ? t("tutor.settings.saving") : t("tutor.settings.save")}
              </button>
            </div>
          </label>
          {updateName.isSuccess && (
            <p className="text-sm text-green-600">{t("tutor.settings.saved")}</p>
          )}
          {updateName.error && (
            <p className="text-sm text-red-600">{updateName.error.message}</p>
          )}

          {me.data?.tutor && (
            <p className="muted flex items-center gap-1.5 border-t border-slate-100 pt-4 text-sm">
              <span>{t("account.tutorNote")}</span>
              <Link href="/settings" className="link">
                {t("account.openTutorSettings")} →
              </Link>
            </p>
          )}
        </div>
      </section>

      {/* Password — two-step: verify current password to email a code, then submit code + new pw. */}
      <section className="card space-y-4 p-5 sm:p-6">
        <div>
          <h2 className="section-title">{t("tutor.settings.passwordHeading")}</h2>
          {email2fa && (
            <p className="muted mt-1 text-sm">{t("account.password.twoFactorHint")}</p>
          )}
        </div>

        <label className="block space-y-1">
          <span className="label">{t("tutor.settings.currentPassword")}</span>
          <input
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            type="password"
            autoComplete="current-password"
            disabled={!!sentTo}
            className="input"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="label">{t("tutor.settings.newPassword")}</span>
            <input
              value={next}
              onChange={(e) => setNext(e.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              disabled={!!sentTo}
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
              disabled={!!sentTo}
              className="input"
            />
          </label>
        </div>

        {/* Step 2 appears once the code is emailed. */}
        {sentTo && (
          <div className="space-y-2 rounded-lg border border-accent-200 bg-accent-50/60 p-4">
            <p className="text-sm text-slate-700">
              {t("account.password.codeSent", { email: sentTo })}
            </p>
            <label className="block space-y-1">
              <span className="label">{t("account.password.codeLabel")}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 5))}
                autoCapitalize="characters"
                autoComplete="one-time-code"
                maxLength={5}
                placeholder="XXXXX"
                className="input field-auto min-w-40 font-mono uppercase tracking-[0.3em]"
              />
            </label>
            <button
              type="button"
              className="link text-xs"
              disabled={requestCode.isPending}
              onClick={() => requestCode.mutate({ currentPassword: current })}
            >
              {t("account.password.resend")}
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          {!sentTo ? (
            <button
              className="btn-primary"
              disabled={
                (email2fa ? requestCode.isPending : changePassword.isPending) ||
                !current ||
                !next ||
                !confirm
              }
              onClick={sendCode}
            >
              {email2fa
                ? requestCode.isPending
                  ? t("account.password.sending")
                  : t("account.password.sendCode")
                : changePassword.isPending
                  ? t("tutor.settings.changing")
                  : t("tutor.settings.changePasswordBtn")}
            </button>
          ) : (
            <>
              <button
                className="btn-primary"
                disabled={changePassword.isPending || !code.trim()}
                onClick={submitPassword}
              >
                {changePassword.isPending
                  ? t("tutor.settings.changing")
                  : t("tutor.settings.changePasswordBtn")}
              </button>
              <button type="button" className="btn-secondary" onClick={resetPasswordForm}>
                {t("account.password.cancel")}
              </button>
            </>
          )}
          {changePassword.isSuccess && (
            <span className="text-sm text-green-600">{t("tutor.settings.passwordChanged")}</span>
          )}
          {(pwError ?? changePassword.error ?? requestCode.error) && (
            <span className="text-sm text-red-600">
              {pwError ?? changePassword.error?.message ?? requestCode.error?.message}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
