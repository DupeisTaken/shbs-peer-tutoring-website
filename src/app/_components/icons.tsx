import { SYMBOLS } from "~/lib/symbols";

/**
 * The shared collapse/expand affordance. Renders a disclosure triangle that points right when
 * collapsed and rotates to point down when `open`. Use this everywhere a section toggles so the
 * gesture is consistent across the app (admin request cards, service-hour months, etc.).
 */
export function DisclosureIcon({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block text-xs leading-none transition-transform ${open ? "rotate-90" : ""}`}
    >
      {SYMBOLS.disclosure}
    </span>
  );
}
