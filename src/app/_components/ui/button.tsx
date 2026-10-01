import type { ComponentProps } from "react";

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "standard" | "compact";
};

/** Size follows the action's context; visual emphasis never changes its hit area. */
export function Button({
  variant = "secondary",
  size = "standard",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn-${variant} ${size === "compact" ? "control-compact" : "control-standard"} ${className}`}
      {...props}
    />
  );
}

/** A persistent choice has a quieter treatment than the action which commits it. */
export function ChoiceButton({
  selected,
  size = "compact",
  className = "",
  ...props
}: ComponentProps<"button"> & {
  selected: boolean;
  size?: "standard" | "compact";
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`choice-control ${size === "standard" ? "control-standard px-3 py-2" : "control-compact"} ${className}`}
      {...props}
    />
  );
}

/** Artwork stays compact inside a full touch target. The caller supplies a translated name. */
export function Switch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="switch-control"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? "bg-accent-700" : "bg-slate-300"}`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
        />
      </span>
    </button>
  );
}
