// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../messages/en.json";
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

it.each(["attendance", "audit"])(
  "renders the %s page from the actual observer projection",
  (page) => {
    render(
      <NextIntlClientProvider
        locale="en"
        messages={en}
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
      expect(screen.getByText("Tutee One")).toBeTruthy();
      expect(screen.getByText("1.0")).toBeTruthy();
    } else {
      expect(screen.getByText("Management decision")).toBeTruthy();
      expect(screen.getByRole("option", { name: /Staff One/ })).toBeTruthy();
    }
  },
);
