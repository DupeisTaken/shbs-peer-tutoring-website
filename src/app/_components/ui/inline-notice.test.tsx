/** @vitest-environment jsdom */
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { compile } from "tailwindcss";
import { parse } from "postcss";
import Link from "next/link";
import { Button } from "./button";
import { InlineNotice } from "./patterns";

afterEach(cleanup);

it.each(["info", "warning", "success", "error"] as const)(
  "preserves the %s notice's full content, chosen announcement and feature callbacks",
  (tone) => {
    const retry = vi.fn();
    const content = (announcement?: "alert" | "status", disabled = false) => (
      <InlineNotice
        tone={tone}
        announcement={announcement}
        action={
          <div className="flex flex-wrap gap-2">
            <Button disabled={disabled} onClick={retry}>
              Retry retained history and corrections
            </Button>
            <Link href="/ui-gallery">Open retained history</Link>
          </div>
        }
      >
        <p>Previously loaded content is still shown.</p>
        <input aria-label="Retained draft" defaultValue="Original" />
      </InlineNotice>
    );
    const view = render(content());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    const draft = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Retained draft",
    });
    fireEvent.change(draft, { target: { value: "Unsaved example" } });
    const retryButton = screen.getByRole("button", {
      name: "Retry retained history and corrections",
    });
    retryButton.focus();
    fireEvent.click(retryButton);
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/ui-gallery");
    view.rerender(content("alert"));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(
      within(screen.getByRole("alert")).getByText(
        "Previously loaded content is still shown.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("textbox")).toBe(draft);
    expect(draft.value).toBe("Unsaved example");
    expect(screen.getByRole("button")).toBe(retryButton);
    expect(document.activeElement).toBe(retryButton);
    view.rerender(content("status", true));
    expect(retryButton.matches(":disabled")).toBe(true);
    fireEvent.click(retryButton);
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("textbox")).toBe(draft);
    expect(draft.value).toBe("Unsaved example");
  },
);

it("omits the action slot without replacing mounted content or adding an announcement", () => {
  function Example() {
    const [hasAction, setHasAction] = useState(true);
    return (
      <>
        <button onClick={() => setHasAction(!hasAction)}>
          Toggle recovery
        </button>
        <InlineNotice action={hasAction ? <Button>Retry</Button> : undefined}>
          <input aria-label="Draft" defaultValue="Keep this" />
        </InlineNotice>
      </>
    );
  }
  render(<Example />);
  const draft = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Draft",
  });
  fireEvent.change(draft, { target: { value: "Still editing" } });
  const row = draft.parentElement!.parentElement!;
  expect(row.children).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Toggle recovery" }));
  expect(row.children).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.getByRole("textbox")).toBe(draft);
  expect(draft.value).toBe("Still editing");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

it("compiles a nonzero message basis and bounded, locally wrapping controls", async () => {
  render(
    <InlineNotice
      action={
        <div className="flex flex-wrap gap-2">
          <Button>Retry a long recovery label</Button>
          <button type="button" className="btn-secondary">
            Reload the current snapshot
          </button>
          <Link href="/ui-gallery">Open retained history</Link>
        </div>
      }
    >
      <p>ExampleRecoveryReferenceWithoutSpaces</p>
    </InlineNotice>,
  );
  const body = screen.getByText(
    "ExampleRecoveryReferenceWithoutSpaces",
  ).parentElement!;
  const actions = screen.getByRole("link").parentElement!.parentElement!;
  const row = body.parentElement!;
  const compiler = await compile("@tailwind utilities;");
  const output = parse(
    compiler.build([
      ...new Set(
        [body, actions, row].flatMap((element) => [...element.classList]),
      ),
    ]),
  );
  function declarations(element: Element, nested?: string) {
    const values: Record<string, string> = {};
    output.walkRules((rule) => {
      if (nested) {
        if (
          rule.selector.replaceAll(" ", "") !== nested ||
          rule.parent?.type !== "rule" ||
          !element.matches(rule.parent.selector)
        )
          return;
      } else if (
        rule.parent?.type !== "root" ||
        !element.matches(rule.selector)
      )
        return;
      for (const node of rule.nodes) {
        if (node.type === "decl") values[node.prop] = node.value;
      }
    });
    return values;
  }
  // Installed utilities guard line collection and local control wrapping. jsdom
  // does not measure flex geometry; native mobile/desktop bounds remain required.
  expect(declarations(body)).toMatchObject({
    "min-width": "0",
    flex: "1 1 16rem",
    "overflow-wrap": "anywhere",
  });
  expect(declarations(row)).toMatchObject({
    display: "flex",
    "flex-wrap": "wrap",
  });
  expect(declarations(actions)).toMatchObject({
    "min-width": "0",
    "max-width": "100%",
    "flex-wrap": "wrap",
    "overflow-wrap": "anywhere",
  });
  for (const selector of ["&button", "&a"]) {
    expect(declarations(actions, selector)).toMatchObject({
      "max-width": "100%",
      "white-space": "normal",
    });
  }
  expect(declarations(actions, "&>*")).toMatchObject({ "max-width": "100%" });
  // Descendant controls keep their existing target minima; only the slot shrinks.
  expect(declarations(actions, "&button")["min-width"]).toBeUndefined();
  expect(declarations(actions, "&button")["min-height"]).toBeUndefined();
});
