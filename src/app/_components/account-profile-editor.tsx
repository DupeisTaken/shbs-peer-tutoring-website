"use client";
import { useProfileReloadFocus } from "./use-profile-reload-focus";
import { ProfileEditSection } from "./profile-edit-section";
import { Button } from "./ui/button";
import { PersonNameFields } from "~/app/_components/person-name-fields";
import { nameDraft, personNameEdit } from "~/lib/person-name";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { invalidateAndReport } from "~/lib/invalidate-refresh";

import { SchoolDeparturePanel } from "./school-departure";
import { MembershipEditor } from "./membership-editor";
import { AcademicPanel } from "./academic-profile";
import { AccountUsernameEditor } from "./account-username-editor";
import type { AccountMembership } from "~/lib/account-membership";
import { useRef, useState, type ComponentProps } from "react";
import { useDialogPending } from "./ui/modal";
import { useTranslations } from "next-intl";
import { ProfilePolicyError } from "~/app/_components/profile-policy";
import { api } from "~/trpc/react";
import { ProfileDialog } from "~/app/_components/profile-dialog";

export function AccountProfileEditor({
  profile,
  onClose,
  membership,
  isHead,
}: {
  profile: {
    userId: string;
    username?: string | null;
    name: string;
    firstName?: string | null;
    lastName?: string | null;
    preferredName?: string | null;
    legacyName?: string | null;
    alternativeNames: string | null;
    profileVersion: number;
  };
  onClose: () => void;
  membership?: AccountMembership;
  isHead?: boolean;
}) {
  const t = useTranslations("accountProfile");
  return (
    <ProfileDialog title={t("editProfile")} onClose={onClose}>
      <AccountProfileForm
        profile={profile}
        membership={membership}
        isHead={isHead}
      />
    </ProfileDialog>
  );
}

/** Run the form inside its dialog so both submission and completion see sibling writes. */
function AccountProfileForm({
  profile,
  membership,
  isHead,
}: Omit<ComponentProps<typeof AccountProfileEditor>, "onClose">) {
  const t = useTranslations("accountProfile");
  const common = useTranslations("uiPatterns");
  const [saved, setSaved] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const committed = useRef(false);
  const [reloading, setReloading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const reloadFocus = useProfileReloadFocus(formRef, reloading);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const reloadPending = useRef(false);
  const [names, setNames] = useState(() => nameDraft(profile));
  const [originalNames, setOriginalNames] = useState(() => nameDraft(profile));
  const [legacyName, setLegacyName] = useState(
    profile.legacyName ?? profile.name,
  );
  const identity = personNameEdit(names, originalNames, legacyName);
  const name = identity.name;
  const [expectedProfileVersion, setExpectedProfileVersion] = useState(
    profile.profileVersion,
  );

  const utils = api.useUtils();
  // Guard the interval before mutation state renders, so one request owns this draft.
  const submitting = useRef(false);
  const save = api.admin.updateAccountProfile.useMutation({
    onSettled: () => {
      submitting.current = false;
    },
    onSuccess: async () => {
      // Synchronize only this committed section; sibling drafts retain their snapshots.
      committed.current = true;
      setSaved(true);
      setNeedsRefresh(true);
      await refreshIdentity(true);
    },
  });
  const busy = useDialogPending(save.isPending);
  const refreshIdentity = async (afterSave: boolean) => {
    reloadPending.current = true;
    setReloading(true);
    setReloadError(null);
    try {
      if (afterSave) {
        await settleRefreshes([
          () => invalidateAndReport(utils.admin.accounts),
          () => invalidateAndReport(utils.admin.tutors),
          () => invalidateAndReport(utils.admin.tutees),
          () => invalidateAndReport(utils.tuteeHistory),
          () => invalidateAndReport(utils.account.me),
        ]);
      }
      const accounts = await utils.admin.accounts.fetch(undefined, {
        staleTime: 0,
      });
      const latest = accounts.rows.find((row) => row.userId === profile.userId);
      if (latest?.profileVersion == null) throw new Error(common("loadFailed"));
      // Adopt only a complete, matching read; failed reads never replace the draft.
      setNames(nameDraft(latest));
      setOriginalNames(nameDraft(latest));
      setLegacyName(latest.legacyName ?? latest.name);
      setExpectedProfileVersion(latest.profileVersion);
      setRefreshFailed(false);
      setNeedsRefresh(false);
      committed.current = false;
      return true;
    } catch (error) {
      if (afterSave) setRefreshFailed(true);
      setReloadError(
        error instanceof Error ? error.message : common("loadFailed"),
      );
      return false;
    } finally {
      reloadPending.current = false;
      setReloading(false);
    }
  };
  return (
    <>
      <form
        ref={formRef}
        className="space-y-4"
        onChangeCapture={() => {
          if (!committed.current) setSaved(false);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (
            busy ||
            submitting.current ||
            reloadPending.current ||
            committed.current
          )
            return;
          submitting.current = true;
          save.mutate({
            userId: profile.userId,
            name,
            ...identity.fields,
            expectedProfileVersion,
          });
        }}
      >
        <ProfileEditSection
          title={t("name")}
          busy={save.isPending || reloading}
          saved={saved}
          refreshFailed={refreshFailed}
          readOnly={needsRefresh}
          refreshBusy={reloading}
          refreshError={saved ? reloadError : null}
          onRefresh={() => {
            if (busy || submitting.current || reloadPending.current) return;
            reloadFocus.beginReload();
            void refreshIdentity(true).then((succeeded) => {
              if (succeeded) save.reset();
              reloadFocus.finishReload(succeeded);
            });
          }}
          actions={
            <Button
              type="submit"
              variant="primary"
              disabled={save.isPending || !name.trim()}
            >
              {t("save")}
            </Button>
          }
        >
          <p className="muted text-sm">{t("canonicalHelp")}</p>
          <PersonNameFields
            value={names}
            onChange={setNames}
            legacyName={legacyName}
            originalValue={originalNames}
          />
          {save.error && (
            <p role="alert" className="text-sm text-red-600">
              <ProfilePolicyError message={save.error.message} />
            </p>
          )}
          {save.error?.data?.code === "CONFLICT" && (
            <button
              type="button"
              className="btn-secondary min-h-11 lg:min-h-10"
              onClick={async () => {
                if (
                  busy ||
                  submitting.current ||
                  reloadPending.current ||
                  committed.current
                )
                  return;
                reloadFocus.beginReload();
                const succeeded = await refreshIdentity(false);
                // The helper reports errors through state; reset only after a matching read.
                if (succeeded) save.reset();
                reloadFocus.finishReload(succeeded);
              }}
            >
              {t("reloadIdentity")}
            </button>
          )}
          {reloadError && !saved && (
            <p role="alert" className="text-sm text-red-600">
              {reloadError}
            </p>
          )}
        </ProfileEditSection>
      </form>
      <div className="mt-5">
        <AcademicPanel userId={profile.userId} />
      </div>
      {isHead && (
        <AccountUsernameEditor
          userId={profile.userId}
          username={profile.username}
          profileVersion={profile.profileVersion}
        />
      )}
      {membership && (
        <MembershipEditor
          userId={profile.userId}
          initial={membership}
          isHead={isHead}
        />
      )}
      <SchoolDeparturePanel userId={profile.userId} />
    </>
  );
}
