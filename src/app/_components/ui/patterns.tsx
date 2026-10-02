import type { ReactNode } from "react";

/** A field group declares the scope of the Save/Cancel row immediately following its fields. */
export function FormSection({
  title,
  description,
  children,
  actions,
  busy = false,
  disabled = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  busy?: boolean;
  /** A completed/read-only section is disabled without announcing ongoing work. */
  disabled?: boolean;
}) {
  return (
    <fieldset
      disabled={busy || disabled}
      aria-busy={busy}
      className="min-w-0 space-y-4"
    >
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

/** Keep usable content and its draft mounted during background failures. Choose
 * announcements explicitly; domain errors that already own an alert need none here. */
export function InlineNotice({
  tone = "info",
  announcement,
  children,
  action,
}: {
  tone?: "info" | "warning" | "success" | "error";
  announcement?: "alert" | "status";
  children: ReactNode;
  action?: ReactNode;
}) {
  const colors = {
    info: "border-slate-200 bg-slate-50 text-slate-700",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    error: "border-red-200 bg-red-50 text-red-800",
  };
  return (
    <div
      role={announcement}
      className={`min-w-0 rounded-lg border p-3 text-sm ${colors[tone]}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

/** Layout only: selection, URL state, counts and reset rules remain feature-owned. */
export function FilterToolbar({
  label,
  children,
  summary,
  actions,
}: {
  label: string;
  children: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section aria-label={label} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end gap-3">{children}</div>
      {(Boolean(summary) || Boolean(actions)) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {summary && <div className="text-sm text-slate-600">{summary}</div>}
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
      )}
    </section>
  );
}

/** The control decides save semantics: immediate binary switch, explicit tri-state
 * choices, or staged checkboxes within a form. This row supplies no persistence. */
export function SettingRow({
  label,
  description,
  control,
  feedback,
}: {
  label: string;
  description?: ReactNode;
  control: ReactNode;
  feedback?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{label}</p>
          {description && (
            <div className="mt-1 text-sm text-slate-600">{description}</div>
          )}
        </div>
        <div
          role="group"
          aria-label={label}
          className="flex flex-wrap items-center gap-2"
        >
          {control}
        </div>
      </div>
      {feedback}
    </div>
  );
}

/** Presentation slots only. Tickets, immutable evidence, confirmation and authority
 * stay in the feature; opening this review never submits its proposed change. */
export function ChangeReview({
  title,
  evidence,
  consequences,
  acknowledgement,
  actions,
}: {
  title: string;
  evidence: ReactNode;
  consequences?: ReactNode;
  acknowledgement?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section aria-label={title} className="min-w-0 space-y-4">
      <h3 className="section-title">{title}</h3>
      {evidence}
      {consequences}
      {acknowledgement}
      <FormActions>{actions}</FormActions>
    </section>
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
