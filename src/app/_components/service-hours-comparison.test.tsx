// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { ServiceHoursComparison } from "./service-hours-comparison";
afterEach(cleanup);
it("keeps a named keyboard-scrollable comparison of the full breakdown without fake actions", () => {
  const view = render(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <ServiceHoursComparison
        rows={[
          {
            tutorId: "one",
            englishName: "Sample Tutor",
            active: true,
            sessions: 3,
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
            earned: 1,
            extras: 0,
            punishments: 0,
            total: 1,
          },
        ]}
      />
    </NextIntlClientProvider>,
  );
  expect(screen.queryByRole("table")).toBeNull();
  const details = view.container.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  const region = screen.getByRole("region", {
    name: messages.admin.summary.compareLabel,
  });
  expect(region.tabIndex).toBe(0);
  expect(within(region).getAllByRole("columnheader")).toHaveLength(6);
  expect(within(region).getAllByRole("rowheader")).toHaveLength(2);
  expect(within(region).getByText("2.5")).toBeTruthy();
  expect(within(region).getByText("0.5")).toBeTruthy();
  expect(within(region).queryByRole("button")).toBeNull();
});
