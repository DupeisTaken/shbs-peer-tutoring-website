import Image from "next/image";

/**
 * Official peer-tutoring brand emblem served from the single repository-owned
 * `src/app/icon.png` asset (shared with the browser tab icon and email footer).
 * Kept decorative (`aria-hidden` + empty `alt`) so adjacent header title links
 * announce the brand name once.
 */
export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-brand-mark=""
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg shadow-xs ring-1 ring-slate-900/10 ${className}`}
    >
      <Image
        src="/icon.png"
        alt=""
        width={32}
        height={32}
        unoptimized
        loading="eager"
        className="h-full w-full object-cover"
      />
    </span>
  );
}
