import Link from "next/link";

/** Top-nav links for the published custom pages flagged "show in nav" (see getNavPages). */
export function NavPageLinks({ pages }: { pages: { slug: string; label: string }[] }) {
  if (pages.length === 0) return null;
  return (
    <>
      {pages.map((p) => (
        <Link
          key={p.slug}
          href={`/p/${p.slug}`}
          className="text-sm font-medium text-slate-600 transition hover:text-slate-900"
        >
          {p.label}
        </Link>
      ))}
    </>
  );
}
