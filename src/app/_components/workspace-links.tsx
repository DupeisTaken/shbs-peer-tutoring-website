import Link from "next/link";

export type WorkspaceLink = { href: string; label: string };

/** Keep workspace switches visible, adjacent, and able to wrap on narrow screens.
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
          className="btn-secondary btn-sm min-h-11 max-w-full whitespace-normal"
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
