"use client";
import { useRef, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useBranding } from "~/app/_components/branding-provider";
import { useReadOnly } from "~/app/_components/read-only";
import { Button } from "~/app/_components/ui/button";
import {
  registrationKindLabel,
  type RegistrationKind,
} from "~/lib/registration-kind";
import { downloadCardImage } from "~/lib/download-card-image";

/**
 * One card for every invitation role and status, reused for issued and expanded codes.
 * Keep actions outside the captured element so the PNG contains only setup instructions.
 */
export function ShareCard({
  code,
  expiresAt,
  registerUrl,
  kind,
  inactive = false,
  actions,
}: {
  code: string;
  expiresAt: Date;
  registerUrl: string;
  kind: RegistrationKind;
  inactive?: boolean;
  actions?: ReactNode;
}) {
  const programFormat = useFormatter();
  const { APP_TITLE } = useBranding();
  const t = useTranslations();
  const cardRef = useRef<HTMLDivElement>(null);
  const exportingRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const readOnly = useReadOnly();

  async function exportImage() {
    if (exportingRef.current || !cardRef.current || readOnly || inactive)
      return;
    if (new Date(expiresAt).getTime() <= Date.now()) {
      setExportError(true);
      return;
    }
    exportingRef.current = true;
    setExporting(true);
    setExportError(false);
    try {
      await downloadCardImage(cardRef.current);
    } catch {
      setExportError(true);
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }

  return (
    <div className="space-y-2">
      <div
        ref={cardRef}
        data-account-setup-card
        className={`mx-auto max-w-sm rounded-xl border p-5 text-center break-words shadow-sm ${inactive ? "border-slate-300 bg-slate-50" : "border-accent-200 bg-white"}`}
      >
        <p className="text-base font-bold text-slate-900">
          {t("admin.registrationCodes.share.heading", { appTitle: APP_TITLE })}
        </p>

        <p className="mt-2 font-semibold text-slate-700">
          {t(`admin.registrationCodes.${registrationKindLabel[kind]}`)}
        </p>
        {/* Inactive history keeps the same geometry, but must not inherit the
         * green invitation purpose tint or offer instructions for redemption. */}
        <div
          data-code-purpose={inactive ? undefined : "invitation"}
          className={`mt-3 inline-block max-w-full rounded-lg border-2 border-dashed px-6 py-3 text-center ${inactive ? "border-slate-300 bg-slate-100" : "code-surface border-green-300"}`}
        >
          <p
            className={`text-xs font-semibold tracking-wide uppercase ${inactive ? "text-slate-600" : "text-green-700"}`}
          >
            {t("admin.registrationCodes.codeLabel")}
          </p>
          <p
            className={`font-mono text-3xl font-bold tracking-[0.3em] ${inactive ? "text-slate-600 line-through" : "text-green-800"}`}
          >
            {code}
          </p>
        </div>

        {inactive ? (
          <p className="mt-3 text-sm text-slate-600">
            {t("admin.registrationCodes.invalidNote")}
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm break-all text-slate-700">
              {t("admin.registrationCodes.share.enterAt", { url: registerUrl })}
            </p>
            <p className="text-accent-700 mt-1 text-xs font-medium">
              {t("admin.registrationCodes.share.validity", {
                date: programFormat.dateTime(new Date(expiresAt), {
                  dateStyle: "medium",
                }),
              })}
            </p>
          </>
        )}
      </div>
      {!readOnly && !inactive && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button
            size="compact"
            onClick={() => void exportImage()}
            disabled={exporting}
            aria-busy={exporting}
          >
            {t(
              exporting
                ? "admin.registrationCodes.exportingImage"
                : "admin.registrationCodes.exportImage",
            )}
          </Button>
          {actions}
        </div>
      )}
      {exportError && !inactive && (
        <p role="alert" className="text-sm text-red-700">
          {t("admin.registrationCodes.exportImageError")}
        </p>
      )}
    </div>
  );
}
