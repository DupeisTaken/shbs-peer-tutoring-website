// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { AccountUsernameEditor } from "./account-username-editor";
import { ProfileDialog } from "./profile-dialog";
const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: vi.fn(),
  refresh: vi.fn(),
  reset: vi.fn(),
  fetch: vi.fn(),
  conflict: false,
  pending: false,
  manual: false,
  options: {} as { onSuccess: () => Promise<void>; onSettled: () => void },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: {
        accounts: { invalidate: mocks.invalidate, fetch: mocks.fetch },
        tutors: { invalidate: mocks.invalidate },
      },
      account: { me: { invalidate: mocks.invalidate } },
    }),
    admin: {
      updateAccountUsername: {
        useMutation: (options: typeof mocks.options) => {
          mocks.options = options;
          return {
            mutate: (input: unknown) => {
              mocks.mutate(input);
              if (!mocks.manual) {
                if (!mocks.conflict)
                  void options.onSuccess().finally(options.onSettled);
                else options.onSettled();
              }
            },
            isPending: mocks.pending,
            reset: mocks.reset,
            error: mocks.conflict
              ? { message: "Profile changed", data: { code: "CONFLICT" } }
              : null,
          };
        },
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.conflict = false;
  mocks.pending = false;
  mocks.manual = false;
  mocks.fetch
    .mockReset()
    .mockResolvedValue({
      rows: [{ userId: "head", username: "latesthead", profileVersion: 5 }],
    });
  mocks.reset.mockReset();
});
afterEach(cleanup);

it("retains the username draft's original version when academic changes refresh props", async () => {
  const onSaved = vi.fn();
  const ui = (version: number) => (
    <NextIntlClientProvider locale="en" messages={en}>
      <AccountUsernameEditor
        userId="head"
        username="oldhead"
        profileVersion={version}
        onSaved={onSaved}
      />
    </NextIntlClientProvider>
  );
  const view = render(ui(3));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "drafthead" },
  });
  view.rerender(ui(4));
  fireEvent.click(screen.getByRole("button"));
  expect(mocks.mutate).toHaveBeenCalledWith({
    userId: "head",
    username: "drafthead",
    expectedProfileVersion: 3,
  });
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
});

it("explicitly reloads the username and matching version after a conflict", async () => {
  mocks.conflict = true;
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AccountUsernameEditor
        userId="head"
        username="oldhead"
        profileVersion={3}
        onSaved={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "unsaved" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.reloadUsername }),
  );
  await waitFor(() =>
    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
      "latesthead",
    ),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.saveUsername }),
  );
  expect(mocks.mutate).toHaveBeenCalledWith({
    userId: "head",
    username: "latesthead",
    expectedProfileVersion: 5,
  });
});
it.each(["en", "zh"])(
  "saves a username and refreshes cached lists and the server header in %s",
  async (locale) => {
    const onSaved = vi.fn();
    render(
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "en" ? en : zh}
      >
        <AccountUsernameEditor
          userId="head"
          username="oldhead"
          profileVersion={3}
          onSaved={onSaved}
        />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "NewHead" },
    });
    fireEvent.click(screen.getByRole("button"));
    expect(mocks.mutate).toHaveBeenCalledWith({
      userId: "head",
      username: "NewHead",
      expectedProfileVersion: 3,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.invalidate).toHaveBeenCalledTimes(3);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  },
);

const dialogEditor = (
  locale: "en" | "zh" = "en",
  parentPending = false,
  close = vi.fn(),
) => (
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>
    <ProfileDialog title="Account" onClose={close} pending={parentPending}>
      <AccountUsernameEditor
        userId="head"
        username="oldhead"
        profileVersion={3}
        onSaved={vi.fn()}
      />
    </ProfileDialog>
  </NextIntlClientProvider>
);

it.each(["en", "zh"] as const)(
  "excludes %s Reload and Save in both directions and keeps failed drafts",
  async (locale) => {
    mocks.conflict = true;
    mocks.manual = true;
    const labels = locale === "en" ? en : zh;
    let reject!: (error: Error) => void;
    mocks.fetch.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const close = vi.fn();
    const view = render(dialogEditor(locale, false, close));
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "drafthead" } });
    const reload = screen.getByRole("button", {
      name: labels.accountProfile.reloadUsername,
    });
    const form = input.closest("form")!;
    fireEvent.click(reload);
    fireEvent.click(reload);
    fireEvent.submit(form);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(input.matches(":disabled")).toBe(true);
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: labels.accountProfile.close,
      }).disabled,
    ).toBe(false);
    await act(async () => {
      reject(new Error("Read failed"));
    });
    expect(input.value).toBe("drafthead");
    expect(screen.getByText("Profile changed")).toBeTruthy();
    expect(screen.getByText("Read failed")).toBeTruthy();
    expect(mocks.reset).not.toHaveBeenCalled();
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.click(reload);
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(mocks.mutate).toHaveBeenLastCalledWith({
      userId: "head",
      username: "drafthead",
      expectedProfileVersion: 3,
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    mocks.pending = true;
    view.rerender(dialogEditor(locale, false, close));
    expect(input.matches(":disabled")).toBe(true);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(reload);
    fireEvent.submit(form);
    for (let i = 0; i < 3; i++) {
      fireEvent.keyDown(dialog, { key: "Escape" });
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
    }
    expect(close).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.mutate).toHaveBeenCalledOnce();
    mocks.pending = false;
    mocks.options.onSettled();
    view.rerender(dialogEditor(locale, false, close));
    expect(input.value).toBe("drafthead");
    expect(input.matches(":disabled")).toBe(false);
    // A successful read may contain many accounts; only this editor's account is adopted.
    mocks.fetch.mockResolvedValue({
      rows: [
        { userId: "other", username: "wronghead", profileVersion: 100 },
        { userId: "head", username: "righthead", profileVersion: 8 },
      ],
    });
    mocks.reset.mockImplementation(() => {
      mocks.conflict = false;
    });
    await act(async () => {
      fireEvent.click(reload);
    });
    expect(input.value).toBe("righthead");
    expect(screen.queryByText("Read failed")).toBeNull();
    expect(mocks.reset).toHaveBeenCalledOnce();
    fireEvent.submit(form);
    expect(mocks.mutate).toHaveBeenLastCalledWith({
      userId: "head",
      username: "righthead",
      expectedProfileVersion: 8,
    });
  },
);

it("does not adopt a different account returned by Reload", async () => {
  mocks.conflict = true;
  mocks.manual = true;
  mocks.fetch.mockResolvedValue({
    rows: [{ userId: "other", username: "wronghead", profileVersion: 99 }],
  });
  render(dialogEditor());
  const input = screen.getByRole<HTMLInputElement>("textbox");
  fireEvent.change(input, { target: { value: "retained" } });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.accountProfile.reloadUsername }),
    );
  });
  expect(input.value).toBe("retained");
  expect(mocks.reset).not.toHaveBeenCalled();
  fireEvent.submit(input.closest("form")!);
  expect(mocks.mutate).toHaveBeenLastCalledWith({
    userId: "head",
    username: "retained",
    expectedProfileVersion: 3,
  });
});

it("inherits sibling write protection without registering its read or latching busy", () => {
  mocks.conflict = true;
  mocks.manual = true;
  const view = render(dialogEditor("en", true));
  const input = screen.getByRole<HTMLInputElement>("textbox");
  fireEvent.submit(input.closest("form")!);
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.reloadUsername }),
  );
  expect(mocks.mutate).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(input.matches(":disabled")).toBe(true);
  view.rerender(dialogEditor("en", false));
  expect(input.matches(":disabled")).toBe(false);
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
  fireEvent.submit(input.closest("form")!);
  expect(mocks.mutate).toHaveBeenCalledOnce();
});

it("allows explicit dismissal during a delayed username reload read", async () => {
  mocks.conflict = true;
  let release!: (data: { rows: unknown[] }) => void;
  mocks.fetch.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const close = vi.fn();
  render(dialogEditor("en", false, close));
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.reloadUsername }),
  );
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(close).toHaveBeenCalledOnce();
  expect(mocks.mutate).not.toHaveBeenCalled();
  await act(async () => {
    release({ rows: [] });
  });
});
