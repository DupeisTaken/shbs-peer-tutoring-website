import { SYMBOLS } from "~/lib/symbols";

/**
 * The shared collapse/expand affordance: a disclosure triangle pointing right when collapsed
 * and down when `open`. Use this everywhere a section toggles so the gesture is consistent
 * across the app (admin request cards, tutor applications, service-hour months, etc.).
 */
export function DisclosureIcon({ open }: { open: boolean }) {
  return (
    <span aria-hidden className="inline-block text-xs leading-none text-slate-400">
      {open ? SYMBOLS.disclosureOpen : SYMBOLS.disclosureClosed}
    </span>
  );
}
