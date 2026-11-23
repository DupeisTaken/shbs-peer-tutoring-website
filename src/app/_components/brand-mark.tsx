/**
 * Bespoke geometric emblem for the peer-tutoring brand: two interlocking open pages
 * forming a subtle upward chevron. Inherits the active runtime accent palette via
 * `accent-*` utilities so switching themes re-skins the mark cleanly without assets.
 */
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`bg-accent-600 ring-accent-700/15 inline-flex shrink-0 items-center justify-center rounded-lg text-white shadow-xs ring-1 ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4.5 6.5C7 5.5 9.8 6 12 7.8c2.2-1.8 5-2.3 7.5-1.3v10.8c-2.5-1-5.3-.5-7.5 1.2-2.2-1.7-5-2.2-7.5-1.2V6.5Z" />
        <path d="M12 7.8v10.7" />
      </svg>
    </span>
  );
}
