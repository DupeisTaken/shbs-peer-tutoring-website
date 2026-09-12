/** @vitest-environment jsdom */
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  AdminPreferenceIdentity,
  DismissibleNotice,
} from "./dismissible-notice";
afterEach(() => {
  cleanup();
  localStorage.clear();
});
const notice = (user: string) => (
  <AdminPreferenceIdentity value={user}>
    <DismissibleNotice
      noticeId="schedule"
      title="Schedule help"
      helpLabel="Reopen help"
      dismissLabel="Dismiss"
    >
      Important guidance
    </DismissibleNotice>
  </AdminPreferenceIdentity>
);
it("persists dismissal for one account, reopens help, and keeps another account independent", () => {
  const view = render(notice("admin-a"));
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByText("Important guidance")).toBeNull();
  view.unmount();
  const reopened = render(notice("admin-a"));
  expect(screen.getByRole("button", { name: "Reopen help" })).toBeTruthy();
  reopened.rerender(notice("admin-b"));
  expect(screen.getByText("Important guidance")).toBeTruthy();
  reopened.rerender(notice("admin-a"));
  fireEvent.click(screen.getByRole("button", { name: "Reopen help" }));
  expect(screen.getByText("Important guidance")).toBeTruthy();
});
