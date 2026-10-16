/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en.json";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { emptyAuditView } from "~/app/_components/audit-filters";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";
import AuditPage from "./page";

const mocks = vi.hoisted(() => ({
  log: vi.fn(() => ({ data: [], isSuccess: true, isFetching: false })),
  mutate: vi.fn(),
  options: { users: [], operations: [], entities: [] },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ admin: { auditLog: { invalidate: vi.fn() } } }),
    admin: {
      auditLog: { useQuery: mocks.log },
      auditFilterOptions: {
        useQuery: () => ({
          data: mocks.options,
          isSuccess: true,
          isFetching: false,
        }),
      },
      undoAudit: {
        useMutation: () => ({ mutate: mocks.mutate, isPending: false }),
      },
    },
  },
}));
beforeEach(() => {
  sessionStorage.clear();
  mocks.log.mockClear();
  mocks.mutate.mockClear();
});
afterEach(cleanup);
const key = viewStateKey(
  "synthetic-head",
  "/admin/audit",
  "audit.filters.v1",
  JSON.stringify(["all", "Asia/Shanghai"]),
);
function mount() {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <SessionViewProvider
        identity="synthetic-head"
        pathname="/admin/audit"
        verified
      >
        <AuditPage />
      </SessionViewProvider>
    </NextIntlClientProvider>,
  );
}

// Exercise the real editor + page parser + query adapter, rather than proving
// only that the form emits an argument which its parent may silently reject.
it.each([161, 200])(
  "applies the existing valid %i-character audit search without reviving older saved criteria",
  (length) => {
    writeViewState(sessionStorage, key, {
      ...emptyAuditView,
      search: "old short",
    });
    const rendered = mount();
    const input = screen.getByLabelText<HTMLInputElement>("Search History");
    expect(input.maxLength).toBe(200);
    expect(input.value).toBe("old short");
    const search = "x".repeat(length);
    fireEvent.change(input, { target: { value: search } });
    expect(mocks.log).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "old short" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
    expect(mocks.log).toHaveBeenLastCalledWith(
      expect.objectContaining({ search }),
    );
    expect(input.value).toBe(search);
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
    rendered.unmount();
    mount();
    expect(
      screen.getByLabelText<HTMLInputElement>("Search History").value,
    ).toBe("");
    expect(mocks.log).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined }),
    );
  },
);
