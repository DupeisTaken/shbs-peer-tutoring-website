"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import {
  THEMES,
  DEFAULT_THEME,
  THEME_COOKIE,
  isTheme,
  type Theme,
} from "~/lib/theme";
import { useClampedPopover } from "~/app/_components/use-clamped-popover";
import { useHeaderMenuClose } from "~/app/_components/header-menu";

/**
 * Swatch per theme: a circle split diagonally ("/") into two true shades of the theme — a lighter
 * tone on one half and the deeper accent on the other (hard gradient stop at 50%, so each half is
 * a solid, accurate color). Uses literal palette utilities so swatches show real theme colors.
 */
const SWATCH: Record<Theme, string> = {
  indigo: "bg-gradient-to-br from-indigo-400 from-50% to-indigo-700 to-50%",
  violet: "bg-gradient-to-br from-violet-400 from-50% to-violet-700 to-50%",
  emerald: "bg-gradient-to-br from-emerald-400 from-50% to-emerald-700 to-50%",
  rose: "bg-gradient-to-br from-rose-400 from-50% to-rose-700 to-50%",
  amber: "bg-gradient-to-br from-amber-400 from-50% to-amber-700 to-50%",
  sky: "bg-gradient-to-br from-sky-400 from-50% to-sky-700 to-50%",
};

/** The root attribute is SSR-owned, so React observes it as an external store after hydration. */
function readDocumentTheme(): Theme {
  const current = document.documentElement.dataset.theme;
  return isTheme(current) ? current : DEFAULT_THEME;
}

function subscribeToThemeChange(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

/** Applies an explicit user choice and persists it for the next server render. */
function persistTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Accent-theme picker: a swatch button that opens a small dialog of color swatches. Applies
 * instantly by setting `data-theme` on <html> and persists the choice in a cookie (read back SSR
 * by the root layout). State-controlled popover so the open/close is reliable.
 */
/**
 * `compact` preserves the original public desktop header sizing. Dashboard
 * headers use `compactAtDesktop` so mobile keeps a touch-sized target.
 */
export function ThemeSwitcher({
  embedded = false,
  compact = false,
  compactAtDesktop = false,
}: {
  embedded?: boolean;
  compact?: boolean;
  compactAtDesktop?: boolean;
}) {
  const t = useTranslations();
  // The server snapshot avoids a hydration mismatch; the client reads the root attribute after
  // hydration, and observes changes made by this control or another theme-aware surface.
  const theme = useSyncExternalStore(
    subscribeToThemeChange,
    readDocumentTheme,
    () => DEFAULT_THEME,
  );
  const [open, setOpen] = useState(false);
  const closeHeaderMenu = useHeaderMenuClose();
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useClampedPopover<HTMLDivElement>(open);

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const apply = (next: Theme) => {
    setOpen(false);
    closeHeaderMenu();
    persistTheme(next);
  };

  const swatches = (
    <div className="grid grid-cols-3 gap-2">
      {THEMES.map((th) => {
        const selected = theme === th;
        return (
          <button
            key={th}
            type="button"
            aria-label={t(`components.theme.names.${th}`)}
            aria-pressed={selected}
            title={t(`components.theme.names.${th}`)}
            onClick={() => apply(th)}
            className={`flex h-11 w-11 items-center justify-center justify-self-center rounded-full ring-2 transition ${SWATCH[th]} ${
              selected
                ? "ring-slate-800"
                : "ring-transparent hover:ring-slate-300"
            }`}
          >
            {selected && (
              <span className="text-xs font-bold text-white drop-shadow-sm">
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  if (embedded) {
    return (
      <fieldset>
        <legend className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          {t("components.theme.label")}
        </legend>
        {swatches}
      </fieldset>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t("components.theme.label")}
        title={t("components.theme.label")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center justify-center rounded-md hover:bg-slate-100 ${
          compact
            ? "h-8 px-1"
            : compactAtDesktop
              ? "h-11 w-11 lg:h-8 lg:w-auto lg:px-1"
              : "h-11 w-11"
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full ring-1 ring-slate-300 ${SWATCH[theme]}`}
        />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t("components.theme.label")}
          className="absolute right-0 z-30 mt-2 w-44 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
        >
          <p className="pb-2 text-xs font-medium text-slate-500">
            {t("components.theme.label")}
          </p>
          {swatches}
        </div>
      )}
    </div>
  );
}
