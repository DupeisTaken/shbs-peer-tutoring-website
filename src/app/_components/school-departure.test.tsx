// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { DepartureBanner, SchoolDeparturePanel } from "./school-departure";

const fixture = vi.hoisted(() => ({
  data: {
    departure: { reason: "TRANSFERRED", revision: 2, observerRevoked: false },
    access: { canReadManagement: true },
    role: "STUDENT",
    events: [],
  },
  save: vi.fn(),
  request: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./management-actions", () => ({
  ManagementActions: () => <div>My requests</div>,
}));
vi.mock("./profile-dialog", () => ({
  ProfileDialog: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ invalidate: vi.fn() }),
    departure: {
      state: { useQuery: () => ({ data: fixture.data }) },
      setState: { useMutation: () => ({ mutate: fixture.save }) },
      request: { useMutation: () => ({ mutate: fixture.request }) },
    },
  },
}));
const show = (node: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
beforeEach(() => {
  cleanup();
  fixture.save.mockClear();
  fixture.request.mockClear();
  fixture.data.access.canReadManagement = true;
});

it("links transferred students to the viewer portal and preserves the history explanation", () => {
  show(<DepartureBanner />);
  expect(
    screen
      .getByRole("link", { name: "Enter viewer portal" })
      .getAttribute("href"),
  ).toBe("/admin");
  expect(screen.getByText(/records remain available/)).toBeTruthy();
});
it("withholds the link after observer access is revoked", () => {
  fixture.data.access.canReadManagement = false;
  show(<DepartureBanner />);
  expect(screen.queryByRole("link")).toBeNull();
});
it("requires a reason and consequence review before requesting a departure", () => {
  show(<SchoolDeparturePanel />);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Request change",
    }).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Reason for review" }), {
    target: { value: "Moving to a new school" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Request change" }));
  expect(fixture.request).not.toHaveBeenCalled();
  expect(screen.getByText(/Current assignments are detached/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
  expect(fixture.request).toHaveBeenCalledWith({
    action: "TRANSFERRED",
    expectedRevision: 2,
    explanation: "Moving to a new school",
  });
  expect(
    screen.queryByRole("option", { name: "Restore viewer access" }),
  ).toBeNull();
});
