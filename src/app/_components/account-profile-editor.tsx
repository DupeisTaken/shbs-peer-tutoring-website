"use client";
import { ProfileEditSection } from "./profile-edit-section";
import { Button } from "./ui/button";
import { PersonNameFields } from "~/app/_components/person-name-fields";
import { nameDraft, personNameEdit } from "~/lib/person-name";

import { SchoolDeparturePanel } from "./school-departure";
import { MembershipEditor } from "./membership-editor";
import { AcademicPanel } from "./academic-profile";
import { AccountUsernameEditor } from "./account-username-editor";
import type { AccountMembership } from "~/lib/account-membership";
import { useEffect, useRef, useState, type ComponentProps } from "react";
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
        onClose={onClose}
        membership={membership}
        isHead={isHead}
      />
    </ProfileDialog>
  );
}

/** Run the form inside its dialog so both submission and completion see sibling writes. */
function AccountProfileForm({
  profile,
  onClose,
  membership,
  isHead,
}: ComponentProps<typeof AccountProfileEditor>) {
  const t = useTranslations("accountProfile");
  const common = useTranslations("uiPatterns");
  const [closeRequested, setCloseRequested] = useState(false);
  const [reloading, setReloading] = useState(false);
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
      await Promise.all([
        utils.admin.accounts.invalidate(),
        utils.admin.tutors.invalidate(),
        utils.admin.tutees.invalidate(),
        utils.tuteeHistory.invalidate(),
        utils.account.me.invalidate(),
      ]);
      setCloseRequested(true);
    },
  });
  const busy = useDialogPending(save.isPending);
  // A successful profile save must not unmount an independently pending section.
  useEffect(() => {
    if (closeRequested && !busy) onClose();
  }, [closeRequested, busy, onClose]);
  return (
    <>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            busy ||
            submitting.current ||
            reloadPending.current ||
            closeRequested
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
                if (busy || submitting.current || reloadPending.current) return;
                // A reload may replace this draft, so exclude concurrent saves without
                // registering a cancellable GET as an owned dialog write.
                reloadPending.current = true;
                setReloading(true);
                setReloadError(null);
                try {
                  // Explicit Reload must read the server even when the list cache is fresh.
                  const accounts = await utils.admin.accounts.fetch(undefined, {
                    staleTime: 0,
                  });
                  const latest = accounts.rows.find(
                    (row) => row.userId === profile.userId,
                  );
                  if (latest?.profileVersion != null) {
                    setNames(nameDraft(latest));
                    setOriginalNames(nameDraft(latest));
                    setLegacyName(latest.legacyName ?? latest.name);
                    setExpectedProfileVersion(latest.profileVersion);
                    save.reset();
                  }
                } catch (error) {
                  setReloadError(
                    error instanceof Error
                      ? error.message
                      : common("loadFailed"),
                  );
                } finally {
                  reloadPending.current = false;
                  setReloading(false);
                }
              }}
            >
              {t("reloadIdentity")}
            </button>
          )}
          {reloadError && (
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
          onSaved={() => setCloseRequested(true)}
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
