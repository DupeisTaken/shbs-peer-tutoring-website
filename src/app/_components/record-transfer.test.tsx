/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { RecordTransfer } from "./record-transfer";
const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  previewReset: vi.fn(),
  import: vi.fn(),
  importReset: vi.fn(),
  data: undefined as
    | undefined
    | {
        ticket: string;
        summary: { table: string; created: number; skipped: number }[];
      },
  error: null as null | { message: string },
  pending: false,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ invalidate: vi.fn() }),
    recordTransfer: {
      preview: {
        useMutation: () => ({
          mutate: mocks.preview,
          reset: mocks.previewReset,
          data: mocks.data,
          error: mocks.error,
          isPending: mocks.pending,
        }),
      },
      import: {
        useMutation: () => ({
          mutate: mocks.import,
          reset: mocks.importReset,
          data: undefined,
          error: null,
          isPending: false,
        }),
      },
      export: {
        useMutation: () => ({
          reset: vi.fn(),
          mutateAsync: vi.fn(),
          error: null,
          isPending: false,
        }),
      },
    },
  },
}));
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {children}
  </NextIntlClientProvider>
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.data = undefined;
  mocks.error = null;
  mocks.pending = false;
});

it("requires selected files, then sends file content for preview", async () => {
  render(<RecordTransfer />, { wrapper });
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Preview import",
  });
  expect(button.disabled).toBe(true);
  const file = new File(["id,englishName\np,Past Tutor"], "Tutor.csv");
  Object.defineProperty(file, "text", {
    value: async () => "id,englishName\np,Past Tutor",
  });
  fireEvent.change(screen.getByLabelText(/CSV files or a ZIP archive/), {
    target: { files: [file] },
  });
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  expect(mocks.preview).toHaveBeenCalledWith({
    files: [{ name: "Tutor.csv", text: "id,englishName\np,Past Tutor" }],
  });
});

it("requires explicit confirmation and clears authorization when files change", () => {
  mocks.data = {
    ticket: "ticket",
    summary: [{ table: "Tutor", created: 2, skipped: 1 }],
  };
  render(<RecordTransfer />, { wrapper });
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Import records",
  });
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(mocks.import).toHaveBeenCalledWith({ files: [], ticket: "ticket" });
  fireEvent.change(screen.getByLabelText(/CSV files or a ZIP archive/), {
    target: { files: [] },
  });
  expect(button.disabled).toBe(true);
  expect(mocks.previewReset).toHaveBeenCalled();
});

it("displays row errors and locks input while validation is pending", () => {
  mocks.error = { message: "Tutor.csv, row 2: unknown status." };
  mocks.pending = true;
  render(<RecordTransfer />, { wrapper });
  expect(screen.getByRole("alert").textContent).toContain("row 2");
  expect(
    screen.getByLabelText<HTMLInputElement>(/CSV files or a ZIP archive/)
      .disabled,
  ).toBe(true);
});
