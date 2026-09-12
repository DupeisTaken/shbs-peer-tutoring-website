"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { ProfileDialog } from "~/app/_components/profile-dialog";

export function AccountProfileEditor({
  profile,
  onClose,
}: {
  profile: {
    userId: string;
    name: string;
    alternativeNames: string | null;
    profileVersion: number;
  };
  onClose: () => void;
}) {
  const t = useTranslations("accountProfile");
  const [name, setName] = useState(profile.name);
  const [alternativeNames, setAlternativeNames] = useState(
    profile.alternativeNames ?? "",
  );
  const utils = api.useUtils();
  const save = api.admin.updateAccountProfile.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.admin.accounts.invalidate(),
        utils.admin.tutors.invalidate(),
        utils.admin.tutees.invalidate(),
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
            alternativeNames: alternativeNames.trim() || null,
            expectedProfileVersion: profile.profileVersion,
          });
        }}
      >
        <p className="muted text-sm">{t("canonicalHelp")}</p>
        <label className="block">
          <span className="label">{t("name")}</span>
          <input
            className="input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
        </label>
        <label className="block">
          <span className="label">{t("alternativeNames")}</span>
          <input
            className="input w-full"
            value={alternativeNames}
            onChange={(e) => setAlternativeNames(e.target.value)}
            maxLength={200}
          />
          <span className="muted text-xs">{t("alternativeHelp")}</span>
        </label>
        <button
          className="btn-primary"
          disabled={save.isPending || !name.trim()}
        >
          {t("save")}
        </button>
        {save.error && (
          <p role="alert" className="text-sm text-red-600">
            {save.error.message}
          </p>
        )}
      </form>
    </ProfileDialog>
  );
}
