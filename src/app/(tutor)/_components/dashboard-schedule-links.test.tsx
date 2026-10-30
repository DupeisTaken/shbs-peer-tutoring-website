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
  document
    .querySelectorAll("[data-test-chair], [data-test-editor]")
    .forEach((element) => element.remove());
  window.history.replaceState(null, "", "/dashboard");
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function chairSection(loaded = false) {
  const section = document.createElement("section");
  section.id = "tutor-interviews";
  section.tabIndex = -1;
  section.dataset.testChair = "true";
  section.innerHTML = loaded
    ? '<article data-interview-id="synthetic-chair-appointment">Chair appointment</article>'
    : '<p role="status">Loading interviews</p>';
  document.body.append(section);
  return section;
}

it("reveals the chair workspace once after its asynchronous content commits", async () => {
  let frame: FrameRequestCallback = () => undefined;
  const raf = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
  window.history.replaceState(null, "", "/dashboard#tutor-interviews");
  const section = chairSection();
  show();
  expect(raf).not.toHaveBeenCalled();
  await act(async () => {
    section.innerHTML =
      '<article data-interview-id="synthetic-chair-appointment">Chair appointment</article>';
  });
  expect(raf).toHaveBeenCalledOnce();
  act(() => frame(0));
  expect(focusVisibleContext).toHaveBeenCalledExactlyOnceWith(section);
  await act(async () => {
    section.append(document.createElement("p"));
  });
  expect(raf).toHaveBeenCalledOnce();
});

it("leaves an open editor and its focus intact when chair content becomes ready", async () => {
  let frame: FrameRequestCallback = () => undefined;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  window.history.replaceState(null, "", "/dashboard#tutor-interviews");
  chairSection(true);
  show();
  const editor = document.createElement("dialog");
  editor.dataset.testEditor = "true";
  editor.setAttribute("open", "");
  editor.innerHTML = '<input value="Unsaved chair draft">';
  document.body.append(editor);
  editor.querySelector("input")!.focus();
  act(() => frame(0));
  expect(focusVisibleContext).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(editor.querySelector("input"));
  expect(editor.querySelector("input")!.value).toBe("Unsaved chair draft");
  expect(editor.open).toBe(true);
});

it.each(["wheel", "pointerdown"])(
  "cancels an unfinished chair arrival after %s",
  async (gesture) => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    window.history.replaceState(null, "", "/dashboard#tutor-interviews");
    const section = chairSection();
    show();
    fireEvent(window, new Event(gesture));
    await act(async () => {
      section.innerHTML =
        '<article data-interview-id="late">Late chair content</article>';
    });
    expect(raf).not.toHaveBeenCalled();
    expect(focusVisibleContext).not.toHaveBeenCalled();
  },
);

it("cancels a waiting chair arrival when the hash changes", async () => {
  const raf = vi.spyOn(window, "requestAnimationFrame");
  window.history.replaceState(null, "", "/dashboard#tutor-interviews");
  const section = chairSection();
  show();
  window.history.replaceState(null, "", "/dashboard#tutor-preferences");
  fireEvent(window, new HashChangeEvent("hashchange"));
  await act(async () => {
    section.innerHTML =
      '<article data-interview-id="late">Late chair content</article>';
  });
  expect(raf).not.toHaveBeenCalled();
  expect(focusVisibleContext).not.toHaveBeenCalled();
});

it("does not wait for or reveal a disabled chair workspace", () => {
  const raf = vi.spyOn(window, "requestAnimationFrame");
  window.history.replaceState(null, "", "/dashboard#tutor-interviews");
  chairSection(true);
  show(false);
  expect(raf).not.toHaveBeenCalled();
  expect(focusVisibleContext).not.toHaveBeenCalled();
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
