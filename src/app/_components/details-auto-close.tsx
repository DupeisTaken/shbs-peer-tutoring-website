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

    const onPointerDown = (e: PointerEvent) => {
      if (details.open && !details.contains(e.target as Node)) details.open = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") details.open = false;
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return <span ref={anchor} hidden aria-hidden />;
}
