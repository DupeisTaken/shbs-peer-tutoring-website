/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import PoliciesPage from "../(admin)/admin/policies/page";

const state = vi.hoisted(() => ({
  data: undefined as
    | undefined
    | Array<{
        id: string;
        slug: string;
        locale: string;
        title: string;
        body: string;
        version: string;
        updatedAt: Date;
        updatedBy: null;
      }>,
  readOnly: false,
  save: vi.fn(),
}));
vi.mock("~/app/_components/read-only", () => ({
  useReadOnly: () => state.readOnly,
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ confirm: vi.fn(), dialog: null }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: {
        policies: { invalidate: vi.fn() },
        policyArchives: { invalidate: vi.fn() },
      },
    }),
    admin: {
      policies: {
        useQuery: () => ({ data: state.data, isLoading: !state.data }),
      },
      policyArchives: { useQuery: () => ({ data: [] }) },
      upsertPolicy: { useMutation: () => ({ mutate: state.save }) },
      deletePolicyLocale: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    // Bootstrap need not have stored language rows before the English editors work.
    i18n: { languages: { useQuery: () => ({ data: [] }) } },
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
    {children}
  </NextIntlClientProvider>
);
beforeEach(() => {
  state.data = [];
  state.readOnly = false;
  state.save.mockClear();
});
afterEach(cleanup);

it("creates both first policies through the existing save mutation without demo data", () => {
  render(<PoliciesPage />, { wrapper });
  expect(screen.getByRole("heading", { name: "Tutee policy" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Tutor policy" })).toBeTruthy();
  expect(
    screen
      .getAllByRole("combobox")
      .map((select) => (select as HTMLSelectElement).value),
  ).toEqual(["en", "en"]);
  for (const [index, slug] of ["tutee-policy", "tutor-policy"].entries()) {
    fireEvent.change(
      screen.getAllByPlaceholderText(
        messages.admin.policies.editor.titlePlaceholder,
      )[index]!,
      { target: { value: `${slug} reviewed` } },
    );
    fireEvent.change(
      screen.getAllByPlaceholderText(
        messages.admin.policies.editor.bodyPlaceholder,
      )[index]!,
      { target: { value: "# Reviewed school content" } },
    );
    fireEvent.click(
      screen.getAllByRole("button", {
        name: messages.admin.policies.editor.save,
      })[index]!,
    );
    expect(state.save).toHaveBeenLastCalledWith({
      slug,
      locale: "en",
      title: `${slug} reviewed`,
      version: null,
      body: "# Reviewed school content",
    });
  }
});

it("waits for loaded content and still offers the other missing policy", () => {
  state.data = undefined;
  const view = render(<PoliciesPage />, { wrapper });
  expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  state.data = [
    {
      id: "existing",
      slug: "tutee-policy",
      locale: "en",
      title: "Existing reviewed student policy",
      body: "Preserve existing content",
      version: "1",
      updatedAt: new Date(),
      updatedBy: null,
    },
  ];
  view.rerender(<PoliciesPage />);
  expect(screen.getByDisplayValue("Preserve existing content")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Tutor policy" })).toBeTruthy();
  expect(state.save).not.toHaveBeenCalled();
});

it("does not offer policy creation to a read-only viewer", () => {
  state.readOnly = true;
  render(<PoliciesPage />, { wrapper });
  expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.getByText(messages.admin.policies.empty)).toBeTruthy();
});

it("keeps a saved translation visible when the English fallback is still missing", () => {
  state.data = [
    {
      id: "zh-only",
      slug: "tutee-policy",
      locale: "zh",
      title: "学生政策",
      body: "保留已有中文内容",
      version: "1",
      updatedAt: new Date(),
      updatedBy: null,
    },
  ];
  render(<PoliciesPage />, { wrapper });
  expect(screen.getByDisplayValue("保留已有中文内容")).toBeTruthy();
  expect(
    screen
      .getAllByRole("combobox")
      .map((select) => (select as HTMLSelectElement).value),
  ).toEqual(["zh", "en"]);
  expect(state.save).not.toHaveBeenCalled();
});
