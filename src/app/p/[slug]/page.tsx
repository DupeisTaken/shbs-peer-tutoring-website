import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { db } from "~/server/db";
import { getSectionBySlug } from "~/server/home/sections";
import {
  getCustomPageBySlug,
  getNavPages,
  pageOwnerKey,
} from "~/server/home/pages";
import { getLayout } from "~/server/home/blocks";
import { authorizeHomeEditor } from "~/server/home/images";
import { APP_TITLE } from "~/lib/branding";
import { Markdown } from "~/app/_components/markdown";
import { PageBlocks } from "~/app/_components/page-blocks";
import { DetailsAutoClose } from "~/app/_components/details-auto-close";
import { NativeDisclosureIcon } from "~/app/_components/icons";
import { ThemeSwitcher } from "~/app/_components/theme-switcher";
import { LanguageSwitcher } from "~/app/_components/language-switcher";

/**
 * Public page at /p/<slug>. The slug resolves to either a standalone custom page (a block layout) or
 * a PAGE-mode landing section (markdown) — they share one slug namespace. Unpublished ones are shown
 * only to a landing editor (preview), with a hidden-from-visitors banner.
 */
export default async function SlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const navPages = await getNavPages(db, locale);

  const page = await getCustomPageBySlug(db, slug, locale);
  if (page) {
    const editorView = await gateUnpublished(page.published);
    const blocks = await getLayout(db, pageOwnerKey(page.id));
    return (
      <Shell editorView={editorView} title={page.title} nav={navPages}>
        <PageBlocks blocks={blocks} locale={locale} />
      </Shell>
    );
  }

  const section = await getSectionBySlug(db, slug, locale);
  if (section) {
    const editorView = await gateUnpublished(section.published);
    return (
      <Shell editorView={editorView} title={section.title} nav={navPages}>
        <article className="mx-auto max-w-3xl px-4 py-12">
          <div className="leading-relaxed text-slate-600">
            <Markdown>{section.body}</Markdown>
          </div>
        </article>
      </Shell>
    );
  }

  notFound();
}

/** Unpublished content is editor-only (returns true to flag the preview banner); else 404. */
async function gateUnpublished(published: boolean): Promise<boolean> {
  if (published) return false;
  const access = await authorizeHomeEditor();
  if (!access.ok) notFound();
  return true;
}

async function Shell({
  editorView,
  title,
  nav,
  children,
}: {
  editorView: boolean;
  title: string;
  nav: { slug: string; label: string }[];
  children: ReactNode;
}) {
  const [t, tc] = await Promise.all([
    getTranslations("landing"),
    getTranslations("common"),
  ]);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto grid max-w-4xl gap-3 px-4 py-3 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
          <Link
            href="/"
            className="min-w-0 justify-self-start text-left text-lg font-extrabold tracking-tight whitespace-nowrap text-slate-900"
          >
            {APP_TITLE}
          </Link>
          <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 md:justify-end">
            <PageNavMenu
              label={t("nav.accessProgramInformation")}
              pages={nav}
            />
            <div className="shrink-0">
              <ThemeSwitcher />
            </div>
            <div className="shrink-0">
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-4 pt-12">
          {editorView && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              <span className="font-semibold">{t("preview.draftBadge")}</span> ·{" "}
              {t("detail.hiddenNote")}
            </div>
          )}
          <h1 className="page-title">{title}</h1>
        </div>
        {children}
        <div className="mx-auto max-w-3xl px-4 pb-12">
          {/* When an editor is previewing an unpublished page, wrap back to the landing editor
              rather than the public home. */}
          {editorView ? (
            <Link href="/admin/landing" className="link">
              {t("preview.ribbon.back")}
            </Link>
          ) : (
            <Link href="/" className="link">
              {tc("backToMain")}
            </Link>
          )}
        </div>
      </main>

      <footer className="border-t border-slate-200 py-6">
        <p className="muted text-center text-sm">
          {t("footer", { appTitle: APP_TITLE })}
        </p>
      </footer>
    </div>
  );
}

function PageNavMenu({
  label,
  pages,
}: {
  label: string;
  pages: { slug: string; label: string }[];
}) {
  if (pages.length === 0) return null;

  return (
    <details className="group relative shrink-0">
      <DetailsAutoClose />
      <summary className="btn-secondary btn-sm flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <NativeDisclosureIcon />
      </summary>
      <div className="absolute left-0 z-30 mt-2 min-w-60 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
        <div className="grid gap-1">
          {pages.map((page) => (
            <Link
              key={page.slug}
              href={`/p/${page.slug}`}
              className="rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"
            >
              {page.label}
            </Link>
          ))}
        </div>
      </div>
    </details>
  );
}
