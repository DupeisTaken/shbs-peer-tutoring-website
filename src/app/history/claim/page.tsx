import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { HistoryClaim } from "./history-claim";
import { HistoryAccountSetup } from "./history-account-setup";
import { LanguageSwitcher } from "~/app/_components/language-switcher";
import { SUPPORT_EMAIL } from "~/lib/branding";
import { switchHistoryAccount } from "./actions";

export default async function HistoryClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const session = await auth();
  const t = await getTranslations("tuteeHistory");
  const token = (await searchParams).token ?? "";
  // Keep the exact claim through the existing two-step sign-in flow. The token is
  // data in a fixed local route, never an arbitrary redirect destination.
  const destination = `/history/claim?token=${encodeURIComponent(token)}`;
  return (
    <main className="mx-auto max-w-xl space-y-5 p-4 py-10">
      <div className="flex flex-wrap justify-end gap-2">
        <LanguageSwitcher compactAtDesktop />
        {session?.user && (
          <form action={switchHistoryAccount.bind(null, token)}>
            <button className="btn-secondary btn-sm min-h-11 lg:min-h-8 lg:py-0">
              {t("switchAccount")}
            </button>
          </form>
        )}
      </div>
      <h1 className="page-title">{t("claimTitle")}</h1>
      <p className="muted">{t("linkHelp")}</p>
      {session?.user ? (
        <HistoryClaim key={token} token={token} />
      ) : (
        <>
          <section className="card space-y-4 p-5">
            <p>{t("signInHelp")}</p>
            <div className="flex flex-wrap gap-3">
              <Link
                className="btn-primary min-h-11"
                href={`/signin?callbackUrl=${encodeURIComponent(destination)}`}
              >
                {t("signIn")}
              </Link>
              <Link className="btn-secondary min-h-11" href="/forgot-password">
                {t("recoverAccount")}
              </Link>
            </div>
          </section>
          <HistoryAccountSetup key={token} token={token} />
        </>
      )}
      <aside className="space-y-2 border-t border-slate-200 pt-4 text-sm">
        <p>{t("historySupport")}</p>
        {SUPPORT_EMAIL && (
          <a
            className="link inline-flex min-h-11 items-center break-all"
            href={`mailto:${SUPPORT_EMAIL}`}
          >
            {SUPPORT_EMAIL}
          </a>
        )}
        <Link
          className="link inline-flex min-h-11 items-center"
          href="/privacy"
        >
          {t("privacy")}
        </Link>
      </aside>
    </main>
  );
}
