/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient } from "@tanstack/react-query";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import CardsPage from "./page";
import { ReadOnlyProvider } from "~/app/_components/read-only";

const state = vi.hoisted(() => ({
  pending: false,
  error: null as null | {
    message: string;
    data?: { approvalId?: string; code?: string };
  },
  reviewed: false,
  version: new Date("2026-09-01"),
  mutate: vi.fn(),
  invalidate: vi.fn(),
  reset: vi.fn(),
  fetch: vi.fn(),
  options: {} as { onSuccess: () => Promise<void>; onSettled: () => void },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: {
        disciplinaryCards: { invalidate: state.invalidate, fetch: state.fetch },
      },
    }),
    admin: {
      disciplinaryCards: {
        useQuery: () => ({
          data: [
            {
              id: "card",
              color: "YELLOW",
              source: "TUTOR",
              reason: "Observed reason",
              reviewStatus: state.reviewed ? "VALID" : "PENDING",
              reviewNote: null,
              createdAt: new Date("2026-09-01"),
              updatedAt: state.version,
              tutee: { id: "student", englishName: "Student Name" },
              issuedByTutor: null,
              session: null,
            },
          ],
        }),
      },
      reviewCard: {
        useMutation: (options: typeof state.options) => {
          state.options = options;
          return {
            isPending: state.pending,
            error: state.error,
            mutate: state.mutate,
            reset: state.reset,
          };
        },
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.pending = false;
  state.error = null;
  state.reviewed = false;
  state.version = new Date("2026-09-01");
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
const page = (locale: "en" | "zh" = "en", readOnly = false) => (
  <NextIntlClientProvider
    locale={locale}
    messages={locale === "en" ? en : zh}
    timeZone="Asia/Shanghai"
  >
    <ReadOnlyProvider value={readOnly}>
      <CardsPage />
    </ReadOnlyProvider>
  </NextIntlClientProvider>
);

it.each(["en", "zh"] as const)(
  "retains the %s review through pending, failure and queued approval",
  (locale) => {
    const messages = locale === "en" ? en : zh;
    const view = render(page(locale));
    const opener = screen.getByRole("button", {
      name: `${messages.tablePatterns.edit}: Student Name · ${messages.admin.cards.pendingReview}`,
    });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    const note = within(dialog).getByRole<HTMLInputElement>("textbox");
    fireEvent.change(note, { target: { value: "Keep this review draft" } });
    const valid = within(dialog).getByRole("button", {
      name: messages.admin.cards.valid,
    });
    fireEvent.click(valid);
    fireEvent.click(valid);
    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate).toHaveBeenLastCalledWith({
      id: "card",
      reviewStatus: "VALID",
      reviewNote: "Keep this review draft",
      expectedUpdatedAt: state.version,
    });
    state.pending = true;
    view.rerender(page(locale));
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(note.disabled).toBe(true);
    expect(
      within(dialog)
        .getByRole<HTMLButtonElement>("button", {
          name: messages.tablePatterns.close,
        })
        .matches(":disabled"),
    ).toBe(true);
    for (let i = 0; i < 3; i++) {
      expect(fireEvent.keyDown(dialog, { key: "Escape" })).toBe(false);
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
    }
    expect(screen.getByRole("dialog")).toBe(dialog);
    state.pending = false;
    state.error = { message: "Review failed" };
    state.options.onSettled();
    view.rerender(page(locale));
    expect(note.value).toBe("Keep this review draft");
    expect(within(dialog).getByRole("alert").textContent).toBe("Review failed");
    fireEvent.click(valid);
    expect(state.mutate).toHaveBeenCalledTimes(2);
    state.error = { message: "queued", data: { approvalId: "request" } };
    state.options.onSettled();
    view.rerender(page(locale));
    expect(within(dialog).getByRole("status").textContent).toBe(
      messages.approvals.queuedBody,
    );
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(note.value).toBe("Keep this review draft");
    expect(state.reviewed).toBe(false);
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(dialog.getAttribute("aria-busy")).toBe("false");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: messages.tablePatterns.close,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  },
);

it("applies a successful review only after the write and refresh complete", async () => {
  const view = render(page());
  fireEvent.click(screen.getByRole("button", { name: /^Edit:/ }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Valid",
    }),
  );
  await act(() => state.options.onSuccess());
  expect(state.invalidate).toHaveBeenCalledOnce();
  state.reviewed = true;
  state.options.onSettled();
  view.rerender(page());
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps the review version until an explicit successful reload", async () => {
  const view = render(page());
  fireEvent.click(screen.getByRole("button", { name: /^Edit:/ }));
  const original = state.version;
  state.version = new Date("2026-09-02");
  state.error = { message: "Conflict", data: { code: "CONFLICT" } };
  view.rerender(page());
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Valid",
    }),
  );
  expect(state.mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedUpdatedAt: original }),
  );
  state.options.onSettled();
  state.fetch.mockRejectedValueOnce(new Error("Reload failed"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: en.academics.reload }));
  });
  expect(state.reset).not.toHaveBeenCalled();
  expect(screen.getByText("Reload failed")).toBeTruthy();
  state.fetch.mockResolvedValue([
    { id: "card", updatedAt: state.version, reviewNote: "Reloaded note" },
  ]);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: en.academics.reload }));
  });
  expect(
    within(screen.getByRole("dialog")).getByRole<HTMLInputElement>("textbox")
      .value,
  ).toBe("Reloaded note");
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Valid",
    }),
  );
  expect(state.mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedUpdatedAt: state.version }),
  );
});

it("reloads the server version while the normal query cache is still fresh", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  const queryKey = ["disciplinaryCards"];
  const latestVersion = new Date("2026-09-02");
  client.setQueryData(queryKey, [
    { id: "card", updatedAt: state.version, reviewNote: "Cached note" },
  ]);
  const queryFn = vi.fn(async () => [
    { id: "card", updatedAt: latestVersion, reviewNote: "Server note" },
  ]);
  queryFn.mockRejectedValueOnce(new Error("Fresh read failed"));
  state.fetch.mockImplementation((_input, options: { staleTime?: number }) =>
    client.fetchQuery({ queryKey, queryFn, ...options }),
  );
  state.error = { message: "Conflict", data: { code: "CONFLICT" } };
  try {
    render(page());
    fireEvent.click(screen.getByRole("button", { name: /^Edit:/ }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Retained draft" },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: en.academics.reload }),
      );
    });
    expect(queryFn).toHaveBeenCalledOnce();
    expect(screen.getByText("Fresh read failed")).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
      "Retained draft",
    );
    expect(state.reset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Valid" }));
    expect(state.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedUpdatedAt: state.version }),
    );
    state.options.onSettled();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: en.academics.reload }),
      );
    });
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
      "Server note",
    );
    fireEvent.click(screen.getByRole("button", { name: "Valid" }));
    expect(state.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedUpdatedAt: latestVersion }),
    );
  } finally {
    client.clear();
    state.fetch.mockReset();
  }
});

it("keeps Viewer details read only", () => {
  render(page("en", true));
  fireEvent.click(
    screen.getByRole("button", {
      name: `${en.tablePatterns.details}: Student Name · ${en.admin.cards.pendingReview}`,
    }),
  );
  expect(within(screen.getByRole("dialog")).queryByRole("textbox")).toBeNull();
  expect(
    within(screen.getByRole("dialog")).queryByRole("button", {
      name: "Valid",
    }),
  ).toBeNull();
  expect(state.mutate).not.toHaveBeenCalled();
});

it("does not let an explicit reload read reset a concurrent review write", async () => {
  state.error = { message: "Conflict", data: { code: "CONFLICT" } };
  let release!: (rows: unknown[]) => void;
  state.fetch.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  render(page());
  fireEvent.click(screen.getByRole("button", { name: /^Edit:/ }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.academics.reload }),
  );
  expect(within(dialog).getByRole<HTMLInputElement>("textbox").disabled).toBe(
    true,
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Valid" }));
  expect(state.mutate).not.toHaveBeenCalled();
  // A cancellable read must not register as a pending write or latch dismissal.
  expect(dialog.getAttribute("aria-busy")).toBe("false");
  expect(
    within(dialog)
      .getByRole<HTMLButtonElement>("button", { name: en.tablePatterns.close })
      .matches(":disabled"),
  ).toBe(false);
  await act(async () => {
    release([
      { id: "card", updatedAt: state.version, reviewNote: "Read complete" },
    ]);
  });
  expect(within(dialog).getByRole<HTMLInputElement>("textbox").disabled).toBe(
    false,
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Valid" }));
  expect(state.mutate).toHaveBeenCalledOnce();
});

it("retains the actual table-detail discipline draft and original version after a failed write", () => {
  const inline = () => (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <ReadOnlyProvider value={false}>
        <CardsPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>
  );
  const view = render(inline());
  fireEvent.click(screen.getByRole("button", { name: /^Edit:/ }));
  const note = screen.getByRole<HTMLInputElement>("textbox");
  fireEvent.change(note, { target: { value: "Inline review draft" } });
  const originalVersion = state.version;
  fireEvent.click(screen.getByRole("button", { name: en.admin.cards.valid }));
  state.pending = true;
  view.rerender(inline());
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
  expect(note.disabled).toBe(true);
  state.pending = false;
  state.version = new Date("2026-09-02");
  state.error = { message: "Conflict", data: { code: "CONFLICT" } };
  state.options.onSettled();
  view.rerender(inline());
  expect(note.value).toBe("Inline review draft");
  fireEvent.click(screen.getByRole("button", { name: en.admin.cards.valid }));
  expect(state.mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      reviewNote: "Inline review draft",
      expectedUpdatedAt: originalVersion,
    }),
  );
});
