/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { AuditFilters } from "./audit-filters";

vi.mock("~/trpc/react", () => ({
  api: {
    admin: {
      auditFilterOptions: {
        useQuery: () => ({ data: { users: [], operations: [], entities: [] } }),
      },
    },
  },
}));
afterEach(cleanup);

it("shows both offsets across a DST range while submitting the same program-day bounds", () => {
  const apply = vi.fn();
  render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="America/New_York"
    >
      <AuditFilters onApply={apply} />
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByLabelText(messages.auditFilters.from), {
    target: { value: "2026-03-07" },
  });
  fireEvent.change(screen.getByLabelText(messages.auditFilters.until), {
    target: { value: "2026-03-09" },
  });
  const label = screen.getByText(/Date filters and event times use/);
  expect(label.textContent).toContain("EST (GMT-05:00)");
  expect(label.textContent).toContain("EDT (GMT-04:00)");
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: messages.auditFilters.apply }),
  );
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({
      from: new Date("2026-03-07T05:00:00Z"),
      until: new Date("2026-03-10T04:00:00Z"),
    }),
  );
});
