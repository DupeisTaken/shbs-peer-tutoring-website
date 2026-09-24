/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { HeaderMenu, HeaderMenuGroup } from "./header-menu";

const items = [{ href: "/dashboard", label: "Dashboard" }];

afterEach(cleanup);

describe("HeaderMenu", () => {
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
});
