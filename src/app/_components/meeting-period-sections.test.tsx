// @vitest-environment jsdom
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { MeetingPeriodSections } from "./meeting-period-sections";
import { DisclosureSection } from "./ui/disclosure-section";
afterEach(cleanup);
function Draft({ period }: { period: string }) {
  const [value, setValue] = useState("");
  return (
    <input
      aria-label={period}
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}
const catalog = {
  current: { key: "26-27:Q2", label: "2026–27 Q2" },
  outsideUpcoming: 0,
  history: [] as { key: string; label: string; count: number }[],
};
const element = (data = catalog) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    <MeetingPeriodSections
      catalog={data}
      renderPeriod={(period) => <Draft period={period} />}
    />
  </NextIntlClientProvider>
);

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
