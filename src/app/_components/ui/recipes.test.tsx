/** @vitest-environment jsdom */
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { DisclosureSection } from "./disclosure-section";
import { InlineNotice } from "./patterns";

afterEach(cleanup);

function Draft() {
  const [value, setValue] = useState("");
  return (
    <input
      aria-label="Draft"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}
function toggle(summary: string, open: boolean) {
  const details = screen.getByText(summary).closest("details")!;
  details.open = open;
  fireEvent(details, new Event("toggle"));
}

it("retained disclosures mount on first opening and keep a draft through collapse", () => {
  render(
    <DisclosureSection title="Edit section" lifetime="retained">
      <Draft />
    </DisclosureSection>,
  );
  expect(screen.queryByLabelText("Draft")).toBeNull();
  toggle("Edit section", true);
  fireEvent.change(screen.getByLabelText("Draft"), {
    target: { value: "Keep this draft" },
  });
  toggle("Edit section", false);
  expect(screen.getByLabelText<HTMLInputElement>("Draft").value).toBe(
    "Keep this draft",
  );
  toggle("Edit section", true);
  expect(screen.getByLabelText<HTMLInputElement>("Draft").value).toBe(
    "Keep this draft",
  );
});

it("lazy details unmount while mounted creation content exists before the first open", () => {
  const view = render(
    <DisclosureSection title="Details" lifetime="lazy">
      <Draft />
    </DisclosureSection>,
  );
  toggle("Details", true);
  expect(screen.getByLabelText("Draft")).toBeTruthy();
  toggle("Details", false);
  expect(screen.queryByLabelText("Draft")).toBeNull();
  view.unmount();
  render(
    <DisclosureSection title="Create" lifetime="mounted">
      <Draft />
    </DisclosureSection>,
  );
  expect(screen.getByLabelText("Draft")).toBeTruthy();
});

it("keeps notice announcements explicit to avoid nested alerts and announcing static hints", () => {
  const view = render(
    <InlineNotice tone="warning">Static guidance</InlineNotice>,
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  view.rerender(
    <InlineNotice tone="error" announcement="alert">
      Refresh failed
    </InlineNotice>,
  );
  expect(screen.getByRole("alert").textContent).toBe("Refresh failed");
  view.rerender(
    <InlineNotice tone="error">
      <p role="alert">Domain error</p>
    </InlineNotice>,
  );
  expect(screen.getAllByRole("alert")).toHaveLength(1);
});
