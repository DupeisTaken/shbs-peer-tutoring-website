/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { HeaderMenu, HeaderMenuGroup } from "./header-menu";

const items = [{ href: "/dashboard", label: "Dashboard" }];

afterEach(cleanup);

describe("HeaderMenu", () => {
  it("marks a fallback label without changing the menu language or destination", () => {
    render(
      <div lang="zh">
        <HeaderMenu
          label="菜单"
          items={[{ href: "/p/synthetic", label: "English label", lang: "en" }]}
        />
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "菜单" });
    fireEvent.click(trigger);
    const link = screen.getByRole("link", { name: "English label" });
    expect(link.lang).toBe("en");
    expect(link.getAttribute("href")).toBe("/p/synthetic");
    expect(trigger.closest("[lang]")?.getAttribute("lang")).toBe("zh");
    expect(
      screen.getByRole("dialog", { name: "菜单" }).hasAttribute("lang"),
    ).toBe(false);
  });

  it("opens accessibly and closes when the user clicks outside", () => {
    render(<HeaderMenu label="Menu" items={items} />);
    const trigger = screen.getByRole("button", { name: "Menu" });

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
  });

  it("closes an open sibling menu before opening the next one", () => {
    render(
      <HeaderMenuGroup>
        <HeaderMenu label="First" items={items} />
        <HeaderMenu label="Second" items={items} />
      </HeaderMenuGroup>,
    );
    const first = screen.getByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });

    fireEvent.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(second);
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(second.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("dialog", { name: "First" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Second" })).toBeTruthy();
  });

  it("restores trigger focus when Escape dismisses the menu", () => {
    render(<HeaderMenu label="Menu" items={items} />);
    const trigger = screen.getByRole("button", { name: "Menu" });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("renders an optional item description beneath the menu link label", () => {
    render(
      <HeaderMenu
        label="Menu"
        items={[
          {
            href: "/viewer",
            label: "Follow the Program",
            description: "For school faculty, parents, college staff, and guests",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const link = screen.getByRole("link", { name: /Follow the Program/ });
    expect(link.getAttribute("href")).toBe("/viewer");
    expect(link.textContent).toContain(
      "For school faculty, parents, college staff, and guests",
    );
  });
});
