"use client";

import { useLayoutEffect, useRef } from "react";

const VIEWPORT_GUTTER = 16;

/** Keeps an absolutely positioned popover inside a one-rem viewport gutter. */
export function useClampedPopover<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;

    const keepInViewport = () => {
      const element = ref.current;
      if (!element) return;

      element.style.transform = "";
      const rect = element.getBoundingClientRect();
      const rightEdge = window.innerWidth - VIEWPORT_GUTTER;
      let shift = 0;

      if (rect.left < VIEWPORT_GUTTER) shift = VIEWPORT_GUTTER - rect.left;
      if (rect.right + shift > rightEdge) {
        shift -= rect.right + shift - rightEdge;
      }

      element.style.transform = shift ? `translateX(${shift}px)` : "";
    };

    keepInViewport();
    window.addEventListener("resize", keepInViewport);
    return () => window.removeEventListener("resize", keepInViewport);
  }, [open]);

  return ref;
}
