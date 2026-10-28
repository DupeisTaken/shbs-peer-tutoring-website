import { programCalendarDate } from "./program-calendar";

/** Date fragments select public calendar facts only after strict date validation. */
export function schoolCalendarHashDate(hash: string): string | null {
  const match = /^#school-calendar\/(\d{4}-\d{2}-\d{2})$/.exec(hash);
  return match && programCalendarDate.safeParse(match[1]).success
    ? match[1]!
    : null;
}

/** Next's client navigation changes history without a native hashchange. Keep
 * same-document notification fragments native so the owning page's validated
 * record adapter reveals its target without unmounting independent editor drafts.
 * Modified/new-tab clicks never enter Link.onNavigate; other destinations stay
 * under Next's normal navigation. A repeated fragment still reveals hidden rows. */
/** Only server-issued, relative record destinations delegate scroll to their
 * authorized page adapter. Ordinary and external links keep Next's defaults. */
export function isNotificationRecordDestination(href: string) {
  const calendar = /^\/(?:dashboard|student)(#school-calendar\/[^#?]+)$/.exec(
    href,
  );
  return (
    !!(calendar && schoolCalendarHashDate(calendar[1]!)) ||
    /^\/admin\/(?:requests#request-(?:survey|signup)-|applications#application-|tutor-requests#request-|crew#(?:request|application)-|pairings#)[a-zA-Z0-9_-]{1,128}$/.test(
      href,
    )
  );
}

export function navigateNotificationFragment(
  href: string,
  event: { preventDefault(): void },
) {
  const target = new URL(href, window.location.href);
  if (
    !target.hash ||
    target.origin !== window.location.origin ||
    target.pathname !== window.location.pathname ||
    target.search !== window.location.search
  )
    return;
  event.preventDefault();
  if (target.hash === window.location.hash)
    // Equal URLs identify a deliberate repeat, unlike paired popstate/hashchange
    // browser events for one Back/Forward arrival.
    window.dispatchEvent(
      new HashChangeEvent("hashchange", {
        oldURL: window.location.href,
        newURL: target.href,
      }),
    );
  else if (isNotificationRecordDestination(href)) {
    // A native hash assignment scrolls every ancestor before our owning pane
    // can reveal the committed record. Preserve the ordinary Back entry and
    // Next's current history payload, but delegate the sole scroll to that page.
    const oldURL = window.location.href;
    window.history.pushState(window.history.state, "", target.href);
    window.dispatchEvent(
      new HashChangeEvent("hashchange", { oldURL, newURL: target.href }),
    );
  } else window.location.hash = target.hash;
}
