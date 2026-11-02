// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { ServiceHoursComparison } from "./service-hours-comparison";
afterEach(cleanup);
it("keeps a named keyboard-scrollable breakdown as the only roster without fake actions", () => {
  render(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <ServiceHoursComparison
        panel="breakdown"
        sort={{ key: "total", dir: "none", toggle: vi.fn() }}
        rows={[
          {
            tutorId: "one",
            englishName: "Sample Tutor",
            active: true,
            sessions: 3,
            adjustmentCount: 2,
            earned: 2.5,
            extras: 1,
            punishments: 0.5,
            total: 3,
          },
          {
            tutorId: "two",
            englishName: "Past Tutor",
            active: false,
            sessions: 1,
            adjustmentCount: 0,
            earned: 1,
            extras: 0,
            punishments: 0,
            total: 1,
          },
        ]}
      />
    </NextIntlClientProvider>,
  );
  expect(screen.getAllByRole("table")).toHaveLength(1);
  const region = screen.getByRole("region", {
    name: messages.admin.summary.compareLabel,
  });
  expect(region.tabIndex).toBe(0);
  expect(within(region).getAllByRole("columnheader")).toHaveLength(6);
  expect(within(region).getAllByRole("row")).toHaveLength(3);
  expect(within(region).getByText(/Past Tutor/).textContent).toContain(
    messages.admin.summary.inactive,
  );
  expect(within(region).getByText("2.5")).toBeTruthy();
  expect(within(region).getByText("0.5")).toBeTruthy();
  expect(within(region).getAllByRole("button")).toHaveLength(6);
  expect(
    within(region).queryByRole("button", { name: /details|edit/i }),
  ).toBeNull();
});
