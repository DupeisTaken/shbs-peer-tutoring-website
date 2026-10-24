"use client";

import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";

const destinations = [
  { key: "tutor", path: "/tutor" },
  { key: "tutee", path: "/tutee" },
  { key: "crew", path: "/crew" },
  { key: "site", path: "/" },
] as const;

/** Public downloads have no settings save boundary or recruitment permission dependency. */
export function ProgramPublicQrLinks() {
  const headingId = useId();
  const t = useTranslations("admin.program.publicQr");
  // The packaged image fonts support these two label languages. Other UI locales
  // receive English images without changing their translated surrounding controls.
  const locale = useLocale() === "zh" ? "zh" : "en";

  return (
    <section className="card p-4 sm:p-5" aria-labelledby={headingId}>
      <h2 id={headingId} className="section-title">
        {t("heading")}
      </h2>
      <p className="muted mt-1 text-sm">{t("help")}</p>
      <ul className="mt-3 divide-y divide-slate-200">
        {destinations.map(({ key, path }) => (
          <li
            key={key}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
          >
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium text-slate-900">{t(key)}</span>
              <code className="text-sm text-slate-600">{path}</code>
            </div>
            {/* A native download keeps current panel drafts mounted and avoids prefetching images. */}
            <a
              href={`/api/public-qr?destination=${key}&locale=${locale}&download=1`}
              download={`shbs-${key}-qr-${locale}.png`}
              aria-label={t("downloadLabel", { destination: t(key) })}
              className="btn-secondary control-compact max-w-full text-center whitespace-normal"
            >
              {t("download")}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
