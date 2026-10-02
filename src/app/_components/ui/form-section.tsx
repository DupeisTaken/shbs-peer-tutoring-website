import type { ReactNode } from "react";

/** Adapt the reviewed FormSection guard to this branch's existing form layout.
 * A completed section is disabled without announcing or registering pending work. */
export function FormSection({
  children,
  busy = false,
  disabled = false,
  className = "space-y-4",
}: {
  children: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <fieldset
      disabled={busy || disabled}
      aria-busy={busy}
      className={`min-w-0 ${className}`}
    >
      {children}
    </fieldset>
  );
}
