/** Reveal the focused control below the actual responsive sticky header. Both
 * window-scrolling pages and the management shell's independent content panel
 * need to reveal context; a fixed scroll-margin cannot account for wrapped text. */
export function focusVisibleContext(
  target: HTMLElement | null,
  context: HTMLElement | null = null,
) {
  if (!target) return;
  target.focus({ preventScroll: true });
  const headerBottom = Math.max(
    0,
    ...Array.from(
      document.querySelectorAll<HTMLElement>("[data-sticky-header]"),
      (header) => header.getBoundingClientRect().bottom,
    ),
  );
  let container = target.parentElement;
  while (container && container !== document.body) {
    if (
      /auto|scroll/.test(getComputedStyle(container).overflowY) &&
      container.scrollHeight > container.clientHeight
    )
      break;
    container = container.parentElement;
  }
  const scrollPanel =
    container && container !== document.body ? container : null;
  const panelBox = scrollPanel?.getBoundingClientRect();
  const visibleTop = Math.max(headerBottom, panelBox?.top ?? 0);
  const visibleBottom = Math.min(
    window.innerHeight,
    panelBox?.bottom ?? window.innerHeight,
  );
  const box = target.getBoundingClientRect();
  const contextTop = context?.getBoundingClientRect().top ?? box.top;
  // Keep the recipient/label above the field visible when it fits. With enlarged
  // text or a short viewport, prioritize the focused control's usable area.
  const revealTop =
    box.bottom - contextTop <= visibleBottom - visibleTop - 40
      ? Math.min(contextTop, box.top)
      : box.top;
  if (revealTop < visibleTop + 16 || box.bottom > visibleBottom - 16) {
    (scrollPanel ?? window).scrollBy({
      top: revealTop - visibleTop - 24,
      behavior: "instant",
    });
  }
}
