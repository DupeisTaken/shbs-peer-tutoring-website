// @vitest-environment jsdom
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import {
  MeetingPeriodSections,
  useMeetingPeriodBusy,
} from "./meeting-period-sections";
import { DisclosureSection } from "./ui/disclosure-section";
afterEach(cleanup);
function Draft({ period, busy = false }: { period: string; busy?: boolean }) {
  const [value, setValue] = useState("");
  useMeetingPeriodBusy(busy);
  return (
    <input
      aria-label={period}
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}
const catalog = {
  quarters: true,
  current: { key: "26-27:Q2", label: "2026–27 Q2" },
  outsideUpcoming: 0,
  history: [] as { key: string; label: string; count: number }[],
};
type Catalog = Parameters<typeof MeetingPeriodSections>[0]["catalog"];
const element = (data: Catalog = catalog, busy = false, onReload = vi.fn()) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    <MeetingPeriodSections
      catalog={data}
      renderPeriod={(period) => <Draft period={period} busy={busy} />}
      onReload={onReload}
    />
  </NextIntlClientProvider>
);

const semester = {
  ...catalog,
  quarters: false,
  current: { key: "26-27:S1", label: "2026–27 S1" },
};

it("keeps the same draft/controller graph through Q→S→Q applied regrouping", () => {
  const view = render(element());
  const original = screen.getByRole<HTMLInputElement>("textbox", {
    name: "26-27:Q2",
  });
  fireEvent.change(original, { target: { value: "unsaved attendance" } });
  view.rerender(element(semester));
  expect(screen.getByText("Previous grouping · 2026–27 Q2")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "26-27:Q2" })).toBe(original);
  expect(screen.queryByRole("textbox", { name: "26-27:S1" })).toBeNull();
  expect(original.value).toBe("unsaved attendance");
  view.rerender(element());
  expect(
    screen.queryByText(messages.meetingPeriods.groupingChanged),
  ).toBeNull();
  expect(screen.getByRole("textbox", { name: "26-27:Q2" })).toBe(original);
  expect(original.value).toBe("unsaved attendance");
});

it("warns before reload, preserves drafts on cancellation, and reloads only after confirmation", async () => {
  const reload = vi.fn();
  const view = render(element(catalog, false, reload));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "keep me" },
  });
  view.rerender(element(semester, false, reload));
  fireEvent.click(
    screen.getByRole("button", { name: messages.meetingPeriods.reload }),
  );
  expect(screen.getByRole("dialog").textContent).toContain(
    messages.meetingPeriods.reloadWarning,
  );
  await act(async () => {
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: messages.meetingPeriods.keepEditing,
      }),
    );
  });
  expect(reload).not.toHaveBeenCalled();
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("keep me");
  fireEvent.click(
    screen.getByRole("button", { name: messages.meetingPeriods.reload }),
  );
  await act(async () => {
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: messages.meetingPeriods.reload,
      }),
    );
  });
  expect(reload).toHaveBeenCalledOnce();
});

it("blocks reload during an owner's write or synchronization and rechecks after confirmation", async () => {
  const reload = vi.fn();
  const view = render(element(catalog, true, reload));
  view.rerender(element(semester, true, reload));
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: messages.meetingPeriods.reload,
  });
  expect(button.disabled).toBe(true);
  view.rerender(element(semester, false, reload));
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  view.rerender(element(semester, true, reload));
  await act(async () => {
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: messages.meetingPeriods.reload,
      }),
    );
  });
  expect(reload).not.toHaveBeenCalled();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.meetingPeriods.reload,
    }).disabled,
  ).toBe(true);
});

it("detects applied regrouping with no active period or meeting keys", () => {
  const empty = { ...catalog, current: null };
  const view = render(element(empty));
  view.rerender(element({ ...empty, quarters: false }));
  expect(
    screen.getByText(messages.meetingPeriods.groupingChanged),
  ).toBeTruthy();
});

it("uses the applied semester mode immediately on a fresh visit", () => {
  render(element(semester));
  expect(screen.getByRole("textbox", { name: "26-27:S1" })).toBeTruthy();
  expect(
    screen.queryByText(messages.meetingPeriods.groupingChanged),
  ).toBeNull();
});

it("keeps supplemental membership bound to the displayed group while retaining its controller", () => {
  const reader = vi.fn(
    (period: string, _history: boolean, _outsideCurrent?: string | null) => (
      <Draft period={period} />
    ),
  );
  const tree = (data: Catalog) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <MeetingPeriodSections catalog={data} renderPeriod={reader} />
    </NextIntlClientProvider>
  );
  const view = render(tree({ ...catalog, outsideUpcoming: 1 }));
  const outside = screen.getByRole<HTMLInputElement>("textbox", {
    name: "upcomingOutside",
  });
  fireEvent.change(outside, { target: { value: "outside excuse draft" } });
  reader.mockClear();
  view.rerender(tree({ ...semester, outsideUpcoming: 0 }));
  expect(screen.getByRole("textbox", { name: "upcomingOutside" })).toBe(
    outside,
  );
  expect(outside.value).toBe("outside excuse draft");
  expect(
    reader.mock.calls.find(([period]) => period === "upcomingOutside")?.[2],
  ).toBe("26-27:Q2");
});

it("binds reads to recorded keys and keeps one draft owner when the active quarter changes", async () => {
  const view = render(element());
  const original = screen.getByRole("textbox", { name: "26-27:Q2" });
  fireEvent.change(original, { target: { value: "unsaved attendance" } });
  view.rerender(
    element({
      ...catalog,
      current: { key: "26-27:Q3", label: "2026–27 Q3" },
      history: [{ key: "26-27:Q2", label: "2026–27 Q2", count: 1 }],
    }),
  );
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "26-27:Q3" }).value,
  ).toBe("");
  expect(screen.queryByRole("textbox", { name: "current" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: messages.meetingPeriods.history }),
  );
  const details = screen
    .getByText("2026–27 Q2 · 1 meeting")
    .closest("details")!;
  await act(async () => {
    details.open = true;
    fireEvent(details, new Event("toggle"));
  });
  expect(screen.getByRole("textbox", { name: "26-27:Q2" })).toBe(original);
  expect((original as HTMLInputElement).value).toBe("unsaved attendance");
});

it("retains controlled disclosure children after programmatic opening and closing", () => {
  const tree = (open: boolean) => (
    <DisclosureSection
      title="Controlled period"
      lifetime="retained"
      open={open}
    >
      <Draft period="retained" />
    </DisclosureSection>
  );
  const view = render(tree(false));
  expect(screen.queryByRole("textbox")).toBeNull();
  view.rerender(tree(true));
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "retained draft" } });
  view.rerender(tree(false));
  view.rerender(tree(true));
  expect(screen.getByRole("textbox")).toBe(input);
  expect((input as HTMLInputElement).value).toBe("retained draft");
});
