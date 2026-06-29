"use client";

import ReactMarkdown from "react-markdown";

/**
 * Render trusted markdown (the admin-edited policy documents) with the app's typography.
 * CommonMark only — no raw HTML is rendered, so it's safe even though the source is editable.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: ({ node: _n, ...p }) => (
          <h1 className="mt-4 mb-2 text-lg font-semibold text-slate-900 first:mt-0" {...p} />
        ),
        h2: ({ node: _n, ...p }) => (
          <h2 className="mt-4 mb-1 text-base font-semibold text-slate-900" {...p} />
        ),
        h3: ({ node: _n, ...p }) => (
          <h3 className="mt-4 mb-1 text-sm font-semibold text-slate-900" {...p} />
        ),
        p: ({ node: _n, ...p }) => <p className="my-2" {...p} />,
        ul: ({ node: _n, ...p }) => <ul className="my-2 list-disc space-y-1 pl-5" {...p} />,
        ol: ({ node: _n, ...p }) => <ol className="my-2 list-decimal space-y-1 pl-5" {...p} />,
        li: ({ node: _n, ...p }) => <li className="leading-relaxed" {...p} />,
        strong: ({ node: _n, ...p }) => <strong className="font-semibold text-slate-900" {...p} />,
        em: ({ node: _n, ...p }) => <em className="italic" {...p} />,
        code: ({ node: _n, ...p }) => (
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-800" {...p} />
        ),
        hr: () => <hr className="my-4 border-slate-200" />,
        a: ({ node: _n, ...p }) => (
          <a className="link" target="_blank" rel="noopener noreferrer" {...p} />
        ),
        // Inserted images (e.g. uploaded landing-page art at /api/images/<id>). Constrained,
        // rounded, and lazy so a large image never blows out the column.
        img: ({ node: _n, alt, ...p }) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="my-3 h-auto max-w-full rounded-lg border border-slate-200"
            alt={alt ?? ""}
            loading="lazy"
            {...p}
          />
        ),
        blockquote: ({ node: _n, ...p }) => (
          <blockquote className="my-2 border-l-2 border-slate-200 pl-3 text-slate-600" {...p} />
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
