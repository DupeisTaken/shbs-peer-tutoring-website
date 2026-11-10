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

const state = vi.hoisted(() => ({
  settings: {
    email: "primary@example.test",
    deliveryAvailable: true,
    secondaryEmailBindingEnabled: false,
  },
  initial: true,
  read: vi.fn(),
  request: vi.fn(),
  confirm: vi.fn(),
  meRefresh: vi.fn(),
  tutorRefresh: vi.fn(),
}));
vi.mock("~/trpc/react", async () => {
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  type Options = {
    onSuccess?: (
      data: { ok: boolean },
      input: { email: string; currentPassword: string },
    ) => unknown;
    onSettled?: () => unknown;
  };
  return {
    api: {
      useUtils: () => ({
        account: { me: { invalidate: state.meRefresh } },
        tutor: { myProfile: { invalidate: state.tutorRefresh } },
      }),
      account: {
        emailSettings: {
          _def: () => ({ path: ["account", "emailSettings"] }),
          useQuery: () =>
            useQuery({
              queryKey: emailSettingsKey(),
              queryFn: state.read,
              initialData: state.initial ? state.settings : undefined,
              staleTime: Infinity,
              retry: false,
            }),
        },
        requestEmailChange: {
          useMutation: (options: Options) =>
            useMutation({ mutationFn: state.request, ...options }),
        },
        confirmEmailChange: {
          useMutation: (options: Options) =>
            useMutation({ mutationFn: state.confirm, ...options }),
        },
      },
    },
  };
});
import { EmailChange } from "./email-change";

const emailSettingsKey = () =>
  getQueryKey(api.account.emailSettings, undefined, "query");
let client: QueryClient;
const ui = () => (
  <QueryClientProvider client={client}>
    <NextIntlClientProvider locale="en" messages={en}>
      <EmailChange />
    </NextIntlClientProvider>
  </QueryClientProvider>
);
function enterRequest() {
  fireEvent.change(screen.getByLabelText(en.emailChange.email), {
    target: { value: "replacement@example.test" },
  });
  fireEvent.change(screen.getByLabelText(en.emailChange.password), {
    target: { value: "synthetic-password" },
  });
}
function codeInput() {
  return screen.getByRole<HTMLInputElement>("textbox", {
    name: (name) => name.startsWith(en.codes.emailLabel),
  });
}
async function requestCode() {
  enterRequest();
  fireEvent.click(screen.getByRole("button", { name: en.emailChange.send }));
  await screen.findByRole("button", { name: en.emailChange.confirm });
  await waitFor(() => expect(codeInput().matches(":disabled")).toBe(false));
}
beforeEach(() => {
  client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, retry: false },
    mutations: { ...defaults.mutations, retry: false },
  });
  state.initial = true;
  state.settings = {
    email: "primary@example.test",
    deliveryAvailable: true,
    secondaryEmailBindingEnabled: false,
  };
  state.read.mockReset().mockImplementation(async () => state.settings);
  state.request.mockReset().mockResolvedValue({ ok: true });
  state.confirm.mockReset().mockResolvedValue({ ok: true });
  state.meRefresh.mockReset().mockResolvedValue(undefined);
  state.tutorRefresh.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  client.clear();
});

it("requires password and mailbox proof without depending on optional alias binding", async () => {
  render(ui());
  const send = screen.getByRole("button", { name: en.emailChange.send });
  expect(send.matches(":disabled")).toBe(true);
  await requestCode();
  expect(state.request).toHaveBeenCalledWith(
    {
      email: "replacement@example.test",
      currentPassword: "synthetic-password",
    },
    expect.anything(),
  );
  expect(screen.queryByLabelText(en.emailChange.email)).toBeNull();
  expect(screen.queryByLabelText(en.emailChange.password)).toBeNull();
  expect(screen.getByText(/replacement@example.test/)).toBeTruthy();
  expect(state.confirm).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole("button", { name: en.emailChange.confirm })
      .matches(":disabled"),
  ).toBe(true);
});

it("admits one same-turn request and freezes pending fields", async () => {
  let resolve!: (value: { ok: boolean }) => void;
  state.request.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(ui());
  enterRequest();
  const form = screen.getByLabelText(en.emailChange.email).closest("form")!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText(en.emailChange.email).matches(":disabled")).toBe(
    true,
  );
  expect(
    screen.getByLabelText(en.emailChange.password).matches(":disabled"),
  ).toBe(true);
  await act(async () => resolve({ ok: true }));
  await screen.findByRole("button", { name: en.emailChange.confirm });
});

it("retains a rejected request draft and requires an explicit retry", async () => {
  state.request.mockRejectedValue(new Error("Destination unavailable"));
  render(ui());
  enterRequest();
  fireEvent.click(screen.getByRole("button", { name: en.emailChange.send }));
  await screen.findByText("Destination unavailable");
  expect(
    screen.getByLabelText<HTMLInputElement>(en.emailChange.email).value,
  ).toBe("replacement@example.test");
  expect(
    screen.getByLabelText<HTMLInputElement>(en.emailChange.password).value,
  ).toBe("synthetic-password");
  expect(state.request).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("button", { name: en.emailChange.confirm }),
  ).toBeNull();
  state.request.mockResolvedValue({ ok: true });
  fireEvent.click(screen.getByRole("button", { name: en.emailChange.send }));
  await screen.findByRole("button", { name: en.emailChange.confirm });
  expect(state.request).toHaveBeenCalledTimes(2);
});

it("recovers an accepted confirmation with reads only after synchronization fails", async () => {
  render(ui());
  await requestCode();
  fireEvent.change(codeInput(), { target: { value: "00-12" } });
  state.read.mockRejectedValue(new Error("Network unavailable"));
  const form = codeInput().closest("form")!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  await screen.findByText(en.emailChange.success);
  await screen.findByRole("button", { name: en.uiPatterns.retry });
  expect(state.confirm).toHaveBeenCalledTimes(1);
  expect(state.confirm).toHaveBeenCalledWith(
    { code: "0012" },
    expect.anything(),
  );
  expect(codeInput().value).toBe("0012");
  expect(codeInput().matches(":disabled")).toBe(true);
  fireEvent.submit(form);
  expect(state.confirm).toHaveBeenCalledTimes(1);
  state.settings = { ...state.settings, email: "replacement@example.test" };
  state.read.mockResolvedValue(state.settings);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await screen.findByLabelText(en.emailChange.email);
  await waitFor(() =>
    expect(
      screen.getByLabelText(en.emailChange.email).matches(":disabled"),
    ).toBe(false),
  );
  expect(state.confirm).toHaveBeenCalledTimes(1);
  expect(state.request).toHaveBeenCalledTimes(1);
  expect(state.meRefresh).toHaveBeenCalledTimes(2);
  expect(state.tutorRefresh).toHaveBeenCalledTimes(2);
});

it("retains the bound destination and code after a rejected confirmation", async () => {
  state.confirm.mockRejectedValue(new Error("Incorrect or expired code"));
  render(ui());
  await requestCode();
  fireEvent.change(codeInput(), { target: { value: "4321" } });
  fireEvent.click(screen.getByRole("button", { name: en.emailChange.confirm }));
  await screen.findByText("Incorrect or expired code");
  expect(codeInput().value).toBe("4321");
  expect(screen.getByText(/replacement@example.test/)).toBeTruthy();
  expect(state.request).toHaveBeenCalledTimes(1);
});

it("blocks new delivery on outage while allowing an existing mailbox code to confirm", async () => {
  render(ui());
  await requestCode();
  state.settings = { ...state.settings, deliveryAvailable: false };
  await act(async () => {
    await client.invalidateQueries({ queryKey: emailSettingsKey() });
  });
  expect(await screen.findByText(en.emailChange.unavailable)).toBeTruthy();
  fireEvent.change(codeInput(), { target: { value: "1234" } });
  fireEvent.click(screen.getByRole("button", { name: en.emailChange.confirm }));
  await screen.findByText(en.emailChange.success);
  expect(state.confirm).toHaveBeenCalledTimes(1);
  await screen.findByLabelText(en.emailChange.email);
  enterRequest();
  const form = screen.getByLabelText(en.emailChange.email).closest("form")!;
  fireEvent.submit(form);
  expect(state.request).toHaveBeenCalledTimes(1);
});

it("retains drafts and fences sends after cached read failure, recovering through reads", async () => {
  render(ui());
  enterRequest();
  state.read.mockRejectedValue(new Error("Read failed"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: emailSettingsKey() });
  });
  expect(
    await screen.findByText(en.participantRecovery.refreshFailed),
  ).toBeTruthy();
  const email = screen.getByLabelText<HTMLInputElement>(en.emailChange.email);
  expect(email.value).toBe("replacement@example.test");
  expect(email.matches(":disabled")).toBe(true);
  fireEvent.submit(email.closest("form")!);
  expect(state.request).not.toHaveBeenCalled();
  state.read.mockResolvedValue(state.settings);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await waitFor(() => expect(email.matches(":disabled")).toBe(false));
  expect(email.value).toBe("replacement@example.test");
  expect(state.request).not.toHaveBeenCalled();
});

it("conceals a challenge after denial through later transport errors", async () => {
  render(ui());
  await requestCode();
  state.read.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: emailSettingsKey() });
  });
  expect(
    await screen.findByText(en.participantRecovery.accessDenied),
  ).toBeTruthy();
  expect(screen.queryByText(/replacement@example.test/)).toBeNull();
  state.read.mockRejectedValue(new Error("Network"));
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: en.uiPatterns.retry })
        .matches(":disabled"),
    ).toBe(false),
  );
  expect(screen.queryByText(/replacement@example.test/)).toBeNull();
  state.read.mockResolvedValue(state.settings);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await screen.findByText(/replacement@example.test/);
  expect(state.request).toHaveBeenCalledTimes(1);
  expect(state.confirm).not.toHaveBeenCalled();
});

it("shows read recovery instead of a fabricated delivery outage on initial failure", async () => {
  state.initial = false;
  state.read.mockRejectedValue(new Error("Initial read failed"));
  render(ui());
  await screen.findByText(en.participantRecovery.loadFailed);
  expect(screen.queryByText(en.emailChange.unavailable)).toBeNull();
  expect(screen.queryByLabelText(en.emailChange.email)).toBeNull();
  state.read.mockResolvedValue(state.settings);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await screen.findByLabelText(en.emailChange.email);
  expect(state.request).not.toHaveBeenCalled();
});

it("requires new password proof when explicitly replacing the code destination", async () => {
  render(ui());
  await requestCode();
  fireEvent.change(codeInput(), { target: { value: "1234" } });
  fireEvent.click(screen.getByRole("button", { name: "Use another email" }));
  expect(
    screen.queryByRole("button", { name: en.emailChange.confirm }),
  ).toBeNull();
  expect(
    screen.getByLabelText<HTMLInputElement>(en.emailChange.password).value,
  ).toBe("");
  expect(
    screen
      .getByRole("button", { name: en.emailChange.send })
      .matches(":disabled"),
  ).toBe(true);
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.request).toHaveBeenCalledTimes(1);
});

it.each(["request", "confirm"] as const)(
  "requires fresh authorization after a %s access denial",
  async (stage) => {
    const denied = Object.assign(new Error("Access revoked"), {
      data: { code: "FORBIDDEN" },
    });
    render(ui());
    if (stage === "confirm") {
      await requestCode();
      fireEvent.change(codeInput(), { target: { value: "1234" } });
      state.confirm.mockRejectedValue(denied);
      fireEvent.click(
        screen.getByRole("button", { name: en.emailChange.confirm }),
      );
    } else {
      state.request.mockRejectedValue(denied);
      enterRequest();
      fireEvent.click(
        screen.getByRole("button", { name: en.emailChange.send }),
      );
    }
    await screen.findByText(en.participantRecovery.accessDenied);
    expect(screen.queryByLabelText(en.emailChange.email)).toBeNull();
    expect(screen.queryByText(/replacement@example.test/)).toBeNull();
    state.read.mockRejectedValue(new Error("Network"));
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: en.uiPatterns.retry })
          .matches(":disabled"),
      ).toBe(false),
    );
    expect(screen.getByText(en.participantRecovery.accessDenied)).toBeTruthy();
    expect(screen.queryByText(/replacement@example.test/)).toBeNull();
    state.read.mockResolvedValue(state.settings);
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
    if (stage === "confirm") {
      await screen.findByText(/replacement@example.test/);
      expect(codeInput().value).toBe("1234");
    } else {
      const email = await screen.findByLabelText<HTMLInputElement>(
        en.emailChange.email,
      );
      expect(email.value).toBe("replacement@example.test");
      expect(
        screen.getByLabelText<HTMLInputElement>(en.emailChange.password).value,
      ).toBe("synthetic-password");
    }
    expect(state.request).toHaveBeenCalledTimes(1);
    expect(state.confirm).toHaveBeenCalledTimes(stage === "confirm" ? 1 : 0);
  },
);

it("keeps an accepted confirmation fenced when a dependent identity refresh fails", async () => {
  state.meRefresh.mockRejectedValue(new Error("Identity refresh failed"));
  render(ui());
  await requestCode();
  fireEvent.change(codeInput(), { target: { value: "1234" } });
  fireEvent.click(screen.getByRole("button", { name: en.emailChange.confirm }));
  await screen.findByRole("button", { name: en.uiPatterns.retry });
  expect(codeInput().matches(":disabled")).toBe(true);
  expect(state.tutorRefresh).toHaveBeenCalledTimes(1);
  state.meRefresh.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await screen.findByLabelText(en.emailChange.email);
  expect(state.confirm).toHaveBeenCalledTimes(1);
  expect(state.request).toHaveBeenCalledTimes(1);
});

it("does not let read Retry consume the synchronization lease of a pending confirmation", async () => {
  let accept!: (value: { ok: boolean }) => void;
  state.confirm.mockImplementation(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      }),
  );
  render(ui());
  await requestCode();
  fireEvent.change(codeInput(), { target: { value: "1234" } });
  fireEvent.click(screen.getByRole("button", { name: en.emailChange.confirm }));
  await waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(1));
  state.read.mockRejectedValue(new Error("Background read failed"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: emailSettingsKey() });
  });
  const retry = await screen.findByRole("button", {
    name: en.uiPatterns.retry,
  });
  expect(retry.matches(":disabled")).toBe(true);
  fireEvent.click(retry);
  expect(state.read).toHaveBeenCalledTimes(1);

  let synchronize!: (value: typeof state.settings) => void;
  state.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        synchronize = resolve;
      }),
  );
  await act(async () => accept({ ok: true }));
  await waitFor(() => expect(state.read).toHaveBeenCalledTimes(2));
  expect(codeInput().matches(":disabled")).toBe(true);
  await act(async () =>
    synchronize({ ...state.settings, email: "replacement@example.test" }),
  );
  const email = await screen.findByLabelText<HTMLInputElement>(
    en.emailChange.email,
  );
  await waitFor(() => expect(email.matches(":disabled")).toBe(false));
  expect(state.confirm).toHaveBeenCalledTimes(1);
  expect(state.request).toHaveBeenCalledTimes(1);
});
