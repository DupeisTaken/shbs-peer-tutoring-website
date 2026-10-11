/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SessionViewProvider, useSessionViewState } from "./session-view-state";
import {
  viewEnum,
  viewStateKey,
  writeViewState,
} from "~/lib/session-view-state";

const parse = viewEnum(["current", "history"]);
function Probe({
  scope = "period-1",
  enabled = true,
}: {
  scope?: string;
  enabled?: boolean;
}) {
  const [tab, setTab] = useSessionViewState({
    id: "roster-v1",
    scope,
    enabled,
    initialState: "current",
    parse,
  });
  return (
    <>
      <p>{tab}</p>
      <button onClick={() => setTab("history")}>History</button>
      <input aria-label="Private draft" defaultValue="" />
    </>
  );
}
function view(
  identity = "head",
  scope = "period-1",
  enabled = true,
  verified = true,
) {
  return (
    <SessionViewProvider
      identity={identity}
      pathname="/admin/tutees"
      verified={verified}
    >
      <Probe scope={scope} enabled={enabled} />
    </SessionViewProvider>
  );
}
beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

it("restores an explicit tab across remounts without saving a private form draft", () => {
  const first = render(view());
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Private unsaved text" },
  });
  first.unmount();
  render(view());
  expect(screen.getByText("history")).toBeTruthy();
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("");
  expect(JSON.stringify(window.sessionStorage)).not.toContain(
    "Private unsaved text",
  );
});
it("partitions identity, role and query/period context and clears denied selection", () => {
  const first = render(view());
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  first.rerender(view("head", "period-2"));
  expect(screen.getByText("current")).toBeTruthy();
  first.rerender(view("head", "period-1"));
  expect(screen.getByText("history")).toBeTruthy();
  first.rerender(view("head", "period-1", false));
  expect(screen.getByText("current")).toBeTruthy();
  first.rerender(view("head", "period-1"));
  expect(screen.getByText("current")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  first.rerender(view("head-as-coordinator"));
  expect(screen.getByText("current")).toBeTruthy();
});
it("waits for identity verification and rejects removed choices", () => {
  const key = viewStateKey("head", "/admin/tutees", "roster-v1", "period-1");
  writeViewState(window.sessionStorage, key, "history");
  const first = render(view("head", "period-1", true, false));
  expect(screen.getByText("current")).toBeTruthy();
  first.rerender(view());
  expect(screen.getByText("history")).toBeTruthy();
  first.unmount();
  writeViewState(window.sessionStorage, key, "removed-tab");
  render(view());
  expect(screen.getByText("current")).toBeTruthy();
});
