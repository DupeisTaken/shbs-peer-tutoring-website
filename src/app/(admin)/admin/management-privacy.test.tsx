// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import { projectManagementRead } from "~/server/management-read-models";
import { auditRow, sessionRow, PRIVATE } from "~/test/management-read-fixtures";
import AttendancePage from "./attendance/page";
import AuditPage from "./audit/page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ admin: { auditLog: { invalidate: vi.fn() } } }),
    admin: {
      tutors: { useQuery: () => ({ data: [] }) },
      sessions: {
        useQuery: () => ({
          data: projectManagementRead("admin.sessions", [sessionRow]),
        }),
      },
      auditLog: {
        useQuery: () => ({
          data: projectManagementRead("admin.auditLog", [auditRow]),
        }),
      },
      auditFilterOptions: {
        useQuery: () => ({
          data: projectManagementRead("admin.auditFilterOptions", {
            users: [
              {
                id: "staff",
                label: "Staff One",
                username: "staff",
                former: false,
              },
            ],
            operations: ["student.decideAppeal"],
            entities: ["StudentAppeal"],
          }),
        }),
      },
      undoAudit: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));
afterEach(cleanup);

it.each([
  { page: "attendance", locale: "en", messages: en },
  { page: "attendance", locale: "zh", messages: zh },
  { page: "audit", locale: "en", messages: en },
  { page: "audit", locale: "zh", messages: zh },
])(
  "renders the $page summary and detail from the observer projection in $locale",
  ({ page, locale, messages }) => {
    render(
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="Asia/Shanghai"
      >
        <ReadOnlyProvider value={true}>
          {page === "attendance" ? <AttendancePage /> : <AuditPage />}
        </ReadOnlyProvider>
      </NextIntlClientProvider>,
    );
    expect(document.body.textContent).not.toContain(PRIVATE);
    if (page === "attendance") {
      expect(screen.getByText("Tutor One")).toBeTruthy();
      expect(screen.queryByText("Tutee One")).toBeNull();
      expect(screen.getByText("1.0")).toBeTruthy();
    } else {
      expect(screen.getByText("Management decision")).toBeTruthy();
      expect(screen.getByRole("option", { name: /Staff One/ })).toBeTruthy();
    }

    // The rollout moves permitted detail out of summary cells. Exercise that
    // lazy boundary with the real server projection, including masked nulls.
    const rowActions = within(document.querySelector("tbody")!);
    const detail = rowActions.getByRole("button");
    expect(detail.textContent).toBe(messages.tablePatterns.details);
    detail.focus();
    fireEvent.click(detail);
    const dialog = screen.getByRole("dialog");
    expect(document.body.textContent).not.toContain(PRIVATE);
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);
    if (page === "attendance") {
      expect(within(dialog).getByText("Tutee One")).toBeTruthy();
      expect(
        screen.queryByRole("button", {
          name: new RegExp(messages.corrections.editAttendance),
        }),
      ).toBeNull();
    } else {
      expect(within(dialog).getByText("Management decision")).toBeTruthy();
      expect(dialog.querySelector("pre")).toBeNull();
      expect(rowActions.queryByRole("link")).toBeNull();
    }
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: messages.tablePatterns.close,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(detail);
  },
);
