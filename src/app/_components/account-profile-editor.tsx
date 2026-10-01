"use client";
import { PersonNameFields } from "~/app/_components/person-name-fields";
import { nameDraft, personNameEdit } from "~/lib/person-name";

import { SchoolDeparturePanel } from "./school-departure";
import { MembershipEditor } from "./membership-editor";
import { AcademicPanel } from "./academic-profile";
import { AccountUsernameEditor } from "./account-username-editor";
import type { AccountMembership } from "~/lib/account-membership";
import { useState } from "react";
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
  const save = api.admin.updateAccountProfile.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.admin.accounts.invalidate(),
        utils.admin.tutors.invalidate(),
        utils.admin.tutees.invalidate(),
        utils.tuteeHistory.invalidate(),
        utils.account.me.invalidate(),
      ]);
      onClose();
    },
  });
  return (
    <ProfileDialog title={t("editProfile")} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({
            userId: profile.userId,
            name,
            ...identity.fields,
            expectedProfileVersion,
          });
        }}
      >
        <p className="muted text-sm">{t("canonicalHelp")}</p>
        <PersonNameFields
          value={names}
          onChange={setNames}
          legacyName={legacyName}
          originalValue={originalNames}
        />
        <button
          className="btn-primary min-h-11 lg:min-h-10"
          disabled={save.isPending || !name.trim()}
        >
          {t("save")}
        </button>
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
              const accounts = await utils.admin.accounts.fetch();
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
            }}
          >
            {t("reloadIdentity")}
          </button>
        )}
      </form>
      <div className="mt-5">
        <AcademicPanel userId={profile.userId} />
      </div>
      {isHead && (
        <AccountUsernameEditor
          userId={profile.userId}
          username={profile.username}
          profileVersion={profile.profileVersion}
          onSaved={onClose}
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
    </ProfileDialog>
  );
}
