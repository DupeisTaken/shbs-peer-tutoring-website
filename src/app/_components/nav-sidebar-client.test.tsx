/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { NavSidebarClient } from "./nav-sidebar-client";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));

const sections = [
  {
    key: "people",
    title: "People",
    items: [{ href: "/admin/users", label: "Users" }],
  },
  {
    key: "program",
    title: "Program",
    items: [{ href: "/admin/settings", label: "Settings" }],
  },
];
const tree = () => (
  <NavSidebarClient
    sections={sections}
    collapseAllLabel="Collapse all"
    expandAllLabel="Expand all"
  />
);
beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("hydrates the expanded server snapshot and restores saved disclosure choices", async () => {
  window.localStorage.setItem(
    "adminNavCollapsed",
    JSON.stringify({ people: true }),
  );
  const container = document.createElement("div");
  container.innerHTML = renderToString(tree());
  document.body.append(container);
  expect(
    container.querySelector("[aria-controls]")?.getAttribute("aria-expanded"),
  ).toBe("true");
  const recoverable = vi.fn();
  const root = hydrateRoot(container, tree(), {
    onRecoverableError: recoverable,
  });
  try {
    await act(async () => undefined);
    expect(
      screen
        .getByRole("button", { name: "People" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "Program" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(recoverable).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("synchronizes mounted nav instances and external storage changes", () => {
  render(
    <>
      {tree()}
      {tree()}
    </>,
  );
  fireEvent.click(screen.getAllByRole("button", { name: "People" })[0]!);
  expect(
    screen
      .getAllByRole("button", { name: "People" })
      .every((button) => button.getAttribute("aria-expanded") === "false"),
  ).toBe(true);
  act(() => {
    window.localStorage.setItem(
      "adminNavCollapsed",
      JSON.stringify({ program: true }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: "adminNavCollapsed" }),
    );
  });
  expect(
    screen
      .getAllByRole("button", { name: "People" })
      .every((button) => button.getAttribute("aria-expanded") === "true"),
  ).toBe(true);
  expect(
    screen
      .getAllByRole("button", { name: "Program" })
      .every((button) => button.getAttribute("aria-expanded") === "false"),
  ).toBe(true);
});

it.each(["malformed", "null", "[]", '{"people":"false"}'])(
  "ignores invalid stored presentation %s",
  (stored) => {
    window.localStorage.setItem("adminNavCollapsed", stored);
    render(tree());
    expect(
      screen
        .getByRole("button", { name: "People" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.getByRole("button", { name: "Expand all" })).toBeTruthy();
  },
);

it("keeps explicit choices usable when storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Unavailable");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Unavailable");
  });
  render(tree());
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  expect(
    screen
      .getByRole("button", { name: "People" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
  expect(screen.getByRole("button", { name: "Expand all" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
  expect(
    screen
      .getByRole("button", { name: "People" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
});
