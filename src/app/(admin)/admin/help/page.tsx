import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { helpLocale } from "~/lib/help/types";
import { getHelpAccess } from "~/server/help/access";
import { helpCopy } from "~/app/help/copy";
import { HelpHandbookDownloads } from "~/app/help/handbook-downloads";

export default async function HelpDownloadsPage() {
  const [rawLocale, access] = await Promise.all([getLocale(), getHelpAccess()]);
  if (!access.canDownload) notFound();
  const locale = helpLocale(rawLocale);
  const copy = helpCopy[locale];

  return (
    <div lang={locale} className="space-y-6">
      <header>
        <h1 className="page-title">{copy.downloads}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
          {copy.downloadsHelp}
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          {copy.handbookHelp}
        </p>
        <Link
          href="/help"
          className="link mt-3 inline-flex min-h-11 items-center text-sm"
        >
          {copy.catalogue}
        </Link>
      </header>
      <HelpHandbookDownloads
        audiences={access.downloadableAudiences}
        locale={locale}
        headingLevel="h2"
      />
    </div>
  );
}
