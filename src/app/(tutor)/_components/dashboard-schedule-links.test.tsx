// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import { DashboardScheduleLinks } from "./dashboard-schedule-links";
import { focusVisibleContext } from "~/app/_components/focus-visible-context";

vi.mock("~/app/_components/focus-visible-context", () => ({
  focusVisibleContext: vi.fn(),
}));
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/dashboard");
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const show = (interviewsEnabled = true) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DashboardScheduleLinks interviewsEnabled={interviewsEnabled} />
    </NextIntlClientProvider>,
  );

it.each(["sessions", "attendance", "tutor-meetings"])(
  "keeps legacy #%s usable through an explicit Schedule continuation",
  (target) => {
    let frame: FrameRequestCallback = () => undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    window.history.replaceState(null, "", `/dashboard#${target}`);
    show();
    act(() => frame(0));
    expect(
      screen
        .getByRole("link", { name: messages.tutor.schedulePage.openSchedule })
        .getAttribute("href"),
    ).toBe(`/schedule#${target}`);
    expect(focusVisibleContext).toHaveBeenLastCalledWith(
      document.getElementById(target),
    );
    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.hash).toBe(`#${target}`);
  },
);

it("retains a mounted editor when a legacy notification hash arrives", () => {
  let frame: FrameRequestCallback = () => undefined;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  show();
  const editor = document.createElement("dialog");
  editor.setAttribute("open", "");
  editor.innerHTML = '<input value="Unsaved draft">';
  document.body.append(editor);
  window.history.replaceState(null, "", "/dashboard#attendance");
  fireEvent(window, new HashChangeEvent("hashchange"));
  act(() => frame(0));
  expect(editor.querySelector("input")?.value).toBe("Unsaved draft");
  expect(editor.open).toBe(true);
  expect(focusVisibleContext).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole("link", { name: messages.tutor.schedulePage.openSchedule })
      .getAttribute("href"),
  ).toBe("/schedule#attendance");
  editor.remove();
});

it("keeps chair anchors on the dashboard and gates the panelist shortcut", () => {
  window.history.replaceState(null, "", "/dashboard#tutor-interviews");
  show(false);
  expect(screen.queryByRole("status")).toBeNull();
  expect(
    screen.queryByRole("link", {
      name: messages.tutor.schedulePage.interviews,
    }),
  ).toBeNull();
  expect(
    screen
      .getByRole("link", { name: messages.tutor.schedulePage.openSchedule })
      .getAttribute("href"),
  ).toBe("/schedule");
});
