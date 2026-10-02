/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { AccountSettings } from "./account-settings";

const state = vi.hoisted(() => {
  const account: {
    id: string;
    name: string;
    firstName: string | null;
    lastName: string | null;
    preferredName: string | null;
    alternativeNames: string | null;
    legacyName: string | null;
    username: string;
    email: null;
    role: string;
    profileVersion: number;
  } = {
    id: "self",
    name: "Original Person",
    firstName: "Original",
    lastName: "Person",
    preferredName: "Ori",
    alternativeNames: "原名",
    legacyName: null,
    username: "original",
    email: null,
    role: "STUDENT",
    profileVersion: 3,
  };
  return {
    account,
    pending: false,
    success: false,
    error: null as { message: string; data?: { code: string } } | null,
    save: vi.fn(),
    reset: vi.fn(),
    refetch: vi.fn(),
    settled: (): void => undefined,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock("./academic-profile", () => ({
  AcademicPanel: () => <input aria-label="Academic draft" />,
}));
vi.mock("./school-departure", () => ({ SchoolDeparturePanel: () => null }));
vi.mock("./membership-editor", () => ({
  MembershipEditor: () => <input aria-label="Membership draft" />,
}));
vi.mock("./account-emails", () => ({
  AccountEmails: () => null,
  EmailPreferences: () => null,
}));
vi.mock("./two-factor-settings", () => ({ TwoFactorSettings: () => null }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      account: { me: { invalidate: () => Promise.resolve() } },
    }),
    program: { features: { useQuery: () => ({ data: { EMAIL_2FA: false } }) } },
    account: {
      me: { useQuery: () => ({ data: state.account, refetch: state.refetch }) },
      updateName: {
        useMutation: (options: { onSettled: () => void }) => {
          state.settled = options.onSettled;
          return {
            mutate: state.save,
            reset: state.reset,
            isPending: state.pending,
            isSuccess: state.success,
            error: state.error,
          };
        },
      },
      requestPasswordChangeCode: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      changePassword: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

function ui() {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <AccountSettings />
    </NextIntlClientProvider>
  );
}
function firstName() {
  return screen.getByLabelText<HTMLInputElement>("First Name Required");
}
function save() {
  return screen.getByRole("button", { name: en.uiPatterns.saveProfile });
}

beforeEach(() => {
  state.account = {
    id: "self",
    name: "Original Person",
    firstName: "Original",
    lastName: "Person",
    preferredName: "Ori",
    alternativeNames: "原名",
    legacyName: null,
    username: "original",
    email: null,
    role: "STUDENT",
    profileVersion: 3,
  };
  state.pending = false;
  state.success = false;
  state.error = null;
  state.save.mockReset();
  state.reset.mockReset();
  state.refetch.mockReset();
});
afterEach(cleanup);

it("saves all four name fields once and freezes only the identity form during the request", () => {
  const view = render(ui());
  fireEvent.change(firstName(), { target: { value: "Edited" } });
  fireEvent.change(screen.getByLabelText("Last Name Optional"), {
    target: { value: "Surname" },
  });
  fireEvent.change(screen.getByLabelText("Preferred Name Optional"), {
    target: { value: "Ed" },
  });
  fireEvent.change(screen.getByLabelText("Name in Another Language Optional"), {
    target: { value: "新名" },
  });
  const form = firstName().closest("form")!;
  expect(save().classList.contains("control-standard")).toBe(true);
  expect(
    screen
      .getByRole("button", { name: en.uiPatterns.cancel })
      .classList.contains("control-standard"),
  ).toBe(true);
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(state.save).toHaveBeenCalledOnce();
  expect(state.save).toHaveBeenCalledWith(
    {
      name: "Edited Surname",
      firstName: "Edited",
      lastName: "Surname",
      preferredName: "Ed",
      alternativeNames: "新名",
      expectedProfileVersion: 3,
    },
    expect.any(Object),
  );
  state.pending = true;
  view.rerender(ui());
  expect(firstName().matches(":disabled")).toBe(true);
  expect(
    screen
      .getByRole("button", { name: en.uiPatterns.cancel })
      .matches(":disabled"),
  ).toBe(true);
  expect(screen.getByLabelText("Academic draft").matches(":disabled")).toBe(
    false,
  );
  expect(screen.getByLabelText("Membership draft").matches(":disabled")).toBe(
    false,
  );
  expect(
    screen
      .getByLabelText(en.tutor.settings.currentPassword)
      .matches(":disabled"),
  ).toBe(false);
  state.pending = false;
  state.error = { message: "Save failed" };
  state.settled();
  view.rerender(ui());
  expect(firstName().value).toBe("Edited");
  expect(firstName().matches(":disabled")).toBe(false);
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(save());
  expect(state.save).toHaveBeenCalledTimes(2);
});

it("preserves an unsplit legacy identity while saving its additional-language name", () => {
  state.account = {
    ...state.account,
    name: "张小明",
    firstName: null,
    lastName: null,
    preferredName: null,
    alternativeNames: null,
    legacyName: "张小明",
  };
  render(ui());
  fireEvent.change(screen.getByLabelText("Name in Another Language Optional"), {
    target: { value: "Xiaoming" },
  });
  fireEvent.click(save());
  expect(state.save).toHaveBeenCalledWith(
    { name: "张小明", alternativeNames: "Xiaoming", expectedProfileVersion: 3 },
    expect.any(Object),
  );
});

it("keeps a dirty draft and version through background refreshes, then Cancel deliberately restores the current identity", () => {
  const view = render(ui());
  fireEvent.change(firstName(), { target: { value: "Draft" } });
  state.account = {
    ...state.account,
    name: "Latest Person",
    firstName: "Latest",
    preferredName: "LP",
    profileVersion: 8,
  };
  view.rerender(ui());
  expect(firstName().value).toBe("Draft");
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.cancel }));
  expect(firstName().value).toBe("Latest");
  expect(
    screen.getByLabelText<HTMLInputElement>("Preferred Name Optional").value,
  ).toBe("LP");
  expect(state.reset).toHaveBeenCalledOnce();
  fireEvent.click(save());
  expect(state.save).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "Latest Person",
      expectedProfileVersion: 8,
    }),
    expect.any(Object),
  );
});

it.each([false, true])(
  "discards a conflicted name draft only after a successful explicit reload (success=%s)",
  async (succeeds) => {
    state.error = { message: "PROFILE_CONFLICT", data: { code: "CONFLICT" } };
    const view = render(ui());
    fireEvent.change(firstName(), { target: { value: "My draft" } });
    state.account = {
      ...state.account,
      name: "Server Person",
      firstName: "Server",
      profileVersion: 8,
    };
    view.rerender(ui());
    let complete!: (result: {
      isSuccess: boolean;
      data: typeof state.account;
    }) => void;
    state.refetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: en.accountProfile.reloadIdentity }),
    );
    expect(firstName().matches(":disabled")).toBe(true);
    await act(async () => {
      complete({ isSuccess: succeeds, data: state.account });
    });
    expect(firstName().matches(":disabled")).toBe(false);
    expect(firstName().value).toBe(succeeds ? "Server" : "My draft");
    expect(state.reset).toHaveBeenCalledTimes(succeeds ? 1 : 0);
    fireEvent.click(save());
    expect(state.save).toHaveBeenCalledWith(
      expect.objectContaining({ expectedProfileVersion: succeeds ? 8 : 3 }),
      expect.any(Object),
    );
  },
);

it("clears the previous success notice when a new identity draft starts", () => {
  state.success = true;
  render(ui());
  expect(screen.getByRole("status").textContent).toBe(en.tutor.settings.saved);
  fireEvent.change(firstName(), { target: { value: "New draft" } });
  expect(state.reset).toHaveBeenCalledOnce();
});
