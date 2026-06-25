import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { api } from "~/trpc/server";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { SuspendedAppeal } from "./appeal-form";
import { APP_TITLE } from "~/lib/branding";

export const metadata = { title: `Account suspended · ${APP_TITLE}` };

/** Shown to a suspended account in place of any normal area: the reason + an appeal form. */
export default async function SuspendedPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const data = await api.account.suspension();
  if (!data.suspended) redirect("/");
  const t = await getTranslations();

  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 py-16">
      <div className="card space-y-4 p-6">
        <h1 className="page-title">{t("suspended.title")}</h1>
        <p className="text-sm text-slate-700">{t("suspended.body")}</p>
        {data.reason && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t("suspended.reason", { reason: data.reason })}
          </p>
        )}
        <SuspendedAppeal
          pending={data.appeal?.state === "PENDING"}
          denied={data.appeal?.state === "DENIED"}
        />
        <div className="border-t border-slate-100 pt-3">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
