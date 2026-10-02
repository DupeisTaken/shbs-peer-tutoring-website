import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { HistoryClaim } from "./history-claim";
import { PublicFormPage } from "~/app/_components/public-form-page";

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
    <PublicFormPage
      title={t("claimTitle")}
      description={t("linkHelp")}
      backLabel={t("back")}
      wide
    >
      {session?.user ? (
        <HistoryClaim key={token} token={token} />
      ) : (
        <section className="card space-y-4 p-5">
          <p>{t("signInHelp")}</p>
          <div className="flex flex-wrap gap-3">
            <Link
              className="btn-primary min-h-11"
              href={`/signin?callbackUrl=${encodeURIComponent(destination)}`}
            >
              {t("signIn")}
            </Link>
            <Link className="btn-secondary min-h-11" href="/signup">
              {t("signup")}
            </Link>
          </div>
          <p className="muted text-sm">{t("signupHelp")}</p>
        </section>
      )}
    </PublicFormPage>
  );
}
