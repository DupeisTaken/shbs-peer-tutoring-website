import Link from "next/link";

import { Markdown } from "~/app/_components/markdown";
import { pickLocalized, type Block, type LeafBlock } from "~/lib/page-blocks";

/**
 * Renderers for the content blocks (RICH_TEXT / IMAGE / BUTTONS / COLUMNS). Shared by the landing
 * page (`LandingView`) and standalone custom pages (`/p/<slug>`). System blocks
 * (HERO/FEATURES/SECTIONS/NEWS) are landing-only and handled by `LandingView`.
 */

/** Shared button row (internal links use the router; external links open in a new tab). */
export function ButtonRow({
  block,
  locale,
}: {
  block: Extract<Block, { type: "BUTTONS" }>;
  locale: string;
}) {
  const buttons = block.buttons
    .map((b) => ({ ...b, label: pickLocalized(b.label, locale) }))
    .filter((b) => b.label.trim() && b.href);
  if (buttons.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-3 ${block.align === "center" ? "justify-center" : ""}`}>
      {buttons.map((b, i) => {
        // Public block actions remain comfortable touch targets even when their copy is short.
        const cls = `${b.style === "primary" ? "btn-primary" : "btn-secondary"} min-h-11`;
        return b.href.startsWith("/") ? (
          <Link key={i} href={b.href} className={cls}>
            {b.label}
          </Link>
        ) : (
          <a key={i} href={b.href} className={cls} target="_blank" rel="noopener noreferrer">
            {b.label}
          </a>
        );
      })}
    </div>
  );
}

export function RichTextBlock({
  block,
  locale,
}: {
  block: Extract<Block, { type: "RICH_TEXT" }>;
  locale: string;
}) {
  const body = pickLocalized(block.text, locale);
  if (!body.trim()) return null;
  return (
    <section className="mx-auto max-w-3xl px-4 py-8">
      <div className={`text-slate-600 ${block.align === "center" ? "text-center" : ""}`}>
        <Markdown>{body}</Markdown>
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
    block.width === "narrow" ? "max-w-md" : block.width === "full" ? "max-w-5xl" : "max-w-3xl";
  const caption = pickLocalized(block.caption, locale);
  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      <figure className={`mx-auto ${maxW}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/images/${block.imageId}`}
          alt={caption}
          className="h-auto w-full rounded-xl border border-slate-200"
        />
        {caption && <figcaption className="muted mt-2 text-center text-sm">{caption}</figcaption>}
      </figure>
    </section>
  );
}

export function ButtonsBlock({
  block,
  locale,
}: {
  block: Extract<Block, { type: "BUTTONS" }>;
  locale: string;
}) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-8">
      <ButtonRow block={block} locale={locale} />
    </section>
  );
}

/** A leaf block rendered bare (no section wrapper) — used inside a COLUMNS column. */
export function ColumnLeaf({ block, locale }: { block: LeafBlock; locale: string }) {
  switch (block.type) {
    case "RICH_TEXT": {
      const body = pickLocalized(block.text, locale);
      if (!body.trim()) return null;
      return (
        <div className={`text-sm text-slate-600 ${block.align === "center" ? "text-center" : ""}`}>
          <Markdown>{body}</Markdown>
        </div>
      );
    }
    case "IMAGE": {
      if (!block.imageId) return null;
      const caption = pickLocalized(block.caption, locale);
      return (
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/images/${block.imageId}`}
            alt={caption}
            className="h-auto w-full rounded-lg border border-slate-200"
          />
          {caption && <figcaption className="muted mt-1.5 text-center text-xs">{caption}</figcaption>}
        </figure>
      );
    }
    case "BUTTONS":
      return <ButtonRow block={block} locale={locale} />;
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
}: {
  block: Extract<Block, { type: "COLUMNS" }>;
  locale: string;
}) {
  const cols = block.columns.filter((c) => c.length > 0);
  if (cols.length === 0) return null;
  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      <div className={`grid grid-cols-1 gap-5 ${COLUMN_GRID[cols.length] ?? "sm:grid-cols-2"}`}>
        {cols.map((col, ci) => (
          <div key={ci} className={block.card ? "card space-y-3 p-5" : "space-y-3"}>
            {col.map((leaf) => (
              <ColumnLeaf key={leaf.id} block={leaf} locale={locale} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Render an array of blocks as a standalone page — content blocks only (system blocks skipped). */
export function PageBlocks({ blocks, locale }: { blocks: Block[]; locale: string }) {
  return (
    <>
      {blocks.map((block) => {
        switch (block.type) {
          case "RICH_TEXT":
            return <RichTextBlock key={block.id} block={block} locale={locale} />;
          case "IMAGE":
            return <ImageBlock key={block.id} block={block} locale={locale} />;
          case "BUTTONS":
            return <ButtonsBlock key={block.id} block={block} locale={locale} />;
          case "COLUMNS":
            return <ColumnsBlock key={block.id} block={block} locale={locale} />;
          default:
            return null; // system blocks are landing-only
        }
      })}
    </>
  );
}
