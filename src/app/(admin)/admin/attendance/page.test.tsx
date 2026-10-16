/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en.json";
import AttendancePage from "./page";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";

const state = vi.hoisted(() => ({
  data: undefined as
    | undefined
    | {
        id: string;
        date: Date;
        tutor: { englishName: string };
        pairing: { subject: string };
        tutorStatus: string;
        tutees: [];
        shCount: number;
        mergeGroupId: null;
      }[],
  error: null as null | { message: string; data?: { code?: string } },
  refetch: vi.fn(),
  input: ((): unknown => undefined)(),
  tutorsLoaded: true,
  tutorIds: ["tutor"],
}));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (_procedure: unknown, input: unknown) =>
    input === undefined ? ["attendance-test"] : ["attendance-test", input],
}));
vi.mock("~/trpc/react", () => ({
  api: {
    admin: {
      tutors: {
        useQuery: () => ({
          data: state.tutorsLoaded
            ? state.tutorIds.map((id) => ({
                id,
                englishName: "Tutor name",
                status: "ACTIVE",
              }))
            : undefined,
          isSuccess: true,
          isFetching: false,
        }),
      },
      sessions: {
        useQuery: (input: unknown) => {
          state.input = input;
          return {
            data: state.data,
            error: state.error,
            isSuccess: state.data !== undefined && !state.error,
            isFetching: false,
            refetch: state.refetch,
          };
        },
      },
    },
  },
}));
vi.mock("~/app/_components/attendance-correction", () => ({
  AttendanceCorrection: () => (
    <input aria-label="Correction draft" defaultValue="Original" />
  ),
}));
vi.mock("~/app/_components/read-only", () => ({ useReadOnly: () => false }));
let queryClient: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SessionViewProvider
        identity="head"
        pathname="/admin/attendance"
        verified
      >
        {children}
      </SessionViewProvider>
    </NextIntlClientProvider>
  </QueryClientProvider>
);
beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  sessionStorage.clear();
  state.tutorsLoaded = true;
  state.tutorIds = ["tutor"];
  state.data = undefined;
  state.error = null;
  state.refetch.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(cleanup);
const row = {
  id: "session",
  date: new Date("2026-10-01"),
  tutor: { englishName: "Tutor name" },
  pairing: { subject: "Math" },
  tutorStatus: "PRESENT",
  tutees: [] as [],
  shCount: 1,
  mergeGroupId: null,
};

it("labels both filters and distinguishes initial error from loaded empty results", () => {
  state.error = { message: "Read failed" };
  const view = render(<AttendancePage />, { wrapper });
  expect(screen.getByLabelText("Month")).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Tutor" })).toBeTruthy();
  expect(screen.queryByText(messages.admin.submissions.empty)).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${messages.admin.submissions.title}`,
    }),
  );
  expect(state.refetch).toHaveBeenCalledOnce();
  state.error = null;
  state.data = [];
  view.rerender(<AttendancePage />);
  expect(screen.getByText(messages.admin.submissions.empty)).toBeTruthy();
});

it("keeps a correction draft mounted beside background read recovery", () => {
  state.data = [row];
  const view = render(<AttendancePage />, { wrapper });
  fireEvent.click(
    screen.getByRole("button", {
      name: `${messages.corrections.editAttendance}: Tutor name · Math`,
    }),
  );
  const draft = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Correction draft",
  });
  fireEvent.change(draft, { target: { value: "Unsaved correction" } });
  state.error = { message: "Background failure" };
  view.rerender(<AttendancePage />);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Correction draft" })
      .value,
  ).toBe("Unsaved correction");
  expect(screen.getByRole("alert").textContent).toContain(
    "Previously loaded content is still shown",
  );
});

it("evicts denied sessions and waits for successful permission recovery", () => {
  state.data = [row];
  const view = render(<AttendancePage />, { wrapper });
  queryClient.setQueryData(["attendance-test", state.input], state.data);
  state.error = { message: "Denied", data: { code: "FORBIDDEN" } };
  view.rerender(<AttendancePage />);
  expect(screen.queryByRole("table")).toBeNull();
  expect(
    queryClient.getQueryData(["attendance-test", state.input]),
  ).toBeUndefined();
  state.error = { message: "Network failure" };
  view.rerender(<AttendancePage />);
  expect(screen.queryByRole("table")).toBeNull();
  state.error = null;
  view.rerender(<AttendancePage />);
  expect(screen.getByRole("table")).toBeTruthy();
});

it("waits for tutor options then restores month/visibility and removes obsolete IDs", () => {
  const key = viewStateKey(
    "head",
    "/admin/attendance",
    "attendance-filters-v1",
    "",
  );
  const saved = { month: "2026-08", tutorId: "tutor", showPast: true };
  writeViewState(sessionStorage, key, saved);
  state.data = [];
  state.tutorsLoaded = false;
  const view = render(<AttendancePage />, { wrapper });
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(saved);
  state.tutorsLoaded = true;
  view.rerender(<AttendancePage />);
  expect(screen.getByLabelText<HTMLInputElement>("Month").value).toBe(
    "2026-08",
  );
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", { name: "Tutor" }).value,
  ).toBe("tutor");
  expect(
    screen.getByRole("button", { name: messages.pastTutors.hide }),
  ).toBeTruthy();
  state.tutorIds = [];
  view.rerender(<AttendancePage />);
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({
    ...saved,
    tutorId: "",
  });
});
it("clears saved filters and every cached month when attendance access is revoked", () => {
  const key = viewStateKey(
    "head",
    "/admin/attendance",
    "attendance-filters-v1",
    "",
  );
  writeViewState(sessionStorage, key, {
    month: "2026-08",
    tutorId: "tutor",
    showPast: false,
  });
  state.data = [row];
  const view = render(<AttendancePage />, { wrapper });
  queryClient.setQueryData(["attendance-test", { month: "2026-09" }], [row]);
  state.error = { message: "Denied", data: { code: "FORBIDDEN" } };
  view.rerender(<AttendancePage />);
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(
    queryClient.getQueryData(["attendance-test", { month: "2026-09" }]),
  ).toBeUndefined();
  expect(screen.queryByRole("table")).toBeNull();
  state.error = { message: "Transport error" };
  view.rerender(<AttendancePage />);
  expect(screen.queryByRole("table")).toBeNull();
});
