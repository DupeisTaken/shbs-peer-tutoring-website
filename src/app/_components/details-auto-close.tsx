"use client";

import { useEffect, useRef } from "react";

/**
 * Drop inside a native `<details>` dropdown to close it when the user clicks/taps outside it
 * (or presses Escape). Native `<details>` only toggles on its own `<summary>`, so without this
 * an open panel stays open when you click elsewhere. Renders nothing visible.
 */
export function DetailsAutoClose() {
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const details = anchor.current?.closest("details");
    if (!details) return;
    details.dataset.autoCloseDetails = "true";

    const onPointerDown = (e: PointerEvent) => {
      if (details.open && !details.contains(e.target as Node))
        details.open = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") details.open = false;
    };
    const onToggle = () => {
      if (!details.open) return;
      document
        .querySelectorAll<HTMLDetailsElement>(
          'details[data-auto-close-details="true"][open]',
        )
        .forEach((other) => {
          if (other !== details) other.open = false;
        });
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    details.addEventListener("toggle", onToggle);
    return () => {
      delete details.dataset.autoCloseDetails;
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      details.removeEventListener("toggle", onToggle);
    };
  }, []);

  return <span ref={anchor} hidden aria-hidden />;
}
