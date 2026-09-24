import Link from "next/link";

export type WorkspaceLink = { href: string; label: string };

/** Keep workspace switches visible, adjacent, and able to wrap on narrow screens.
 * Match the language selector's 32px desktop height, retaining 44px mobile targets.
 * Layouts reuse these same destinations in their account submenu.
 */
export function WorkspaceLinks({ items }: { items: WorkspaceLink[] }) {
  return (
    <div className="flex max-w-full flex-wrap items-center gap-2">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={false}
          className="btn-secondary btn-sm min-h-11 max-w-full whitespace-normal lg:min-h-8 lg:py-0"
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
