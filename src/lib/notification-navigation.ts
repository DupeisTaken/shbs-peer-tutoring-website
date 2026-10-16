/** Next's client navigation changes history without a native hashchange. Keep
 * same-document notification fragments native so the owning page's validated
 * record adapter reveals its target without unmounting independent editor drafts.
 * Modified/new-tab clicks never enter Link.onNavigate; other destinations stay
 * under Next's normal navigation. A repeated fragment still reveals hidden rows. */
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
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  else window.location.hash = target.hash;
}
