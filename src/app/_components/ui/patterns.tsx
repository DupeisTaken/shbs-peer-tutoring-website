import type { ReactNode } from "react";

/** A field group declares the scope of the Save/Cancel row immediately following its fields. */
export function FormSection({
  title,
  description,
  children,
  actions,
  busy = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  busy?: boolean;
}) {
  return (
    <fieldset disabled={busy} aria-busy={busy} className="min-w-0 space-y-4">
      <legend className="section-title">{title}</legend>
      {description && <p className="muted">{description}</p>}
      {children}
      {actions && <FormActions>{actions}</FormActions>}
    </fieldset>
  );
}

export function FormActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
      {children}
    </div>
  );
}

/** Distinguish pending work from denial and failure; an unavailable page must not spin forever. */
export function StatePanel({
  kind,
  title,
  children,
  action,
}: {
  kind: "loading" | "empty" | "error" | "denied";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      role={kind === "error" ? "alert" : "status"}
      aria-busy={kind === "loading"}
      className={`rounded-lg border p-4 ${kind === "error" ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      {children && (
        <div className="mt-2 text-sm text-slate-600">{children}</div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </section>
  );
}

/** Keep real comparison matrices intact, with a named, keyboard-scrollable local viewport. */
export function ScrollTable({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="muted mb-2 text-xs lg:hidden">{hint}</p>
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="focus-visible:ring-accent-500 max-w-full overflow-x-auto rounded-lg focus-visible:ring-2 focus-visible:outline-none"
      >
        {children}
      </div>
    </div>
  );
}
