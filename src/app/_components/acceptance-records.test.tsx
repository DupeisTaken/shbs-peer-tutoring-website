// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { AcceptanceRecords } from "./acceptance-records";
const mocks = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }));
vi.mock("~/trpc/react", () => ({
  api: { student: { acceptanceRecords: { useQuery: mocks.query } } },
}));
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);
it("shows readable current status and exact historical version/text, without raw snapshots", () => {
  mocks.query.mockReturnValue({
    data: {
      current: [
        {
          slug: "tutee-policy",
          documents: [
            {
              locale: "en",
              title: "Current title",
              version: "v2",
              body: "Current text",
            },
          ],
          acceptedAt: null,
          published: true,
        },
      ],
      more: true,
      rows: [
        {
          id: "history",
          slug: "tutee-policy",
          signature: "Student",
          acceptedAt: new Date("2026-09-01"),
          documents: [
            {
              locale: "en",
              title: "Earlier title",
              version: "v1",
              body: "Exact **earlier** words",
            },
          ],
        },
      ],
    },
  });
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <AcceptanceRecords userId="one" />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText("Current revision needs acceptance")).toBeTruthy();
  expect(
    screen.getByText("Earlier title · v1", { selector: "span" }),
  ).toBeTruthy();
  expect(container.querySelector("strong")?.textContent).toBe("earlier");
  expect(container.querySelector("pre")).toBeNull();
  expect(screen.queryByText("Current text")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(mocks.query).toHaveBeenLastCalledWith({ userId: "one", page: 1 });
});
it("renders history failures with a retry", () => {
  mocks.query.mockReturnValue({
    error: { message: "Unavailable" },
    refetch: mocks.refetch,
  });
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AcceptanceRecords userId="one" />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(mocks.refetch).toHaveBeenCalled();
});
