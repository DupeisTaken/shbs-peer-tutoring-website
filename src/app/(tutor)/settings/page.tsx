"use client";
import { useSessionPageScroll } from "~/app/_components/session-view-state";
import {
  ConfiguredPersonNameFields as PersonNameFields,
  useNameFieldPresentation,
} from "~/app/_components/person-name-fields";
import { TutorWorkloadPreference } from "~/app/_components/tutor-workload-preference";
import {
  nameDraft,
  personNameEdit,
  unsplitLegacyName,
} from "~/lib/person-name";

import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { api, type RouterOutputs } from "~/trpc/react";
import { Button } from "~/app/_components/ui/button";
import {
  FormSection,
  FormActions,
  InlineNotice,
  StatePanel,
} from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { SchoolDeparturePanel } from "~/app/_components/school-departure";
import { AcademicPanel } from "~/app/_components/academic-profile";
import { ProfilePolicyError } from "~/app/_components/profile-policy";
import { AcademicError } from "~/app/_components/academic-error";
import { signInAfterPasswordChange } from "~/lib/password-session";
import { TwoFactorSettings } from "~/app/_components/two-factor-settings";
import {
  AccountEmails,
  EmailPreferences,
} from "~/app/_components/account-emails";

export default function SettingsPage() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const [profileDenied, setProfileDenied] = useState(false);
  const profile = api.tutor.myProfile.useQuery(undefined, {
    enabled: !profileDenied,
  });
  const me = api.tutor.me.useQuery();
  const statusReq = api.tutor.myStatusRequest.useQuery();
  const features = api.program.features.useQuery();
  const email2fa = features.data?.EMAIL_2FA;
  const recovery = useTranslations("participantRecovery");
  const profileAdmission = useRef(false);
  const passwordAdmission = useRef(false);
  const membershipAdmission = useRef(false);
  const [profileReloading, setProfileReloading] = useState(false);
  const [profileCommitted, setProfileCommitted] = useState(false);
  const [profileSyncError, setProfileSyncError] = useState(false);
  const deniedNow =
    profile.error?.data?.code === "FORBIDDEN" ||
    profile.error?.data?.code === "UNAUTHORIZED";
  useSessionPageScroll({
    id: "tutor-settings-v1",
    ready: !!profile.data && !!me.data,
    enabled: !profileDenied && !deniedNow,
  });
  useEffect(() => {
    // One eviction per denial episode keeps recovery bounded if another owner
    // subscribes to this profile; only successful explicit recovery clears the latch.
    if (!deniedNow || profileDenied) return;
    setProfileDenied(true);
    queryClient.removeQueries({
      queryKey: getQueryKey(api.tutor.myProfile, undefined, "query"),
    });
  }, [deniedNow, profileDenied, queryClient]);

  const updateProfile = api.tutor.updateProfile.useMutation({
    onSuccess: async () => {
      // Acceptance locks only this section until a fresh authoritative snapshot is adopted.
      setProfileCommitted(true);
      await refreshProfile();
    },
    onSettled: () => {
      profileAdmission.current = false;
    },
  });

  const refreshMembership = async () => {
    await Promise.all([
      utils.tutor.me.invalidate(),
      utils.tutor.myStatusRequest.invalidate(),
    ]);
  };
  const optOut = api.tutor.requestOptOut.useMutation({
    onSuccess: refreshMembership,
    onSettled: () => {
      membershipAdmission.current = false;
    },
  });
  const reentry = api.tutor.requestReentry.useMutation({
    onSuccess: refreshMembership,
    onSettled: () => {
      membershipAdmission.current = false;
    },
  });
  const recall = api.tutor.recallStatusRequest.useMutation({
    onSuccess: refreshMembership,
    onSettled: () => {
      membershipAdmission.current = false;
    },
  });

  // Profile form — seeded from the loaded profile.
  const [names, setNames] = useState(() => nameDraft());
  const {
    ready: namePolicyReady,
    hasFields: editableNames,
    observe: observeNamePolicy,
  } = useNameFieldPresentation();
  const [originalNames, setOriginalNames] = useState(() => nameDraft());
  const [legacyName, setLegacyName] = useState<string | null | undefined>();
  const identity = personNameEdit(names, originalNames, legacyName);
  const [profileVersion, setProfileVersion] = useState<number>();
  const [profileDirty, setProfileDirty] = useState(false);
  const [optOutReason, setOptOutReason] = useState("");
  useEffect(() => {
    if (
      profile.data &&
      !profileDirty &&
      !profileCommitted &&
      !profileReloading
    ) {
      setNames(nameDraft(profile.data));
      setOriginalNames(nameDraft(profile.data));
      setLegacyName(unsplitLegacyName(profile.data));
      setProfileVersion(profile.data.profileVersion);
    }
  }, [profile.data, profileDirty, profileCommitted, profileReloading]);
  const profileBlocked =
    profileDenied ||
    deniedNow ||
    !profile.data ||
    !!profile.error ||
    profileCommitted ||
    profileReloading ||
    updateProfile.isPending;
  function adoptProfile(snapshot: RouterOutputs["tutor"]["myProfile"]) {
    setNames(nameDraft(snapshot));
    setOriginalNames(nameDraft(snapshot));
    setLegacyName(unsplitLegacyName(snapshot));
    setProfileVersion(snapshot.profileVersion);
    setProfileDirty(false);
  }
  async function refreshProfile() {
    setProfileReloading(true);
    try {
      await settleRefreshes([() => invalidateAndReport(utils.tutor.myProfile)]);
      const snapshot = await utils.tutor.myProfile.fetch(undefined, {
        staleTime: 0,
      });
      adoptProfile(snapshot);
      setProfileDenied(false);
      setProfileCommitted(false);
      setProfileSyncError(false);
    } catch {
      setProfileSyncError(true);
    } finally {
      setProfileReloading(false);
    }
  }
  async function reloadProfile() {
    if (
      profileAdmission.current ||
      profileReloading ||
      updateProfile.isPending ||
      profileCommitted
    )
      return;
    profileAdmission.current = true;
    setProfileReloading(true);
    try {
      const snapshot = await utils.tutor.myProfile.fetch(undefined, {
        staleTime: 0,
      });
      adoptProfile(snapshot);
      setProfileDenied(false);
      updateProfile.reset();
      setProfileSyncError(false);
    } catch {
      setProfileSyncError(true);
    } finally {
      profileAdmission.current = false;
      setProfileReloading(false);
    }
  }

  // Password form — two-step: verify the current password to get an emailed code, then submit
  // the code with the new password (step-up email 2FA).
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

  const requestCode = api.tutor.requestPasswordChangeCode.useMutation({
    onSuccess: (data) => setSentTo(data.email),
    onSettled: () => {
      passwordAdmission.current = false;
    },
  });
  const changePassword = api.tutor.changePassword.useMutation({
    onSuccess: () => {
      resetPasswordForm();
      signInAfterPasswordChange();
    },
    onSettled: () => {
      passwordAdmission.current = false;
    },
  });

  // Step 1: validate the new password locally, then ask for the emailed code.
  const sendCode = () => {
    if (
      passwordAdmission.current ||
      email2fa === undefined ||
      features.error ||
      requestCode.isPending ||
      changePassword.isPending
    )
      return;
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
      passwordAdmission.current = true;
      requestCode.mutate({ currentPassword: current });
    } else {
      // Email 2FA off — no emailed code step; change directly with the current password.
      passwordAdmission.current = true;
      changePassword.mutate({ currentPassword: current, newPassword: next });
    }
  };

  // Step 2: submit the new password with the emailed code.
  const submitPassword = () => {
    if (
      passwordAdmission.current ||
      email2fa === undefined ||
      features.error ||
      changePassword.isPending ||
      requestCode.isPending ||
      !code.trim()
    )
      return;
    passwordAdmission.current = true;
    setPwError(null);
    changePassword.mutate({
      currentPassword: current,
      newPassword: next,
      code: code.trim(),
    });
  };
  const passwordBusy = requestCode.isPending || changePassword.isPending;
  const securityBlocked = email2fa === undefined || !!features.error;
  const membershipBusy =
    optOut.isPending || reentry.isPending || recall.isPending;
  const membershipBlocked =
    membershipBusy ||
    !!me.error ||
    !!statusReq.error ||
    !me.data ||
    statusReq.data === undefined;

  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-8">
      <div>
        <h1 className="page-title">{t("tutor.settings.title")}</h1>
        <p className="muted mt-1">{t("tutor.settings.subtitle")}</p>
      </div>

      {/* Profile */}
      <TutorWorkloadPreference />
      <section className="card space-y-4 p-5">
        {profileDenied || deniedNow ? (
          <StatePanel
            kind="denied"
            title={recovery("accessDenied")}
            action={
              <Button
                disabled={profileReloading}
                onClick={() => void reloadProfile()}
              >
                {recovery("retry")}
              </Button>
            }
          >
            {recovery("accessDeniedHelp")}
          </StatePanel>
        ) : (
          <QueryFeedback
            hasData={!!profile.data}
            loading={!profile.data && !profile.error}
            error={!!profile.error}
            retrying={profile.isFetching}
            loadingTitle={recovery("loading")}
            errorTitle={recovery(profile.data ? "refreshFailed" : "loadFailed")}
            retryLabel={recovery("retry")}
            onRetry={() => void profile.refetch()}
          />
        )}
        {profile.data && !profileDenied && !deniedNow && (
          <>
            <p className="text-sm [overflow-wrap:anywhere]">
              {profile.data.username
                ? `@${profile.data.username}`
                : t("academics.usernameMissing")}
            </p>
            <form
              aria-label={t("tutor.settings.profileHeading")}
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  profileBlocked ||
                  profileAdmission.current ||
                  !namePolicyReady ||
                  !editableNames
                )
                  return;
                profileAdmission.current = true;
                updateProfile.mutate({
                  ...identity.fields,
                  expectedProfileVersion: profileVersion,
                });
              }}
            >
              <FormSection
                title={t("tutor.settings.profileHeading")}
                busy={updateProfile.isPending || profileReloading}
                disabled={profileBlocked}
                actions={
                  editableNames ? (
                    <>
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={profileBlocked || !namePolicyReady}
                      >
                        {t(
                          updateProfile.isPending
                            ? "tutor.settings.saving"
                            : "tutor.settings.save",
                        )}
                      </Button>
                      <Button
                        onClick={() => {
                          if (
                            profileBlocked ||
                            profileAdmission.current ||
                            !profile.data
                          )
                            return;
                          // Cancel explicitly discards this section only; sibling forms keep their drafts.
                          adoptProfile(profile.data);
                          updateProfile.reset();
                        }}
                      >
                        {t("uiPatterns.cancel")}
                      </Button>
                    </>
                  ) : undefined
                }
              >
                <PersonNameFields
                  onPolicyAvailabilityChange={observeNamePolicy}
                  value={names}
                  legacyName={legacyName}
                  originalValue={originalNames}
                  onChange={(value) => {
                    setNames(value);
                    setProfileDirty(true);
                    updateProfile.reset();
                  }}
                />
              </FormSection>
            </form>
            {updateProfile.isSuccess && (
              <p role="status" className="text-sm text-green-700">
                {t("tutor.settings.saved")}
              </p>
            )}
            {updateProfile.error && (
              <p role="alert" className="text-sm text-red-600">
                <ProfilePolicyError message={updateProfile.error.message} />
              </p>
            )}
            {updateProfile.error?.data?.code === "CONFLICT" && (
              <Button
                disabled={profileReloading || updateProfile.isPending}
                onClick={() => void reloadProfile()}
              >
                {t("accountProfile.reloadIdentity")}
              </Button>
            )}
            {profileSyncError && (
              <InlineNotice
                tone="error"
                announcement="alert"
                action={
                  <Button
                    disabled={profileReloading}
                    onClick={() =>
                      void (profileCommitted
                        ? refreshProfile()
                        : reloadProfile())
                    }
                  >
                    {t("accountProfile.retryRefresh")}
                  </Button>
                }
              >
                {t(
                  profileCommitted
                    ? "tutor.settings.profileSyncFailed"
                    : "participantRecovery.loadFailed",
                )}
              </InlineNotice>
            )}
          </>
        )}
      </section>

      <AcademicPanel />
      <SchoolDeparturePanel />

      {/* Password — two-step: verify current password to email a code, then submit code + new pw. */}
      <section className="card space-y-4 p-5">
        <div>
          <h2 className="section-title">
            {t("tutor.settings.passwordHeading")}
          </h2>
          {email2fa && (
            <p className="muted mt-1 text-sm">
              {t("account.password.twoFactorHint")}
            </p>
          )}
        </div>

        <QueryFeedback
          hasData={!!features.data}
          loading={!features.data && !features.error}
          error={!!features.error}
          retrying={features.isFetching}
          loadingTitle={recovery("loading")}
          errorTitle={recovery("loadFailed")}
          retryLabel={recovery("retry")}
          onRetry={() => void features.refetch()}
        />
        <fieldset
          disabled={passwordBusy || securityBlocked}
          className="min-w-0 space-y-4"
        >
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

          {/* Step 2 appears once the code is emailed. */}
          {sentTo && (
            <div className="border-accent-200 bg-accent-50/60 space-y-2 rounded-lg border p-4">
              <p className="text-sm text-slate-700">
                {t("account.password.codeSent", { email: sentTo })}
              </p>
              <label className="block space-y-1">
                <span className="label">{t("account.password.codeLabel")}</span>
                <input
                  value={code}
                  onChange={(e) =>
                    setCode(
                      e.target.value
                        .toUpperCase()
                        .replace(/[^0-9A-Z]/g, "")
                        .slice(0, 5),
                    )
                  }
                  autoCapitalize="characters"
                  autoComplete="one-time-code"
                  maxLength={5}
                  placeholder="XXXXX"
                  className="input field-auto min-w-40 font-mono tracking-[0.3em] uppercase"
                />
              </label>
              <button
                type="button"
                className="link text-xs"
                disabled={requestCode.isPending}
                onClick={() => {
                  if (passwordBusy || passwordAdmission.current) return;
                  passwordAdmission.current = true;
                  requestCode.mutate({ currentPassword: current });
                }}
              >
                {t("account.password.resend")}
              </button>
            </div>
          )}

          <FormActions>
            {!sentTo ? (
              <button
                className="btn-primary"
                disabled={
                  (email2fa
                    ? requestCode.isPending
                    : changePassword.isPending) ||
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
                  disabled={passwordBusy || !code.trim()}
                  onClick={submitPassword}
                >
                  {changePassword.isPending
                    ? t("tutor.settings.changing")
                    : t("tutor.settings.changePasswordBtn")}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={passwordBusy}
                  onClick={resetPasswordForm}
                >
                  {t("account.password.cancel")}
                </button>
              </>
            )}
            {changePassword.isSuccess && (
              <span className="text-sm text-green-600">
                {t("tutor.settings.passwordChanged")}
              </span>
            )}
            {(pwError ?? changePassword.error ?? requestCode.error) && (
              <span className="text-sm text-red-600">
                {pwError ??
                  changePassword.error?.message ??
                  requestCode.error?.message}
              </span>
            )}
          </FormActions>
        </fieldset>
      </section>

      <AccountEmails />
      <EmailPreferences />
      <TwoFactorSettings />

      {/* Membership — opt-out / reentry */}
      <section className="card space-y-4 p-5">
        <h2 className="section-title">
          {t("tutor.settings.membershipHeading")}
        </h2>
        <QueryFeedback
          hasData={!!me.data && statusReq.data !== undefined}
          loading={!me.data || statusReq.data === undefined}
          error={!!me.error || !!statusReq.error}
          retrying={me.isFetching || statusReq.isFetching}
          loadingTitle={recovery("loading")}
          errorTitle={recovery("loadFailed")}
          retryLabel={recovery("retry")}
          onRetry={() => {
            if (me.error) void me.refetch();
            if (statusReq.error) void statusReq.refetch();
          }}
        />

        {statusReq.data === undefined || !me.data ? null : statusReq.data ? (
          // There's an open request — show its state + a recall control.
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              {statusReq.data.kind === "OPT_OUT"
                ? statusReq.data.eligibleAt
                  ? t("tutor.settings.optOutPending", {
                      date: programFormat.dateTime(
                        new Date(statusReq.data.eligibleAt),
                        { dateStyle: "medium" },
                      ),
                    })
                  : t("tutor.settings.optOutPendingNoDate")
                : t("tutor.settings.reentryPending")}
            </p>
            <button
              className="btn-secondary"
              disabled={membershipBlocked}
              onClick={() => {
                if (
                  membershipBlocked ||
                  membershipAdmission.current ||
                  !statusReq.data
                )
                  return;
                membershipAdmission.current = true;
                recall.mutate({ requestId: statusReq.data.id });
              }}
            >
              {t("tutor.settings.recall")}
            </button>
            {recall.error && (
              <p className="text-sm text-red-600">{recall.error.message}</p>
            )}
          </div>
        ) : me.data?.status === "ACTIVE" ? (
          // Active tutor — offer opt-out (with optional reason).
          <div className="space-y-3">
            <p className="muted text-sm">{t("tutor.settings.optOutHelp")}</p>
            <textarea
              disabled={membershipBlocked}
              value={optOutReason}
              onChange={(e) => setOptOutReason(e.target.value)}
              placeholder={t("tutor.settings.optOutReasonPlaceholder")}
              className="textarea w-full"
              rows={2}
            />
            <button
              className="btn-secondary"
              disabled={membershipBlocked}
              onClick={() => {
                if (membershipBlocked || membershipAdmission.current) return;
                membershipAdmission.current = true;
                optOut.mutate({ reason: optOutReason.trim() || undefined });
              }}
            >
              {t("tutor.settings.optOutBtn")}
            </button>
            {optOut.error && (
              <p className="text-sm text-red-600">{optOut.error.message}</p>
            )}
          </div>
        ) : me.data?.status === "OPTED_OUT" ? (
          // Opted out — offer reentry.
          <div className="space-y-3">
            <p className="muted text-sm">{t("tutor.settings.reentryHelp")}</p>
            <button
              className="btn-primary"
              disabled={membershipBlocked}
              onClick={() => {
                if (membershipBlocked || membershipAdmission.current) return;
                membershipAdmission.current = true;
                reentry.mutate({});
              }}
            >
              {t("tutor.settings.reentryBtn")}
            </button>
            {reentry.error && (
              <p role="alert" className="text-sm text-red-600">
                <AcademicError message={reentry.error.message} selfService />
              </p>
            )}
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
