"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

/** Appeal form for a suspended account. Hidden once an appeal is pending; re-shown if a prior one
 *  was denied (they may appeal again). */
export function SuspendedAppeal({ pending, denied }: { pending: boolean; denied: boolean }) {
  const t = useTranslations();
  const [message, setMessage] = useState("");
  const submit = api.account.submitAppeal.useMutation();

  if (pending || submit.isSuccess) {
    return <p className="text-sm text-amber-700">{t("suspended.appealPending")}</p>;
  }

  return (
    <div className="space-y-2">
      {denied && <p className="text-sm text-red-600">{t("suspended.appealDenied")}</p>}
      <label className="label" htmlFor="appeal-msg">
        {t("suspended.appealHeading")}
      </label>
      <textarea
        id="appeal-msg"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        placeholder={t("suspended.appealPlaceholder")}
        className="textarea w-full"
      />
      {submit.error && <p className="text-sm text-red-600">{submit.error.message}</p>}
      <button
        className="btn-primary"
        disabled={message.trim().length === 0 || submit.isPending}
        onClick={() => submit.mutate({ message: message.trim() })}
      >
        {submit.isPending ? t("suspended.submitting") : t("suspended.submit")}
      </button>
    </div>
  );
}
