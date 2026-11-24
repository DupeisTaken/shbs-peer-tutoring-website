import Link from "next/link";

export type WorkspaceLink = { href: string; label: string };

/** Keep workspace switches scannable and visually quiet (borderless ghost links)
 * so they never compete with page cards or turn the header into "border soup".
 * Matches the 32px desktop baseline while retaining 44px mobile touch targets.
 */
export function WorkspaceLinks({ items }: { items: WorkspaceLink[] }) {
  return (
    <div className="-ml-1.5 flex max-w-full flex-wrap items-center gap-x-0.5 gap-y-0 lg:ml-0 lg:gap-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={false}
          className="focus-visible:ring-accent-500 inline-flex min-h-11 max-w-full items-center rounded-md px-1.5 text-xs font-medium whitespace-normal text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden lg:min-h-8 lg:px-2.5 lg:text-[13px]"
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
