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
 * One card for every invitation role, reused for issued and expanded active codes.
 * Keep actions outside the captured element so the PNG contains only setup instructions.
 */
export function ShareCard({
  code,
  expiresAt,
  registerUrl,
  kind,
  actions,
}: {
  code: string;
  expiresAt: Date;
  registerUrl: string;
  kind: RegistrationKind;
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
    if (exportingRef.current || !cardRef.current || readOnly) return;
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
        className="border-accent-200 mx-auto max-w-sm rounded-xl border bg-white p-5 text-center break-words shadow-sm"
      >
        <p className="text-base font-bold text-slate-900">
          {t("admin.registrationCodes.share.heading", { appTitle: APP_TITLE })}
        </p>

        <p className="mt-2 font-semibold text-slate-700">
          {t(`admin.registrationCodes.${registrationKindLabel[kind]}`)}
        </p>
        {/* The code box — two centered lines: label + digits (same dashed-green scheme). */}
        <div className="mt-3 inline-block rounded-lg border-2 border-dashed border-green-300 bg-green-50 px-6 py-3 text-center">
          <p className="text-xs font-semibold tracking-wide text-green-700 uppercase">
            {t("admin.registrationCodes.codeLabel")}
          </p>
          <p className="font-mono text-3xl font-bold tracking-[0.3em] text-green-800">
            {code}
          </p>
        </div>

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
      </div>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
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
      {exportError && (
        <p role="alert" className="text-sm text-red-700">
          {t("admin.registrationCodes.exportImageError")}
        </p>
      )}
    </div>
  );
}
