/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ProgramTimeZoneSettings, TimeZoneEditor } from "./program-time-zone-settings";
const mutate = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  settings: { timeZone: "Asia/Shanghai", canEdit: true, canApply: false, timeZoneOptions: ["UTC", "Asia/Shanghai", "America/New_York"] },
  queryError: null as null | { message: string },
  error: null as null | { message: string; data: { approvalId?: string; code?: string } },
  refetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    program: {
      timeZoneSettings: { useQuery: () => ({ data: state.settings, error: state.queryError, refetch: state.refetch }) },
      setTimeZone: { useMutation: () => ({ mutate, isPending: false, error: state.error }) },
    },
  },
}));
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {children}
  </NextIntlClientProvider>
);
const props = {
  timeZone: "Asia/Shanghai",
  canEdit: true,
  timeZoneOptions: ["UTC", "Asia/Shanghai", "America/New_York"],
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  state.settings.timeZone = "Asia/Shanghai";
  state.queryError = null;
  state.error = null;
});
it("offers only selection, requires confirmation, and clears confirmation when the selection changes", () => {
  render(<TimeZoneEditor {...props} />, { wrapper });
  expect(screen.queryByRole("textbox")).toBeNull();
  const select = screen.getByRole("combobox");
  fireEvent.change(select, { target: { value: "America/New_York" } });
  const save = screen.getByRole<HTMLButtonElement>("button", {
    name: messages.programTimeZone.save,
  });
  expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(save);
  expect(mutate).toHaveBeenCalledWith({
    timeZone: "America/New_York",
    expectedTimeZone: "Asia/Shanghai",
  });
  fireEvent.change(select, { target: { value: "UTC" } });
  expect(save.disabled).toBe(true);
});
it("keeps the dropdown disabled for a coordinator without permission", () => {
  render(<TimeZoneEditor {...props} canEdit={false} />, { wrapper });
  expect(screen.getByRole<HTMLSelectElement>("combobox").disabled).toBe(true);
  expect(screen.queryByRole("button")).toBeNull();
});

it("previews winter and summer offsets without changing saved IANA values", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-15T08:00:00Z"));
  render(<TimeZoneEditor {...props} />, { wrapper });
  const zone = screen.getByRole("combobox");
  const date = screen.getByLabelText(messages.programTimeZone.referenceDate);
  expect(
    screen.getByRole<HTMLOptionElement>("option", {
      name: /New York.*EDT.*GMT-04:00/,
    }).value,
  ).toBe("America/New_York");
  fireEvent.change(zone, { target: { value: "America/New_York" } });
  fireEvent.change(date, { target: { value: "2026-01-15" } });
  expect(
    screen.getByRole("option", { name: /New York.*EST.*GMT-05:00/ }),
  ).toBeDefined();
  expect(screen.getByText("2026-01-15 07:00")).toBeDefined();
  expect(screen.getByText("2026-01-15 20:00")).toBeDefined();
  expect(zone.getAttribute("aria-describedby")).toBe("program-time-zone-label");
  expect(
    document.getElementById("program-time-zone-label")?.textContent,
  ).toContain("GMT-05:00");
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button"));
  expect(mutate).toHaveBeenCalledWith({
    timeZone: "America/New_York",
    expectedTimeZone: "Asia/Shanghai",
  });
});

it("localizes Chinese names and retains saved region aliases", () => {
  render(
    <NextIntlClientProvider locale="zh" messages={zh}>
      <TimeZoneEditor {...props} timeZone="Asia/Calcutta" />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByRole<HTMLOptionElement>("option", {
      name: /Asia \/ Calcutta.*印度.*GMT\+05:30/,
    }).selected,
  ).toBe(true);
  expect(screen.getByRole("option", { name: /UTC.*GMT\+00:00/ })).toBeDefined();
});

it.each(["CET", "GMT", "EST", "HST"])(
  "retains a supplied slashless saved alias %s in the actual dropdown",
  (timeZone) => {
    // New writes still require a region-based zone or UTC. Rendering an existing
    // Intl-supported alias must not silently select some other option instead.
    render(<TimeZoneEditor {...props} timeZone={timeZone} />, { wrapper });
    const select = screen.getByRole<HTMLSelectElement>("combobox");
    expect(select.value).toBe(timeZone);
    const savedOption = Array.from(select.options).find(
      (option) => option.value === timeZone,
    );
    expect(savedOption?.selected).toBe(true);
    expect(savedOption?.textContent).toContain("GMT");
  },
);

it("labels an Admin timezone change as a Head request while retaining the selected zone", () => {
  render(<TimeZoneEditor {...props} canApply={false} />, { wrapper });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "America/New_York" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: messages.approvals.requestHead }));
  expect(mutate).toHaveBeenCalledWith({ timeZone: "America/New_York", expectedTimeZone: "Asia/Shanghai" });
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("America/New_York");
});
it("retains an Admin's queued timezone draft and version through background failure and live updates", () => {
  const view = render(<ProgramTimeZoneSettings />, { wrapper });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "America/New_York" } });
  fireEvent.click(screen.getByRole("checkbox"));
  state.error = { message: "Queued", data: { approvalId: "request" } };
  state.queryError = { message: "Refresh failed" };
  view.rerender(<ProgramTimeZoneSettings />);
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("America/New_York");
  expect(screen.getByText(messages.approvals.queuedBody)).toBeTruthy();
  state.queryError = null;
  state.settings = { ...state.settings, timeZone: "UTC" };
  view.rerender(<ProgramTimeZoneSettings />);
  fireEvent.click(screen.getByRole("button", { name: messages.approvals.requestHead }));
  expect(mutate).toHaveBeenLastCalledWith({ timeZone: "America/New_York", expectedTimeZone: "Asia/Shanghai" });
  expect(screen.getByText(messages.approvals.queuedBody)).toBeTruthy();
});
it("adopts new timezone evidence only after explicit Reload succeeds", async () => {
  const view = render(<ProgramTimeZoneSettings />, { wrapper });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "America/New_York" } });
  state.refetch.mockResolvedValueOnce({ isSuccess: false });
  fireEvent.click(screen.getByRole("button", { name: messages.profilePolicy.reload }));
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: messages.profilePolicy.reload }).disabled).toBe(false));
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("America/New_York");
  state.settings = { ...state.settings, timeZone: "UTC" };
  view.rerender(<ProgramTimeZoneSettings />);
  state.refetch.mockResolvedValueOnce({ isSuccess: true });
  fireEvent.click(screen.getByRole("button", { name: messages.profilePolicy.reload }));
  await waitFor(() => expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("UTC"));
});
