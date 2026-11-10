/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { createQueryClient } from "~/trpc/query-client";
import { api } from "~/trpc/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";

const state = vi.hoisted(() => ({
  client: null as QueryClient | null,
  cachedAccount: true,
  cachedFeatures: true,
  account: { twoFactorEnabled: true },
  features: { EMAIL_2FA: true, EMAIL_DELIVERY_AVAILABLE: true },
  readAccount: vi.fn<() => Promise<{ twoFactorEnabled: boolean }>>(),
  readFeatures: vi.fn<
    () => Promise<{
      EMAIL_2FA: boolean;
      EMAIL_DELIVERY_AVAILABLE: boolean;
    }>
  >(),
  write:
    vi.fn<
      (input: {
        enabled: boolean;
        currentPassword: string;
      }) => Promise<{ ok: true; enabled: boolean }>
    >(),
}));
vi.mock("~/trpc/react", async () => {
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  return {
    api: {
      account: {
        me: {
          _def: () => ({ path: ["account", "me"] }),
          useQuery: () =>
            useQuery({
              queryKey: queryKey("two-factor-account"),
              queryFn: state.readAccount,
              initialData: state.cachedAccount ? state.account : undefined,
              staleTime: Infinity,
              retry: false,
            }),
        },
        setTwoFactorEnabled: {
          useMutation: (options: {
            onSuccess: () => Promise<void>;
            onSettled: () => void;
          }) => useMutation({ mutationFn: state.write, ...options }),
        },
      },
      program: {
        features: {
          _def: () => ({ path: ["program", "features"] }),
          useQuery: () =>
            useQuery({
              queryKey: queryKey("two-factor-program"),
              queryFn: state.readFeatures,
              initialData: state.cachedFeatures ? state.features : undefined,
              staleTime: Infinity,
              retry: false,
            }),
        },
      },
    },
  };
});
import { TwoFactorSettings } from "./two-factor-settings";

const queryKey = (key: "two-factor-account" | "two-factor-program") =>
  key === "two-factor-account"
    ? getQueryKey(api.account.me, undefined, "query")
    : getQueryKey(api.program.features, undefined, "query");
const labels = en.auth.twoFactor.settings;
const password = "SyntheticPassword239!";
function ui(locale = "en", messages = en) {
  return (
    <QueryClientProvider client={state.client!}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        <TwoFactorSettings />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
function input(label = labels.currentPassword) {
  return screen.getByLabelText<HTMLInputElement>(label);
}
function draft(label = labels.currentPassword) {
  fireEvent.change(input(label), { target: { value: password } });
}
function submit(label = labels.currentPassword) {
  fireEvent.submit(input(label).closest("form")!);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function denial() {
  return Object.assign(new Error("Synthetic access revoked"), {
    data: { code: "FORBIDDEN" },
  });
}
async function refresh(key: "two-factor-account" | "two-factor-program") {
  await act(async () => {
    await state.client!.invalidateQueries({ queryKey: queryKey(key) });
  });
}

beforeEach(() => {
  state.client = createQueryClient();
  const defaults = state.client.getDefaultOptions();
  state.client.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, retry: false },
    mutations: { ...defaults.mutations, retry: false },
  });
  state.cachedAccount = true;
  state.cachedFeatures = true;
  state.account = { twoFactorEnabled: true };
  state.features = { EMAIL_2FA: true, EMAIL_DELIVERY_AVAILABLE: true };
  state.readAccount.mockReset().mockImplementation(async () => state.account);
  state.readFeatures.mockReset().mockImplementation(async () => state.features);
  state.write.mockReset().mockImplementation(async ({ enabled }) => {
    state.account = { twoFactorEnabled: enabled };
    return { ok: true, enabled };
  });
});
afterEach(() => {
  cleanup();
  state.client?.clear();
});

it.each(["account", "program"] as const)(
  "does not infer disabled settings during initial %s loading",
  async (query) => {
    state.cachedAccount = query !== "account";
    state.cachedFeatures = query !== "program";
    const accountPending = deferred<typeof state.account>();
    const programPending = deferred<typeof state.features>();
    if (query === "account")
      state.readAccount.mockReturnValue(accountPending.promise);
    else state.readFeatures.mockReturnValue(programPending.promise);
    render(ui());
    expect(screen.getByText(labels.loading)).toBeTruthy();
    expect(screen.queryByText(labels.disabled)).toBeNull();
    expect(screen.queryByText(labels.featureOff)).toBeNull();
    if (query === "account")
      expect(screen.queryByText(labels.enabled)).toBeNull();
    expect(screen.queryByLabelText(labels.currentPassword)).toBeNull();
    await act(async () => {
      accountPending.resolve(state.account);
      programPending.resolve(state.features);
    });
    await screen.findByLabelText(labels.currentPassword);
  },
);

it.each(["account", "program"] as const)(
  "distinguishes a failed initial %s read from known disabled settings and retries reads only",
  async (query) => {
    state.account = { twoFactorEnabled: false };
    if (query === "account") {
      state.cachedAccount = false;
      state.readAccount.mockRejectedValue(
        new Error("Synthetic account unavailable"),
      );
    } else {
      state.cachedFeatures = false;
      state.readFeatures.mockRejectedValue(
        new Error("Synthetic program unavailable"),
      );
    }
    render(ui());
    await screen.findByText(labels.loadFailed);
    expect(screen.getByRole("alert")).toBeTruthy();
    if (query === "account")
      expect(screen.queryByText(labels.disabled)).toBeNull();
    expect(screen.queryByText(labels.featureOff)).toBeNull();
    expect(screen.queryByRole("button", { name: labels.enable })).toBeNull();
    state.readAccount.mockResolvedValue(state.account);
    state.readFeatures.mockResolvedValue(state.features);
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
    await waitFor(() =>
      expect(screen.queryByText(labels.loadFailed)).toBeNull(),
    );
    expect(screen.getByText(labels.disabled)).toBeTruthy();
    expect(state.write).not.toHaveBeenCalled();
  },
);

it.each(["two-factor-account", "two-factor-program"] as const)(
  "retains the draft but fences submits during a cached %s refresh",
  async (key) => {
    const accountPending = deferred<typeof state.account>();
    const featuresPending = deferred<typeof state.features>();
    render(ui());
    draft();
    if (key === "two-factor-account")
      state.readAccount.mockReturnValue(accountPending.promise);
    else state.readFeatures.mockReturnValue(featuresPending.promise);
    let pendingRefresh!: Promise<void>;
    await act(async () => {
      pendingRefresh = state.client!.invalidateQueries({
        queryKey: queryKey(key),
      });
    });
    await screen.findByText(labels.refreshing);
    expect(input().value).toBe(password);
    expect(input().disabled).toBe(true);
    submit();
    expect(state.write).not.toHaveBeenCalled();
    await act(async () => {
      accountPending.resolve(state.account);
      featuresPending.resolve(state.features);
      await pendingRefresh;
    });
    await waitFor(() => expect(input().disabled).toBe(false));
    expect(input().value).toBe(password);
  },
);

it.each(["two-factor-account", "two-factor-program"] as const)(
  "reports a failed cached %s read, fences writes, and retains the draft through recovery",
  async (key) => {
    if (key === "two-factor-program")
      state.account = { twoFactorEnabled: false };
    render(ui());
    draft();
    if (key === "two-factor-account")
      state.readAccount.mockRejectedValue(
        new Error("Synthetic account refresh failed"),
      );
    else
      state.readFeatures.mockRejectedValue(
        new Error("Synthetic program refresh failed"),
      );
    await refresh(key);
    await screen.findByText(labels.refreshFailed);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(input().value).toBe(password);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: state.account.twoFactorEnabled ? labels.disable : labels.enable,
      }).disabled,
    ).toBe(true);
    submit();
    expect(state.write).not.toHaveBeenCalled();
    state.readAccount.mockResolvedValue(state.account);
    state.readFeatures.mockResolvedValue(state.features);
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
    await waitFor(() => expect(input().disabled).toBe(false));
    expect(input().value).toBe(password);
    expect(state.write).not.toHaveBeenCalled();
  },
);

it.each([
  { program: false, delivery: true, explanation: "featureOff" as const },
  { program: true, delivery: false, explanation: "unavailable" as const },
])(
  "retains known disabled explanations for $explanation",
  ({ program, delivery, explanation }) => {
    state.account = { twoFactorEnabled: false };
    state.features = { EMAIL_2FA: program, EMAIL_DELIVERY_AVAILABLE: delivery };
    render(ui());
    expect(screen.getByText(labels.disabled)).toBeTruthy();
    expect(screen.getByText(labels[explanation])).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByLabelText(labels.currentPassword)).toBeNull();
  },
);

it.each([
  { program: false, delivery: true },
  { program: true, delivery: false },
])(
  "allows a password-confirmed disable with known program=$program delivery=$delivery",
  async ({ program, delivery }) => {
    state.features = { EMAIL_2FA: program, EMAIL_DELIVERY_AVAILABLE: delivery };
    render(ui());
    draft();
    submit();
    await screen.findByText(labels.saved);
    expect(state.write).toHaveBeenCalledExactlyOnceWith(
      { enabled: false, currentPassword: password },
      expect.anything(),
    );
    // The saved receipt remains visible when the disabled/program-off form disappears.
    expect(screen.getByText(labels.disabled)).toBeTruthy();
    expect(screen.queryByLabelText(labels.currentPassword)).toBeNull();
  },
);

it("admits one same-turn submission and freezes its pending password", async () => {
  const pending = deferred<{ ok: true; enabled: boolean }>();
  state.write.mockReturnValue(pending.promise);
  render(ui());
  draft();
  const form = input().closest("form")!;
  act(() => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await waitFor(() => expect(state.write).toHaveBeenCalledOnce());
  expect(input().disabled).toBe(true);
  expect(input().value).toBe(password);
  await act(async () => {
    state.account = { twoFactorEnabled: false };
    pending.resolve({ ok: true, enabled: false });
  });
  await screen.findByText(labels.saved);
});

it.each([
  { locale: "en", messages: en },
  { locale: "zh", messages: zh },
])(
  "retains a rejected password confirmation and clears it only after an accepted update ($locale)",
  async ({ locale, messages }) => {
    const text = messages.auth.twoFactor.settings;
    const failure =
      "Too many password confirmations. Wait fifteen minutes before trying again.";
    state.write.mockRejectedValueOnce(new Error(failure));
    render(ui(locale, messages));
    draft(text.currentPassword);
    input(text.currentPassword).focus();
    submit(text.currentPassword);
    await screen.findByText(failure);
    expect(input(text.currentPassword).value).toBe(password);
    expect(input(text.currentPassword).disabled).toBe(false);
    expect(document.activeElement).toBe(input(text.currentPassword));
    expect(state.readAccount).not.toHaveBeenCalled();
    expect(state.readFeatures).not.toHaveBeenCalled();
    submit(text.currentPassword);
    await screen.findByText(text.saved);
    await waitFor(() =>
      expect(input(text.currentPassword).disabled).toBe(false),
    );
    expect(input(text.currentPassword).value).toBe("");
    expect(state.write).toHaveBeenCalledTimes(2);
    expect(state.readAccount).toHaveBeenCalledOnce();
    expect(state.readFeatures).toHaveBeenCalledOnce();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: text.enable })
        .disabled,
    ).toBe(true);
  },
);

it("reserves accepted-write synchronization when a background read fails during a pending write", async () => {
  const pendingWrite = deferred<{ ok: true; enabled: boolean }>();
  const postWriteRead = deferred<typeof state.account>();
  state.write.mockReturnValue(pendingWrite.promise);
  render(ui());
  draft();
  submit();
  await waitFor(() => expect(state.write).toHaveBeenCalledOnce());
  state.readAccount.mockRejectedValue(
    new Error("Synthetic background failure"),
  );
  await refresh("two-factor-account");
  await screen.findByText(labels.refreshFailed);
  const retry = screen.getByRole<HTMLButtonElement>("button", {
    name: en.uiPatterns.retry,
  });
  expect(retry.disabled).toBe(true);
  state.readAccount.mockReturnValue(postWriteRead.promise);
  fireEvent.click(retry);
  expect(state.readAccount).toHaveBeenCalledOnce();

  await act(async () => {
    state.account = { twoFactorEnabled: false };
    pendingWrite.resolve({ ok: true, enabled: false });
  });
  await waitFor(() => expect(state.readAccount).toHaveBeenCalledTimes(2));
  expect(input().disabled).toBe(true);
  await act(async () => {
    postWriteRead.resolve(state.account);
  });
  await waitFor(() => expect(input().disabled).toBe(false));
  expect(screen.getByText(labels.saved)).toBeTruthy();
  expect(screen.getByText(labels.disabled)).toBeTruthy();
  expect(state.write).toHaveBeenCalledOnce();
});

it("keeps an accepted update fenced after synchronization fails and retries reads only", async () => {
  state.readAccount.mockRejectedValue(
    new Error("Synthetic synchronization failure"),
  );
  render(ui());
  draft();
  submit();
  await screen.findByText(labels.savedRefreshFailed);
  expect(screen.getByText(labels.saved)).toBeTruthy();
  expect(input().value).toBe("");
  expect(input().disabled).toBe(true);
  submit();
  expect(state.write).toHaveBeenCalledOnce();

  const programPending = deferred<typeof state.features>();
  state.readAccount.mockResolvedValue(state.account);
  state.readFeatures.mockReturnValue(programPending.promise);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await waitFor(() => expect(state.readAccount).toHaveBeenCalledTimes(2));
  expect(input().disabled).toBe(true);
  expect(screen.getByText(labels.savedRefreshFailed)).toBeTruthy();
  await act(async () => {
    programPending.resolve(state.features);
  });
  await waitFor(() =>
    expect(screen.queryByText(labels.savedRefreshFailed)).toBeNull(),
  );
  expect(input().disabled).toBe(false);
  expect(screen.getByText(labels.disabled)).toBeTruthy();
  expect(state.write).toHaveBeenCalledOnce();
});

it.each(["two-factor-account", "two-factor-program"] as const)(
  "conceals denied cached %s data through transport failure until fresh authorization",
  async (key) => {
    render(ui());
    draft();
    if (key === "two-factor-account")
      state.readAccount.mockRejectedValue(denial());
    else state.readFeatures.mockRejectedValue(denial());
    await refresh(key);
    await screen.findByText(labels.accessDenied);
    expect(screen.queryByText(labels.enabled)).toBeNull();
    expect(screen.queryByLabelText(labels.currentPassword)).toBeNull();

    if (key === "two-factor-account")
      state.readAccount.mockRejectedValue(
        new Error("Synthetic transport failure"),
      );
    else
      state.readFeatures.mockRejectedValue(
        new Error("Synthetic transport failure"),
      );
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: en.uiPatterns.retry,
        }).disabled,
      ).toBe(false),
    );
    expect(screen.getByText(labels.accessDenied)).toBeTruthy();
    expect(screen.queryByText(labels.enabled)).toBeNull();
    expect(screen.queryByLabelText(labels.currentPassword)).toBeNull();
    state.readAccount.mockResolvedValue(state.account);
    state.readFeatures.mockResolvedValue(state.features);
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
    await waitFor(() =>
      expect(screen.queryByText(labels.accessDenied)).toBeNull(),
    );
    expect(input().value).toBe(password);
    expect(state.write).not.toHaveBeenCalled();
  },
);

it("requires fresh read authorization after a denied write before revealing the retained form", async () => {
  state.write.mockRejectedValueOnce(denial());
  render(ui());
  draft();
  submit();
  await screen.findByText(labels.accessDenied);
  expect(screen.queryByLabelText(labels.currentPassword)).toBeNull();
  state.readAccount.mockRejectedValueOnce(
    new Error("Synthetic transport failure"),
  );
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.uiPatterns.retry,
      }).disabled,
    ).toBe(false),
  );
  expect(screen.getByText(labels.accessDenied)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await waitFor(() =>
    expect(screen.queryByText(labels.accessDenied)).toBeNull(),
  );
  expect(input().value).toBe(password);
  expect(state.write).toHaveBeenCalledOnce();
});
