import Link from "next/link";
import { shortSignupHref } from "~/lib/public-signup-links";
import {
  resolveSignedInLink,
  type SignedInLinkMap,
} from "~/lib/signed-in-landing-links";

import { Markdown } from "~/app/_components/markdown";
import {
  resolveLocalized,
  type Block,
  type LeafBlock,
} from "~/lib/page-blocks";

/**
 * Renderers for the content blocks (RICH_TEXT / IMAGE / BUTTONS / COLUMNS). Shared by the landing
 * page (`LandingView`) and standalone custom pages (`/p/<slug>`). System blocks
 * (HERO/FEATURES/SECTIONS/NEWS) are landing-only and handled by `LandingView`.
 */

/** Shared button row (internal links use the router; external links open in a new tab). */
export function ButtonRow({
  block,
  locale,
  signedInLinks,
}: {
  block: Extract<Block, { type: "BUTTONS" }>;
  locale: string;
  signedInLinks?: SignedInLinkMap;
}) {
  const buttons = block.buttons
    .map((b) => ({ ...b, label: resolveLocalized(b.label, locale) }))
    .filter((b) => b.label.value.trim() && b.href);
  if (buttons.length === 0) return null;
  return (
    <div
      className={`flex flex-wrap gap-3 ${block.align === "center" ? "justify-center" : ""}`}
    >
      {buttons.map((b, i) => {
        // Public block actions remain comfortable touch targets even when their copy is short.
        const cls = `${b.style === "primary" ? "btn-primary" : "btn-secondary"} min-h-11`;
        const replacement = resolveSignedInLink(b.href, signedInLinks);
        if (replacement) {
          return (
            <Link
              key={i}
              href={replacement.href}
              className={cls}
              lang={locale}
            >
              {replacement.label}
            </Link>
          );
        }
        return b.href.startsWith("/") ? (
          <Link
            key={i}
            href={shortSignupHref(b.href)}
            className={cls}
            lang={b.label.locale}
          >
            {b.label.value}
          </Link>
        ) : (
          <a
            key={i}
            href={b.href}
            className={cls}
            target="_blank"
            rel="noopener noreferrer"
            lang={b.label.locale}
          >
            {b.label.value}
          </a>
        );
      })}
    </div>
  );
}

export function RichTextBlock({
  block,
  locale,
  signedInLinks,
}: {
  block: Extract<Block, { type: "RICH_TEXT" }>;
  locale: string;
  signedInLinks?: SignedInLinkMap;
}) {
  const body = resolveLocalized(block.text, locale);
  if (!body.value.trim()) return null;
  return (
    <section className="mx-auto max-w-3xl px-4 py-8">
      <div
        lang={body.locale}
        className={`text-slate-600 ${block.align === "center" ? "text-center" : ""}`}
      >
        <Markdown signedInLinks={signedInLinks}>{body.value}</Markdown>
      </div>
    </section>
  );
}

export function ImageBlock({
  block,
  locale,
}: {
  block: Extract<Block, { type: "IMAGE" }>;
  locale: string;
}) {
  if (!block.imageId) return null;
  const maxW =
    block.width === "narrow"
      ? "max-w-md"
      : block.width === "full"
        ? "max-w-5xl"
        : "max-w-3xl";
  const caption = resolveLocalized(block.caption, locale);
  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      <figure
        className={`mx-auto ${maxW}`}
        lang={caption.value ? caption.locale : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/images/${block.imageId}`}
          alt={caption.value}
          className="h-auto w-full rounded-xl border border-slate-200"
        />
        {caption.value && (
          <figcaption className="muted mt-2 text-center text-sm">
            {caption.value}
          </figcaption>
        )}
      </figure>
    </section>
  );
}

export function ButtonsBlock({
  block,
  locale,
  signedInLinks,
}: {
  block: Extract<Block, { type: "BUTTONS" }>;
  locale: string;
  signedInLinks?: SignedInLinkMap;
}) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-8">
      <ButtonRow block={block} locale={locale} signedInLinks={signedInLinks} />
    </section>
  );
}

/** A leaf block rendered bare (no section wrapper) — used inside a COLUMNS column. */
export function ColumnLeaf({
  block,
  locale,
  signedInLinks,
}: {
  block: LeafBlock;
  locale: string;
  signedInLinks?: SignedInLinkMap;
}) {
  switch (block.type) {
    case "RICH_TEXT": {
      const body = resolveLocalized(block.text, locale);
      if (!body.value.trim()) return null;
      return (
        <div
          lang={body.locale}
          className={`text-sm text-slate-600 ${block.align === "center" ? "text-center" : ""}`}
        >
          <Markdown signedInLinks={signedInLinks}>{body.value}</Markdown>
        </div>
      );
    }
    case "IMAGE": {
      if (!block.imageId) return null;
      const caption = resolveLocalized(block.caption, locale);
      return (
        <figure lang={caption.value ? caption.locale : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/images/${block.imageId}`}
            alt={caption.value}
            className="h-auto w-full rounded-lg border border-slate-200"
          />
          {caption.value && (
            <figcaption className="muted mt-1.5 text-center text-xs">
              {caption.value}
            </figcaption>
          )}
        </figure>
      );
    }
    case "BUTTONS":
      return (
        <ButtonRow block={block} locale={locale} signedInLinks={signedInLinks} />
      );
  }
}

const COLUMN_GRID: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

export function ColumnsBlock({
  block,
  locale,
  signedInLinks,
}: {
  block: Extract<Block, { type: "COLUMNS" }>;
  locale: string;
  signedInLinks?: SignedInLinkMap;
}) {
  const cols = block.columns.filter((c) => c.length > 0);
  if (cols.length === 0) return null;
  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      <div className={`grid grid-cols-1 gap-5 ${COLUMN_GRID[cols.length] ?? "sm:grid-cols-2"}`}>
        {cols.map((col, ci) => (
          <div key={ci} className={block.card ? "card space-y-3 p-5" : "space-y-3"}>
            {col.map((leaf) => (
              <ColumnLeaf
                key={leaf.id}
                block={leaf}
                locale={locale}
                signedInLinks={signedInLinks}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Render an array of blocks as a standalone page — content blocks only (system blocks skipped). */
export function PageBlocks({
  blocks,
  locale,
  signedInLinks,
}: {
  blocks: Block[];
  locale: string;
  signedInLinks?: SignedInLinkMap;
}) {
  return (
    <>
      {blocks.map((block) => {
        switch (block.type) {
          case "RICH_TEXT":
            return (
              <RichTextBlock
                key={block.id}
                block={block}
                locale={locale}
                signedInLinks={signedInLinks}
              />
            );
          case "IMAGE":
            return <ImageBlock key={block.id} block={block} locale={locale} />;
          case "BUTTONS":
            return (
              <ButtonsBlock
                key={block.id}
                block={block}
                locale={locale}
                signedInLinks={signedInLinks}
              />
            );
          case "COLUMNS":
            return (
              <ColumnsBlock
                key={block.id}
                block={block}
                locale={locale}
                signedInLinks={signedInLinks}
              />
            );
          default:
            return null; // system blocks are landing-only
        }
      })}
    </>
  );
}
