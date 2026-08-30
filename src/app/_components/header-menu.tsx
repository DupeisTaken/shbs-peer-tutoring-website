"use client";

import Link from "next/link";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { DisclosureIcon } from "~/app/_components/icons";
import { useClampedPopover } from "~/app/_components/use-clamped-popover";

export type HeaderMenuItem = {
  href: string;
  label: string;
  strong?: boolean;
  group?: string;
  separatorBefore?: boolean;
};

type HeaderMenuGroupValue = {
  openId: string | null;
  setOpenId: (id: string | null) => void;
};

const HeaderMenuGroupContext = createContext<HeaderMenuGroupValue | null>(null);
const HeaderMenuCloseContext = createContext<() => void>(() => undefined);

export function useHeaderMenuClose() {
  return useContext(HeaderMenuCloseContext);
}

export function HeaderMenuGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <HeaderMenuGroupContext.Provider value={{ openId, setOpenId }}>
      <nav className={className}>{children}</nav>
    </HeaderMenuGroupContext.Provider>
  );
}

/**
 * Compact navigation disclosure shared by the public header and custom pages.
 * It keeps its panel inside the viewport, closes sibling menus, and restores
 * focus to the trigger when dismissed with Escape. `compact` restores the
 * legacy desktop control height; mobile headers retain the 44px touch target.
 */
export function HeaderMenu({
  label,
  items,
  tone = "secondary",
  align = "left",
  className,
  showDisclosure = true,
  children,
  panelWidth = "content",
  compact = false,
}: {
  label: string;
  items: HeaderMenuItem[];
  tone?: "primary" | "secondary";
  align?: "left" | "right";
  className?: string;
  showDisclosure?: boolean;
  children?: ReactNode;
  panelWidth?: "content" | "wide";
  compact?: boolean;
}) {
  const id = useId();
  const group = useContext(HeaderMenuGroupContext);
  const panelId = `${id}-panel`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const open = group ? group.openId === id : localOpen;
  const panelRef = useClampedPopover<HTMLDivElement>(open);
  const close = useCallback(() => {
    if (group) group.setOpenId(null);
    else setLocalOpen(false);
  }, [group]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [close, open]);

  if (items.length === 0 && !children) return null;

  const toggle = () => {
    const next = !open;
    if (group) group.setOpenId(next ? id : null);
    else setLocalOpen(next);
  };

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-controls={panelId}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
        className={`btn-sm flex cursor-pointer items-center gap-2 ${
          compact ? "" : "min-h-11"
        } ${tone === "primary" ? "btn-primary" : "btn-secondary"}`}
      >
        <span>{label}</span>
        {showDisclosure ? <DisclosureIcon open={open} /> : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={label}
          className={`absolute z-30 mt-2 max-h-[calc(100vh-4.5rem)] max-w-[calc(100vw-2rem)] min-w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg ${
            panelWidth === "wide" ? "w-72" : "w-max"
          } ${align === "right" ? "right-0" : "left-0"}`}
        >
          <HeaderMenuCloseContext.Provider value={close}>
            <div className="grid gap-1">
              {items.map((item, index) => (
                <div
                  key={item.href}
                  className={
                    item.separatorBefore
                      ? "mt-1 border-t border-slate-100 pt-1"
                      : undefined
                  }
                >
                  {item.group && item.group !== items[index - 1]?.group ? (
                    <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase first:pt-1">
                      {item.group}
                    </p>
                  ) : null}
                  <Link
                    href={item.href}
                    onClick={close}
                    className={`flex min-h-11 items-center rounded-md px-3 py-2 text-sm leading-snug whitespace-normal text-slate-700 transition hover:bg-slate-50 hover:text-slate-950 ${
                      item.strong ? "font-bold text-slate-950" : "font-medium"
                    }`}
                  >
                    {item.label}
                  </Link>
                </div>
              ))}
            </div>
            {children ? (
              <div className="mt-2 border-t border-slate-100 px-2 pt-3 pb-2">
                {children}
              </div>
            ) : null}
          </HeaderMenuCloseContext.Provider>
        </div>
      ) : null}
    </div>
  );
}
