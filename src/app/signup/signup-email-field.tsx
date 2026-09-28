"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FieldRequirement } from "~/app/_components/field-requirement";
import { useClampedPopover } from "~/app/_components/use-clamped-popover";

/** A focusable field label exposes guidance without making the resting form taller. */
export function SignupEmailField({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const id = useId();
  const labelId = `${id}-label`;
  const helpId = `${id}-help`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"closed" | "transient" | "pinned">("closed");
  const open = mode !== "closed" && !disabled;
  const panelRef = useClampedPopover<HTMLDivElement>(open);

  // Prefer the space above the label so the email input stays available. Flip
  // below when scrolling or resizing would otherwise clip the explanation.
  useLayoutEffect(() => {
    if (!open) return;
    const placeHelp = () => {
      const panel = panelRef.current;
      if (!panel) return;
      panel.dataset.placement = "above";
      if (panel.getBoundingClientRect().top < 16)
        panel.dataset.placement = "below";
    };
    placeHelp();
    window.addEventListener("resize", placeHelp);
    window.addEventListener("scroll", placeHelp, true);
    return () => {
      window.removeEventListener("resize", placeHelp);
      window.removeEventListener("scroll", placeHelp, true);
    };
  }, [open, panelRef]);

  // A click pins hover/focus help open; dismissal does not immediately reopen it
  // just because the pointer or keyboard focus is still on the trigger.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMode("closed");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMode("closed");
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const reveal = () => {
    if (!disabled)
      setMode((current) => (current === "closed" ? "transient" : current));
  };

  return (
    <div className="min-w-0 space-y-1">
      <div
        ref={rootRef}
        className="relative"
        onMouseLeave={() => {
          if (!rootRef.current?.contains(document.activeElement))
            setMode((current) =>
              current === "transient" ? "closed" : current,
            );
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setMode("closed");
        }}
      >
        <button
          type="button"
          disabled={disabled}
          aria-controls={helpId}
          aria-expanded={open}
          aria-describedby={helpId}
          onMouseEnter={reveal}
          onFocus={reveal}
          onClick={() =>
            setMode((current) => (current === "pinned" ? "closed" : "pinned"))
          }
          className="label focus-visible:outline-accent-500 flex min-h-11 max-w-full cursor-help items-center gap-1.5 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 lg:min-h-0"
        >
          <span id={labelId}>
            {t("survey.emailLabel")}
            <FieldRequirement state="required" />
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            className="h-4 w-4 shrink-0 text-slate-400"
          >
            <circle
              cx="10"
              cy="10"
              r="7.25"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path d="M10 9v5" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="10" cy="6" r="1" fill="currentColor" />
          </svg>
        </button>
        {/* The padded wrapper bridges the trigger-to-panel gap for pointer users.
            Keep the description in the DOM for screen readers even while hidden. */}
        <div
          ref={panelRef}
          id={helpId}
          role="tooltip"
          hidden={!open}
          className="absolute bottom-full left-0 z-30 w-72 max-w-[calc(100vw-2rem)] pb-2 data-[placement=below]:top-full data-[placement=below]:bottom-auto data-[placement=below]:pt-2 data-[placement=below]:pb-0"
        >
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-600 shadow-lg">
            {t("survey.emailHelp")}
          </div>
        </div>
      </div>
      <input
        type="email"
        autoComplete="email"
        aria-labelledby={labelId}
        aria-describedby={helpId}
        className="input min-h-11 lg:min-h-10"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        disabled={disabled}
        maxLength={254}
      />
    </div>
  );
}
