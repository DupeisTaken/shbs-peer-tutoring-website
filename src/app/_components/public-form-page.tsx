import Link from "next/link";
import type { ReactNode } from "react";
import { PublicHeader } from "./public-header";

/** Public forms and personal history share one in-flow responsive public header. */
export function PublicPageNavigation({ backLabel }: { backLabel: string }) {
  return (
    <PublicHeader
      sticky={false}
      navigation={
        <Link href="/" className="public-form-link text-sm">
          {backLabel}
        </Link>
      }
    />
  );
}

/** Shared server-rendered frame. Keep navigation in flow so enlarged text and
 * mobile keyboards never leave the language control overlapping a form. */
export function PublicFormPage({
  title,
  description,
  backLabel,
  children,
  footer,
  notice,
  wide = false,
}: {
  title: string;
  description?: ReactNode;
  backLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  notice?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen">
      <PublicPageNavigation backLabel={backLabel} />
      <main
        className={`public-form mx-auto w-full px-4 pt-6 pb-12 sm:px-6 sm:pt-10 ${wide ? "max-w-3xl" : "max-w-lg"}`}
      >
        <header className="mb-7 text-center">
          <div
            aria-hidden="true"
            className="bg-accent-500 mx-auto mb-5 h-1 w-10 rounded-full"
          />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            {title}
          </h1>
          {description && (
            <div className="mt-3 text-sm leading-6 text-pretty text-slate-600">
              {description}
            </div>
          )}
        </header>
        {notice && <div className="mb-5">{notice}</div>}
        {children}
        {footer && (
          <div className="public-form-footer mt-6 text-center text-sm">
            {footer}
          </div>
        )}
      </main>
    </div>
  );
}

export function PublicFormCard({ children }: { children: ReactNode }) {
  return (
    <div className="public-form-card card p-6 text-left sm:p-8">{children}</div>
  );
}

/** Put descriptions on their own lines: inline-flex links otherwise fragment
 * translated sentences into uneven rows when touch-target sizing takes effect. */
export function PublicFormRoute({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <Link href={href} className="public-form-link text-sm">
        {label}
      </Link>
      {children && (
        <p className="mx-auto max-w-sm text-sm leading-6 text-pretty text-slate-600">
          {children}
        </p>
      )}
    </div>
  );
}
