"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";

/** One shared address manager for account and tutor settings. Passwords remain local to the form. */
export function AccountEmails() {
  const t = useTranslations("accountEmails");
  const utils = api.useUtils();
  const settings = api.account.emailSettings.useQuery();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = async () => {
    await Promise.all([
      utils.account.emailSettings.invalidate(),
      utils.account.me.invalidate(),
      utils.tutor.myProfile.invalidate(),
    ]);
  };
  const request = api.account.requestSecondaryEmail.useMutation({
    onSuccess: async (_, input) => {
      setSelected(input.email.trim().toLowerCase());
      setCode("");
      setEmail("");
      setPassword("");
      setNotice(t("sent"));
      await refresh();
    },
  });
  const confirm = api.account.confirmSecondaryEmail.useMutation({
    onSuccess: async () => {
      setSelected("");
      setCode("");
      setNotice(t("verifiedNotice"));
      await refresh();
    },
  });
  const manage = api.account.manageSecondaryEmail.useMutation({
    onSuccess: async () => {
      setPassword("");
      setSelected("");
      setCode("");
      setNotice(t("saved"));
      await refresh();
    },
  });
  const busy = request.isPending || confirm.isPending || manage.isPending;
  const error =
    request.error ?? confirm.error ?? manage.error ?? settings.error;
  const clear = () => {
    request.reset();
    confirm.reset();
    manage.reset();
    setNotice("");
  };
  const data = settings.data;

  return (
    <section
      className="card overflow-hidden"
      aria-labelledby="account-emails-heading"
    >
      <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
        <h2 id="account-emails-heading" className="section-title">
          {t("title")}
        </h2>
        <p className="muted mt-1 text-sm">{t("help")}</p>
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        {settings.isLoading && <p className="muted">{t("loading")}</p>}
        {data && (
          <>
            <ul className="divide-y divide-slate-100">
              {data.emails.map((address) => (
                <li
                  key={address.email}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
                >
                  <div className="min-w-0 flex-1 basis-52">
                    <p className="text-sm font-medium break-all text-slate-900">
                      {address.email}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {address.email === data.email && (
                        <span className="badge-green">{t("primary")}</span>
                      )}
                      <span
                        className={
                          address.verifiedAt ? "badge-slate" : "badge-amber"
                        }
                      >
                        {t(address.verifiedAt ? "verified" : "pending")}
                      </span>
                    </div>
                  </div>
                  {address.email !== data.email && (
                    <div className="flex flex-wrap gap-2">
                      {address.verifiedAt ? (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          disabled={busy || !password}
                          onClick={() => {
                            clear();
                            manage.mutate({
                              email: address.email,
                              currentPassword: password,
                              action: "primary",
                            });
                          }}
                        >
                          {t("makePrimary")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          disabled={busy}
                          onClick={() => {
                            clear();
                            setSelected(address.email);
                            setCode("");
                          }}
                        >
                          {t("verify")}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={busy || !password}
                        onClick={() => {
                          clear();
                          manage.mutate({
                            email: address.email,
                            currentPassword: password,
                            action: "remove",
                          });
                        }}
                      >
                        {t(address.verifiedAt ? "remove" : "cancel")}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <label className="block space-y-1 border-t border-slate-100 pt-4">
              <span className="label">{t("password")}</span>
              <input
                type="password"
                aria-label={t("password")}
                aria-describedby="associated-email-password-help"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
              />
              <span
                id="associated-email-password-help"
                className="muted block text-xs"
              >
                {t("passwordHelp")}
              </span>
            </label>
            {!data.deliveryAvailable && (
              <p className="text-sm text-amber-800">{t("unavailable")}</p>
            )}
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                clear();
                request.mutate({ email, currentPassword: password });
              }}
            >
              <label className="block space-y-1">
                <span className="label">{t("addLabel")}</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                  required
                  className="input"
                />
              </label>
              <button
                className="btn-primary"
                disabled={
                  busy ||
                  !password ||
                  !email.trim() ||
                  !data.deliveryAvailable ||
                  data.emails.length >= 6
                }
              >
                {t(busy ? "working" : "add")}
              </button>
              <p className="muted text-xs">{t("limit")}</p>
            </form>
            {selected && (
              <form
                className="border-accent-200 bg-accent-50/50 space-y-3 rounded-lg border p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  clear();
                  confirm.mutate({ email: selected, code });
                }}
              >
                <p className="text-sm font-medium break-all">
                  {t("verifyAddress", { email: selected })}
                </p>
                <label className="block space-y-1">
                  <span className="label">{t("code")}</span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    autoComplete="one-time-code"
                    maxLength={30}
                    className="input font-mono tracking-widest"
                    required
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-primary"
                    disabled={busy || !code.trim()}
                  >
                    {t("verify")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy || !password || !data.deliveryAvailable}
                    onClick={() => {
                      clear();
                      request.mutate({
                        email: selected,
                        currentPassword: password,
                      });
                    }}
                  >
                    {t("resend")}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
        {notice && (
          <p role="status" className="text-sm text-green-700">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error.message}
          </p>
        )}
      </div>
    </section>
  );
}

/** Server data seeds a keyed form only after a save/refetch; typing never fights an effect. */
export function EmailPreferences() {
  const t = useTranslations("emailPreferences");
  const settings = api.account.emailSettings.useQuery();
  const [saved, setSaved] = useState(false);
  if (!settings.data)
    return settings.error ? <p role="alert">{settings.error.message}</p> : null;
  const data = settings.data;
  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <div>
        <h2 className="section-title">{t("title")}</h2>
        <p className="muted mt-1 text-sm">{t("help")}</p>
      </div>
      {!data.enabled && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          {t("disabled")}
        </p>
      )}
      <PreferenceForm
        key={[
          data.enabled,
          data.emailSecurity,
          data.emailMessages,
          data.emailInfo,
          data.emailSecondaryRecipients,
        ].join(":")}
        data={data}
        onSaved={setSaved}
      />
      {saved && (
        <p role="status" className="text-sm text-green-700">
          {t("saved")}
        </p>
      )}
    </section>
  );
}

function PreferenceForm({
  data,
  onSaved,
}: {
  data: {
    enabled: boolean;
    emailSecurity: boolean;
    emailMessages: boolean;
    emailInfo: boolean;
    emailSecondaryRecipients: boolean;
  };
  onSaved: (saved: boolean) => void;
}) {
  const t = useTranslations("emailPreferences");
  const utils = api.useUtils();
  const [preferences, setPreferences] = useState({
    emailSecurity: data.emailSecurity,
    emailMessages: data.emailMessages,
    emailInfo: data.emailInfo,
    emailSecondaryRecipients: data.emailSecondaryRecipients,
  });
  const save = api.account.setEmailPreferences.useMutation({
    onSuccess: async () => {
      onSaved(true);
      await utils.account.emailSettings.invalidate();
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(preferences);
      }}
    >
      <fieldset
        disabled={!data.enabled || save.isPending}
        className="divide-y divide-slate-100 disabled:opacity-60"
      >
        {(
          [
            "emailSecurity",
            "emailMessages",
            "emailInfo",
            "emailSecondaryRecipients",
          ] as const
        ).map((key) => (
          <label
            key={key}
            className="flex cursor-pointer items-start gap-3 py-3"
          >
            <input
              type="checkbox"
              checked={preferences[key]}
              onChange={(e) => {
                onSaved(false);
                setPreferences({ ...preferences, [key]: e.target.checked });
              }}
              className="accent-accent-600 mt-1 h-4 w-4 shrink-0"
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">
                {t(key)}
              </span>
              <span className="muted block text-xs">{t(`${key}Help`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="muted text-xs">{t("essential")}</p>
      <button
        className="btn-primary"
        disabled={!data.enabled || save.isPending}
      >
        {t(save.isPending ? "saving" : "save")}
      </button>
      {save.error && (
        <p role="alert" className="text-sm text-red-700">
          {save.error.message}
        </p>
      )}
    </form>
  );
}
