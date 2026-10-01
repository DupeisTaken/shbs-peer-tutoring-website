/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { CombineAccounts } from "./combine-accounts";
const fixture = vi.hoisted(() => ({
  fetch: vi.fn(),
  mutate: vi.fn(),
  refetch: vi.fn(),
  data: undefined as
    undefined | { id: string; name: string; email: string; role: string }[],
  error: null as Error | null,
  fetching: false,
  options: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      invalidate: vi.fn(),
      accountCombine: {
        preview: { fetch: fixture.fetch },
        candidates: { invalidate: vi.fn() },
      },
      admin: { accounts: { invalidate: vi.fn() } },
    }),
    accountCombine: {
      candidates: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => {
          fixture.options(options);
          return {
            data: fixture.data,
            error: fixture.error,
            isFetching: fixture.fetching,
            refetch: fixture.refetch,
          };
        },
      },
      combine: {
        useMutation: () => ({ mutate: fixture.mutate, isPending: false }),
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  fixture.data = [
    {
      id: "keep",
      name: "Sam Keep",
      email: "keep@example.test",
      role: "STUDENT",
    },
    {
      id: "retire",
      name: "Sam Duplicate",
      email: "retire@example.test",
      role: "STUDENT",
    },
  ];
  fixture.error = null;
  fixture.fetching = false;
  fixture.fetch.mockResolvedValue({
    survivor: { email: "keep@example.test", username: "keep" },
    duplicate: { email: "retire@example.test", username: "retire" },
    result: {
      role: "STUDENT",
      tutorId: null,
      studentId: "student-record",
      crewStatus: null,
      canTranslate: false,
    },
    counts: { messages: 2, policies: 1 },
    retiredEmails: ["retire@example.test"],
    conflicts: [],
    fingerprint: "reviewed-fingerprint",
  });
});
afterEach(cleanup);
function mount() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CombineAccounts />
    </NextIntlClientProvider>,
  );
}

it("loads candidates only after opening and disables selectors while initial data is unavailable", () => {
  fixture.data = undefined;
  mount();
  expect(fixture.options).toHaveBeenLastCalledWith({ enabled: false });
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Combine accounts" }));
  expect(fixture.options).toHaveBeenLastCalledWith({ enabled: true });
  expect(screen.getByRole("status").textContent).toBe(
    messages.combineAccounts.loading,
  );
  for (const select of screen.getAllByRole<HTMLSelectElement>("combobox"))
    expect(select.disabled).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Preview combine" })
      .disabled,
  ).toBe(true);
  expect(screen.queryByLabelText("Your Head account password")).toBeNull();
});

it("announces candidate failure without loading and offers a disabled-while-fetching retry", () => {
  fixture.error = new Error("Unavailable accounts");
  fixture.data = undefined;
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Combine accounts" }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain(
    "Unavailable accounts",
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.uiPatterns.retry }),
  );
  expect(fixture.refetch).toHaveBeenCalledOnce();
  fixture.fetching = true;
  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CombineAccounts />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.uiPatterns.retry,
    }).disabled,
  ).toBe(true);
});

it("distinguishes an empty candidate response from loading", () => {
  fixture.data = [];
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Combine accounts" }));
  expect(screen.getByRole("status").textContent).toBe(
    messages.combineAccounts.noCandidates,
  );
  expect(screen.queryByText(messages.combineAccounts.loading)).toBeNull();
  expect(screen.queryByLabelText("Your Head account password")).toBeNull();
});

it("retains selected identities through a cached candidate refetch failure", async () => {
  const view = mount();
  await selectAndPreview();
  fixture.error = new Error("Retry later");
  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CombineAccounts />
    </NextIntlClientProvider>,
  );
  expect(screen.getByLabelText<HTMLSelectElement>("Login to keep").value).toBe(
    "keep",
  );
  expect(
    screen.getByLabelText<HTMLSelectElement>("Duplicate login to retire").value,
  ).toBe("retire");
  expect(screen.getByText("Retained login")).toBeTruthy();
  expect(fixture.mutate).not.toHaveBeenCalled();
});
async function selectAndPreview() {
  fireEvent.click(screen.getByRole("button", { name: "Combine accounts" }));
  fireEvent.change(screen.getByLabelText("Login to keep"), {
    target: { value: "keep" },
  });
  fireEvent.change(screen.getByLabelText("Duplicate login to retire"), {
    target: { value: "retire" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview combine" }));
  await screen.findByText("Retained login");
}
it("requires preview, identity acknowledgement and Head password before confirmation", async () => {
  mount();
  await selectAndPreview();
  expect(
    screen
      .getByRole("button", { name: "Confirm and combine" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Your Head account password"), {
    target: { value: "my-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm and combine" }));
  expect(fixture.mutate).toHaveBeenCalledWith({
    survivorId: "keep",
    duplicateId: "retire",
    fingerprint: "reviewed-fingerprint",
    confirmPassword: "my-password",
  });
});
it("discards the preview and secret when selection changes", async () => {
  mount();
  await selectAndPreview();
  fireEvent.change(screen.getByLabelText("Your Head account password"), {
    target: { value: "secret" },
  });
  fireEvent.change(screen.getByLabelText("Duplicate login to retire"), {
    target: { value: "" },
  });
  expect(screen.queryByText("Retained login")).toBeNull();
  expect(screen.queryByLabelText("Your Head account password")).toBeNull();
  expect(fixture.mutate).not.toHaveBeenCalled();
});
it("renders blocking conflicts and never offers password confirmation", async () => {
  fixture.fetch.mockResolvedValueOnce({
    survivor: { email: "keep@example.test" },
    duplicate: { email: "retire@example.test" },
    result: { role: "STUDENT" },
    counts: {},
    retiredEmails: [],
    conflicts: ["Both accounts have different tutor profiles."],
    fingerprint: "blocked",
  });
  mount();
  await selectAndPreview();
  expect(screen.getByRole("alert").textContent).toContain(
    "different tutor profiles",
  );
  expect(
    screen.queryByRole("button", { name: "Confirm and combine" }),
  ).toBeNull();
});
it("shows preview failures without confirming or hiding the selection", async () => {
  fixture.fetch.mockRejectedValueOnce(new Error("Account details changed."));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Combine accounts" }));
  fireEvent.change(screen.getByLabelText("Login to keep"), {
    target: { value: "keep" },
  });
  fireEvent.change(screen.getByLabelText("Duplicate login to retire"), {
    target: { value: "retire" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview combine" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Account details changed",
    ),
  );
  expect(fixture.mutate).not.toHaveBeenCalled();
});
