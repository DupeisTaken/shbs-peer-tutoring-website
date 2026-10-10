/** @vitest-environment jsdom */
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { academicSummary } from "~/lib/academics";
import type { RouterOutputs } from "~/trpc/react";
import { ReadOnlyProvider } from "./read-only";
import { TuteeDetailsDialog } from "./tutee-details";

const mock = vi.hoisted(() => ({
  staff: vi.fn(),
  personal: vi.fn(),
  emailMounted: vi.fn(),
  verify: vi.fn(),
  copy: vi.fn(),
  pending: false,
  error: null as { message: string } | null,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    tuteeHistory: {
      details: { useQuery: mock.staff },
      myDetails: { useQuery: mock.personal },
    },
    admin: {
      sendAccountVerification: {
        useMutation: () => {
          mock.emailMounted();
          return {
            mutate: mock.verify,
            isPending: mock.pending,
            error: mock.error,
          };
        },
      },
    },
  },
}));
type Row = RouterOutputs["admin"]["tutees"][number];
// Distinct owner/current/roster addresses detect precedence regressions without
// relying on the server masking private fixture fields for observer tests.
function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "tutee",
    englishName: "Synthetic Learner",
    historical: false,
    status: "ACTIVE",
    gradeLevel: "10",
    academic: academicSummary(null),
    enrollmentPeriod: { schoolYear: "26-27", quarter: "Q1" },
    email: "roster@example.test",
    owner: null,
    user: {
      id: "current-user",
      username: "learner",
      email: "current@example.test",
      emailVerifiedAt: null,
    },
    firstChoice: {
      id: "math",
      name: "Advanced mathematics with a long subject label",
    },
    secondChoice: { id: "english", name: "English literature" },
    ...overrides,
  } as Row;
}
function Harness({
  record,
  readOnly = false,
  locale = "en",
}: {
  record: Row;
  readOnly?: boolean;
  locale?: "en" | "zh";
}) {
  const [open, setOpen] = useState(false);
  const messages = locale === "zh" ? zh : en;
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone="Asia/Shanghai"
    >
      <ReadOnlyProvider value={readOnly}>
        <button onClick={() => setOpen(true)}>
          {messages.tablePatterns.details}
        </button>
        {open && (
          <TuteeDetailsDialog row={record} onClose={() => setOpen(false)} />
        )}
      </ReadOnlyProvider>
    </NextIntlClientProvider>
  );
}
function open(locale: "en" | "zh" = "en") {
  const trigger = screen.getByRole("button", {
    name: (locale === "zh" ? zh : en).tablePatterns.details,
  });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.pending = false;
  mock.error = null;
  mock.copy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mock.copy },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  mock.staff.mockReturnValue({
    data: {
      record: {
        id: "tutee",
        name: "Original Learner",
        gradeLevel: "9",
        academicallyGraduated: false,
      },
      term: { name: "2025 Autumn" },
      owner: null,
      count: 51,
      sessions: [
        {
          status: "PRESENT",
          session: {
            id: "session",
            date: new Date("2025-10-01"),
            schoolYear: "25-26",
            quarter: "Q1",
            pairing: { subject: "Historical mathematics" },
            tutor: { englishName: "Historical Tutor" },
          },
        },
      ],
    },
  });
  mock.personal.mockReturnValue({ data: undefined });
});
afterEach(cleanup);

it.each(["en", "zh"] as const)(
  "opens one translated reader with subjects, email and history on demand (%s)",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    render(<Harness record={row()} locale={locale} />);
    expect(mock.staff).not.toHaveBeenCalled();
    expect(mock.emailMounted).not.toHaveBeenCalled();
    expect(screen.queryByText("current@example.test")).toBeNull();
    const trigger = open(locale);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const dialog = screen.getByRole("dialog", {
      name: messages.tuteeDetails.title,
    });
    expect(
      within(dialog).getByRole("heading", {
        name: messages.tuteeDetails.subjects,
      }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("heading", {
        name: messages.tuteeDetails.contact,
      }),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(
        "Advanced mathematics with a long subject label",
      ),
    ).toBeTruthy();
    expect(within(dialog).getByText("English literature")).toBeTruthy();
    expect(within(dialog).getByText("current@example.test")).toBeTruthy();
    expect(within(dialog).getByText("Historical Tutor")).toBeTruthy();
    expect(mock.staff).toHaveBeenCalledWith(
      { tuteeId: "tutee", page: 0 },
      { enabled: true, refetchOnMount: "always" },
    );
    expect(mock.personal).toHaveBeenCalledWith(
      { tuteeId: "tutee", page: 0 },
      { enabled: false, refetchOnMount: "always" },
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: messages.accountProfile.close,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  },
);

it.each(["en", "zh"] as const)(
  "withholds private sections and hooks from viewers even with unmasked data (%s)",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    render(<Harness record={row()} locale={locale} readOnly />);
    open(locale);
    expect(screen.getByText("English literature")).toBeTruthy();
    expect(screen.queryByText("current@example.test")).toBeNull();
    expect(screen.queryByText("roster@example.test")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: messages.tuteeDetails.contact }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: messages.tuteeHistory.details }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: messages.accountProfile.copyEmail }),
    ).toBeNull();
    expect(mock.staff).not.toHaveBeenCalled();
    expect(mock.personal).not.toHaveBeenCalled();
    expect(mock.emailMounted).not.toHaveBeenCalled();
  },
);

it.each(["en", "zh"] as const)(
  "keeps the sticky dialog title short while preserving a long participant name in its body (%s)",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    const name =
      "Alexandra Catherine Montgomery-Wellington · 亚历山德拉凯瑟琳蒙哥马利惠灵顿";
    render(<Harness record={row({ englishName: name })} locale={locale} />);
    open(locale);
    const dialog = screen.getByRole("dialog", {
      name: messages.tuteeDetails.title,
    });
    const title = within(dialog).getByRole("heading", { level: 2 });
    expect(title.textContent).toBe(messages.tuteeDetails.title);
    expect(title.textContent).not.toContain(name);
    expect(within(dialog).getByText(name)).toBeTruthy();
    expect(
      within(dialog).getByRole("button", {
        name: messages.accountProfile.close,
      }),
    ).toBeTruthy();
  },
);

it("uses the retained owner's contact address and does not offer historical setup", async () => {
  render(
    <Harness
      record={row({
        historical: true,
        user: null,
        owner: {
          id: "owner",
          username: "alumnus",
          email: "owner@example.test",
          emailVerifiedAt: null,
        } as Row["owner"],
      })}
    />,
  );
  open();
  expect(screen.getByText("owner@example.test")).toBeTruthy();
  expect(screen.queryByText("roster@example.test")).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.accountProfile.sendVerification }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.copyEmail }),
  );
  await waitFor(() =>
    expect(mock.copy).toHaveBeenCalledExactlyOnceWith("owner@example.test"),
  );
});

it("prefers owner over current-account contact and preserves the existing account target", () => {
  render(
    <Harness
      record={row({
        owner: {
          id: "owner",
          username: "owner",
          email: "owner@example.test",
          emailVerifiedAt: null,
        } as Row["owner"],
      })}
    />,
  );
  open();
  expect(screen.getByText("owner@example.test")).toBeTruthy();
  expect(screen.queryByText("current@example.test")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.sendVerification }),
  );
  expect(mock.verify).toHaveBeenCalledExactlyOnceWith({ userId: "owner" });
});

it("falls back to roster contact without granting setup and tolerates missing fields", () => {
  const view = render(
    <Harness
      record={row({
        user: null,
        owner: null,
        firstChoice: null,
        secondChoice: null,
      })}
    />,
  );
  open();
  expect(screen.getByText("roster@example.test")).toBeTruthy();
  expect(screen.getAllByText("—")).toHaveLength(2);
  expect(
    screen.queryByRole("button", { name: en.accountProfile.sendVerification }),
  ).toBeNull();
  view.rerender(
    <Harness
      record={row({
        email: null,
        user: null,
        owner: null,
        firstChoice: null,
        secondChoice: null,
      })}
    />,
  );
  expect(screen.getByText(en.accountProfile.noEmail)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.accountProfile.copyEmail }),
  ).toBeNull();
  expect(screen.getByText("Historical Tutor")).toBeTruthy();
});

it("blocks dismissal during verification, releases after failure and restores the exact opener", () => {
  const record = row();
  const view = render(<Harness record={record} />);
  const trigger = open();
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.sendVerification }),
  );
  expect(mock.verify).toHaveBeenCalledExactlyOnceWith({
    userId: "current-user",
  });
  mock.pending = true;
  view.rerender(<Harness record={record} />);
  const dialog = screen.getByRole("dialog");
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.accountProfile.close,
    }).disabled,
  ).toBe(true);
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  mock.pending = false;
  mock.error = { message: "Delivery failed; try again" };
  view.rerender(<Harness record={record} />);
  expect(screen.getByRole("alert").textContent).toBe(mock.error.message);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.accountProfile.close,
    }).disabled,
  ).toBe(false);
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("starts history at page one when switching records or reopening the reader", () => {
  const view = render(<Harness record={row()} />);
  open();
  fireEvent.click(screen.getByRole("button", { name: en.tuteeHistory.next }));
  expect(mock.staff).toHaveBeenLastCalledWith(
    { tuteeId: "tutee", page: 1 },
    expect.any(Object),
  );
  view.rerender(
    <Harness record={row({ id: "another", englishName: "Another Learner" })} />,
  );
  expect(mock.staff).toHaveBeenLastCalledWith(
    { tuteeId: "another", page: 0 },
    expect.any(Object),
  );
  fireEvent.click(screen.getByRole("button", { name: en.tuteeHistory.next }));
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.close }),
  );
  open();
  expect(mock.staff).toHaveBeenLastCalledWith(
    { tuteeId: "another", page: 0 },
    expect.any(Object),
  );
});

it("shows verified contact without offering setup and removes private content when access changes", () => {
  const record = row({
    user: {
      id: "verified-user",
      username: "verified",
      email: "verified@example.test",
      emailVerifiedAt: new Date("2026-09-01"),
    } as Row["user"],
  });
  const view = render(<Harness record={record} />);
  open();
  expect(screen.getByText(en.accountProfile.verified)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.accountProfile.sendVerification }),
  ).toBeNull();
  mock.staff.mockClear();
  mock.personal.mockClear();
  mock.emailMounted.mockClear();
  view.rerender(<Harness record={record} readOnly />);
  expect(screen.queryByText("verified@example.test")).toBeNull();
  expect(screen.queryByText("Historical Tutor")).toBeNull();
  expect(mock.staff).not.toHaveBeenCalled();
  expect(mock.personal).not.toHaveBeenCalled();
  expect(mock.emailMounted).not.toHaveBeenCalled();
  expect(screen.getByText("English literature")).toBeTruthy();
});
