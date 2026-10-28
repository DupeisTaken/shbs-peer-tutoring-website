/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../../messages/en.json";
import PoliciesPage from "../(admin)/admin/policies/page";

const state = vi.hoisted(() => ({
  role: "HEAD",
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
  refetch: vi.fn(),
  refresh: vi.fn<() => Promise<void>>(),
  error: null as null | { message: string; data?: { code?: string } },
  identityError: null as null | { message: string; data?: { code?: string } },
  saveError: null as null | { message: string; data?: { approvalId?: string } },
  pending: false,
  languages: [] as { code: string; label: string }[],
  archives: [] as {
    id: string;
    slug: string;
    locale: string;
    title: string;
    body: string;
    version: string;
    archivedAt: Date;
    archivedByName: null;
  }[],
  completion: undefined as undefined | (() => Promise<void>),
  remove: vi.fn(),
  confirm: vi.fn<() => Promise<boolean>>(),
  deleteCompletion: undefined as undefined | (() => Promise<void>),
}));
vi.mock("@trpc/react-query", () => ({ getQueryKey: () => ["policy-test"] }));
vi.mock("~/app/_components/read-only", () => ({
  useReadOnly: () => state.readOnly,
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ confirm: state.confirm, dialog: null }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    account: {
      me: {
        useQuery: () => ({
          data: { role: state.role },
          error: state.identityError,
        }),
      },
    },
    useUtils: () => ({
      admin: {
        policies: { invalidate: state.refresh },
        policyArchives: { invalidate: state.refresh },
      },
    }),
    admin: {
      policies: {
        useQuery: () => ({
          data: state.data,
          isSuccess: state.data !== undefined && !state.error,
          isFetching: false,
          isLoading: !state.data,
          error: state.error,
          refetch: state.refetch,
        }),
      },
      policyArchives: {
        useQuery: () => ({ data: state.archives, refetch: state.refetch }),
      },
      upsertPolicy: {
        useMutation: (options: {
          onSuccess: (
            result: unknown,
            input: { title: string; body: string; version: string | null },
          ) => Promise<void>;
        }) => ({
          mutate: (input: {
            title: string;
            body: string;
            version: string | null;
          }) => {
            state.save(input);
            state.completion = () => options.onSuccess({}, input);
          },
          isPending: state.pending,
          error: state.saveError,
        }),
      },
      deletePolicyLocale: {
        useMutation: (options: { onSuccess: () => Promise<void> }) => ({
          mutate: (input: unknown, callbacks: { onSuccess: () => void }) => {
            state.remove(input);
            state.deleteCompletion = async () => {
              await options.onSuccess();
              callbacks.onSuccess();
            };
          },
        }),
      },
    },
    // Bootstrap need not have stored language rows before the English editors work.
    i18n: {
      languages: {
        useQuery: () => ({ data: state.languages, refetch: state.refetch }),
      },
    },
  },
}));

let queryClient: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  </QueryClientProvider>
);
beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  state.role = "HEAD";
  state.identityError = null;
  state.data = [];
  state.readOnly = false;
  state.save.mockClear();
  state.refetch.mockClear();
  state.refresh.mockReset().mockResolvedValue(undefined);
  state.error = null;
  state.saveError = null;
  state.pending = false;
  state.languages = [];
  state.archives = [];
  state.completion = undefined;
  state.remove.mockReset();
  state.confirm.mockReset().mockResolvedValue(true);
  state.deleteCompletion = undefined;
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

it("creates both first policies through the existing save mutation without demo data", () => {
  render(<PoliciesPage />, { wrapper });
  expect(screen.getByRole("heading", { name: "Tutee Policy" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Tutor Policy" })).toBeTruthy();
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
  expect(screen.getByRole("heading", { name: "Tutor Policy" })).toBeTruthy();
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

it("offers Coordinator policy proposals while retaining unapplied drafts", () => {
  state.role = "COORDINATOR";
  render(<PoliciesPage />, { wrapper });
  expect(
    screen.queryByRole("button", { name: messages.admin.policies.editor.save }),
  ).toBeNull();
  fireEvent.change(screen.getAllByRole("textbox", { name: "Document title" })[0]!, { target: { value: "Proposed policy" } });
  fireEvent.change(screen.getAllByRole("textbox", { name: "Policy text (Markdown)" })[0]!, { target: { value: "Proposed policy body" } });
  fireEvent.click(screen.getAllByRole("button", { name: messages.approvals.requestAdmin })[0]!);
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ title: "Proposed policy", body: "Proposed policy body" }));
  expect(screen.getByDisplayValue("Proposed policy")).toBeTruthy();
  expect(state.refresh).not.toHaveBeenCalled();
});

const policy = (locale: string, title: string) => ({
  id: locale,
  slug: "tutee-policy",
  locale,
  title,
  body: `Saved ${locale} body`,
  version: "1",
  updatedAt: new Date(),
  updatedBy: null,
});

it("retains independent locale drafts through switching, failed saves and background reads", () => {
  state.data = [policy("en", "English policy"), policy("zh", "中文政策")];
  const view = render(<PoliciesPage />, { wrapper });
  const select = screen.getAllByRole("combobox", { name: "Language" })[0]!;
  const title = () =>
    screen.getAllByRole<HTMLInputElement>("textbox", {
      name: "Document title",
    })[0]!;
  fireEvent.change(title(), { target: { value: "Unsaved English title" } });
  fireEvent.change(select, { target: { value: "zh" } });
  fireEvent.change(title(), { target: { value: "未保存的中文标题" } });
  state.saveError = { message: "Synthetic save failed" };
  state.error = { message: "Synthetic background read failed" };
  state.data = [
    policy("en", "Background server title"),
    policy("zh", "新的服务器标题"),
  ];
  view.rerender(<PoliciesPage />);
  expect(title().value).toBe("未保存的中文标题");
  fireEvent.change(select, { target: { value: "en" } });
  expect(title().value).toBe("Unsaved English title");
  fireEvent.change(select, { target: { value: "zh" } });
  expect(title().value).toBe("未保存的中文标题");
  expect(state.save).not.toHaveBeenCalled();
});

it("gives filled fields persistent names and preserves their draft while a write is pending", () => {
  state.data = [policy("en", "English policy"), policy("zh", "中文政策")];
  const view = render(<PoliciesPage />, { wrapper });
  const title = screen.getAllByRole<HTMLInputElement>("textbox", {
    name: "Document title",
  })[0]!;
  fireEvent.change(title, { target: { value: "Pending draft" } });
  state.pending = true;
  view.rerender(<PoliciesPage />);
  expect(title.matches(":disabled")).toBe(true);
  expect(
    screen.getAllByRole("textbox", { name: "Version (optional)" }),
  ).toHaveLength(2);
  expect(
    screen.getAllByRole("textbox", { name: "Policy text (Markdown)" }),
  ).toHaveLength(2);
  const select = screen.getAllByRole("combobox", { name: "Language" })[0]!;
  fireEvent.change(select, { target: { value: "zh" } });
  fireEvent.change(select, { target: { value: "en" } });
  expect(
    screen.getAllByRole<HTMLInputElement>("textbox", {
      name: "Document title",
    })[0]!.value,
  ).toBe("Pending draft");
});

it("does not call an initial failed policy read empty and retries only that read", () => {
  state.data = undefined;
  state.error = { message: "Synthetic failure" };
  render(<PoliciesPage />, { wrapper });
  expect(screen.queryByText(messages.admin.policies.empty)).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry Policy Documents" }),
  );
  expect(state.refetch).toHaveBeenCalledOnce();
  expect(state.save).not.toHaveBeenCalled();
});

it("evicts denied policy contents and keeps them hidden through a subsequent network failure", () => {
  state.data = [policy("en", "Restricted policy")];
  queryClient.setQueryData(["policy-test"], state.data);
  state.error = { message: "Forbidden", data: { code: "FORBIDDEN" } };
  const view = render(<PoliciesPage />, { wrapper });
  expect(screen.queryByDisplayValue("Restricted policy")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain(
    "no longer have access",
  );
  expect(queryClient.getQueryData(["policy-test"])).toBeUndefined();
  state.error = { message: "Network failure" };
  view.rerender(<PoliciesPage />);
  expect(screen.queryByDisplayValue("Restricted policy")).toBeNull();
  state.error = null;
  view.rerender(<PoliciesPage />);
  expect(screen.getByDisplayValue("Restricted policy")).toBeTruthy();
});

it("retains seed-free drafts when identity refresh temporarily fails", () => {
  const view = render(<PoliciesPage />, { wrapper });
  const title = screen.getAllByRole<HTMLInputElement>("textbox", {
    name: "Document title",
  })[0]!;
  fireEvent.change(title, { target: { value: "First policy draft" } });
  state.identityError = { message: "Network failure" };
  view.rerender(<PoliciesPage />);
  expect(screen.getByDisplayValue("First policy draft")).toBe(title);
  expect(title.matches(":disabled")).toBe(true);
  state.identityError = null;
  view.rerender(<PoliciesPage />);
  expect(screen.getByDisplayValue("First policy draft")).toBe(title);
  expect(title.matches(":disabled")).toBe(false);
});

it("hides policy drafts after authoritative identity denial and keeps that denial through network recovery", () => {
  state.data = [policy("en", "Restricted policy")];
  const view = render(<PoliciesPage />, { wrapper });
  state.identityError = { message: "Denied", data: { code: "UNAUTHORIZED" } };
  view.rerender(<PoliciesPage />);
  expect(screen.queryByDisplayValue("Restricted policy")).toBeNull();
  state.identityError = { message: "Network failure" };
  view.rerender(<PoliciesPage />);
  expect(screen.queryByDisplayValue("Restricted policy")).toBeNull();
});

it("recovers an accepted locale removal without repeating Delete", async () => {
  state.data = [policy("en", "English policy"), policy("zh", "中文政策")];
  state.refresh.mockRejectedValue(new Error("Refresh failed"));
  render(<PoliciesPage />, { wrapper });
  fireEvent.change(screen.getAllByRole("combobox", { name: "Language" })[0]!, {
    target: { value: "zh" },
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.admin.policies.removeLanguage,
      }),
    );
  });
  expect(state.remove).toHaveBeenCalledExactlyOnceWith({
    slug: "tutee-policy",
    locale: "zh",
  });
  await act(async () => {
    await state.deleteCompletion?.();
  });
  expect(
    screen
      .getAllByRole("textbox", { name: "Document title" })[0]!
      .matches(":disabled"),
  ).toBe(true);
  state.refresh.mockResolvedValue(undefined);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
  });
  expect(state.remove).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("opens the exact archived locale in a named reader and returns focus after Escape", () => {
  state.data = [policy("en", "English policy"), policy("zh", "中文政策")];
  state.archives = [
    {
      id: "archive",
      slug: "tutee-policy",
      locale: "zh",
      title: "历史政策",
      body: "保留的历史原文",
      version: "old",
      archivedAt: new Date(),
      archivedByName: null,
    },
  ];
  render(<PoliciesPage />, { wrapper });
  fireEvent.change(screen.getAllByRole("combobox", { name: "Language" })[0]!, {
    target: { value: "zh" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Version History (1)" }));
  const opener = screen.getByRole("button", { name: "View" });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole("dialog", { name: "历史政策 · old" });
  expect(within(dialog).getByText("保留的历史原文")).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it("locks an accepted save after failed synchronization and recovers without another write", async () => {
  state.data = [policy("en", "English policy")];
  state.refresh.mockRejectedValue(new Error("Synthetic refresh failure"));
  render(<PoliciesPage />, { wrapper });
  fireEvent.change(
    screen.getAllByRole("textbox", { name: "Document title" })[0]!,
    { target: { value: "Saved revised policy" } },
  );
  const save = screen.getAllByRole("button", { name: "Save" })[0]!;
  fireEvent.click(save);
  fireEvent.click(save);
  expect(state.save).toHaveBeenCalledOnce();
  await act(async () => {
    await state.completion?.();
  });
  expect(save.matches(":disabled")).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain(
    "The policy was saved",
  );
  state.refresh.mockResolvedValue(undefined);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
  });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(state.save).toHaveBeenCalledOnce();
  fireEvent.change(
    screen.getAllByRole("textbox", { name: "Document title" })[0]!,
    { target: { value: "Second deliberate draft" } },
  );
  expect(save.matches(":disabled")).toBe(false);
});
