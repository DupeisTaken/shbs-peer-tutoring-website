"use client";
import Image from "next/image";
import Link from "next/link";
import { useSyncExternalStore, useState } from "react";
import { useTranslations } from "next-intl";

const subscribe = () => () => undefined;

/** Only the public sign-in URL is shareable; never encode an account-verification token. */
export function SigninAccess() {
  const t = useTranslations("survey");
  const url = useSyncExternalStore(
    subscribe,
    () => new URL("/signin", window.location.origin).href,
    () => "/signin",
  );
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  return (
    <section
      className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-left"
      aria-label={t("signinAccess")}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 space-y-3">
          <h3 className="text-lg font-semibold text-slate-900">
            {t("signinAccess")}
          </h3>
          <p className="muted text-sm">{t("signinHelp")}</p>
          <Link href="/signin" className="btn-primary">
            {t("signIn")}
          </Link>
          <a href={url} className="link block text-sm break-all">
            {url}
          </a>
          <button
            type="button"
            className="link text-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setCopyFailed(false);
              } catch {
                setCopyFailed(true);
              }
            }}
          >
            {t(copied ? "copied" : "copyLink")}
          </button>
          {copyFailed && (
            <p role="status" className="muted text-xs">
              {t("copyHelp")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-center gap-2">
          <Image
            src="/api/signin-qr"
            unoptimized
            width={160}
            height={160}
            alt={t("qrAlt")}
            className="rounded-lg border border-slate-200 bg-white"
          />
          <a
            href="/api/signin-qr?download=1"
            download="student-signin.png"
            className="link text-sm"
          >
            {t("saveQr")}
          </a>
        </div>
      </div>
    </section>
  );
}
