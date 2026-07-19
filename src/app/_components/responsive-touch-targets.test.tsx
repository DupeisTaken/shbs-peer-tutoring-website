import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ButtonRow } from "./page-blocks";
import { NavLink } from "./nav-link";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
}));

describe("responsive navigation touch targets", () => {
  it("lets mobile navigation add touch sizing without losing its active state", () => {
    const markup = renderToStaticMarkup(
      <NavLink href="/admin" label="Dashboard" exact className="min-h-11" />,
    );

    expect(markup).toContain("nav-link-active");
    expect(markup).toContain("min-h-11");
  });

  it("keeps internal and external public actions at least 44px tall", () => {
    const markup = renderToStaticMarkup(
      <ButtonRow
        locale="en"
        block={{
          id: "actions",
          type: "BUTTONS",
          buttons: [
            { label: { en: "Join" }, href: "/signup", style: "primary" },
            {
              label: { en: "Learn more" },
              href: "https://example.com",
              style: "secondary",
            },
          ],
        }}
      />,
    );

    expect(markup).toContain('class="btn-primary min-h-11"');
    expect(markup).toContain('class="btn-secondary min-h-11"');
    expect(markup).toContain('target="_blank"');
  });
});
