// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "HEAD",
  manage: true,
  loading: false,
  error: null as Error | null,
  pending: false,
  toggle: vi.fn(),
  reorder: vi.fn(),
  add: vi.fn(),
  managedInvalidation: vi.fn(),
  publicInvalidation: vi.fn(),
  onSuccess: undefined as undefined | (() => Promise<unknown>),
  retry: vi.fn(),
  confirm: vi.fn(),
  remove: vi.fn(),
  custom: false,
  nullCapability: false,
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./confirm-dialog", () => ({
  useDialog: () => ({ confirm: state.confirm, dialog: null }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    account: {
      me: {
        useQuery: () => ({
          data: { role: state.role, canTranslate: true },
          isSuccess: true,
          refetch: state.retry,
        }),
      },
    },
    useUtils: () => ({
      i18n: {
        managedLanguages: { invalidate: state.managedInvalidation },
        languages: { invalidate: state.publicInvalidation },
      },
    }),
    i18n: {
      managedLanguages: {
        useQuery: () => ({
          isLoading: state.loading,
          error: state.error,
          isSuccess: !state.loading && !state.error,
          refetch: state.retry,
          data: state.loading
            ? undefined
            : [
                { code: "en", label: "English", enabled: true, builtIn: true },
                { code: "zh", label: "中文", enabled: true, builtIn: true },
                {
                  code: "fr",
                  label: "Français",
                  enabled: false,
                  builtIn: true,
                },
                ...(state.custom
                  ? [
                      {
                        code: "pt-br",
                        label: "Synthetic Portuguese",
                        enabled: false,
                        builtIn: false,
                      },
                    ]
                  : []),
              ],
        }),
      },
      canManageLanguages: {
        useQuery: () => ({
          data: state.nullCapability ? null : state.manage,
          isSuccess: true,
          refetch: state.retry,
        }),
      },
      setLanguageEnabled: {
        useMutation: (options: {
          onSuccess: () => Promise<unknown>;
          onSettled: () => void;
        }) => {
          state.onSuccess = options.onSuccess;
          return {
            mutate: (input: unknown) => {
              state.toggle(input);
              options.onSettled();
            },
            isPending: state.pending,
          };
        },
      },
      reorderLanguages: {
        useMutation: (options: { onSettled: () => void }) => ({
          mutate: (input: unknown) => {
            state.reorder(input);
            options.onSettled();
          },
        }),
      },
      addLanguage: {
        useMutation: (options: { onSettled: () => void }) => ({
          mutate: (input: unknown) => {
            state.add(input);
            options.onSettled();
          },
        }),
      },
      deleteLanguage: { useMutation: () => ({ mutate: state.remove }) },
    },
  },
}));
import { LanguagesPanel } from "./languages-panel";
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.role = "HEAD";
  state.manage = true;
  state.loading = false;
  state.error = null;
  state.pending = false;
  state.custom = false;
  state.nullCapability = false;
});
const row = (name: string) => within(screen.getByText(name).closest("li")!);
it("toggles hidden and enabled languages while protecting English", () => {
  render(<LanguagesPanel canAdd={false} />);
  expect(
    row("English")
      .getByRole("button", {
        name: "localization.disableLanguage",
      })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(
    row("中文").getByRole("button", { name: "localization.disableLanguage" }),
  );
  expect(state.toggle).toHaveBeenCalledWith({ code: "zh", enabled: false });
  fireEvent.click(
    row("Français").getByRole("button", {
      name: "localization.enableLanguage",
    }),
  );
  expect(state.toggle).toHaveBeenCalledWith({ code: "fr", enabled: true });
  expect(screen.queryByRole("textbox")).toBeNull();
});
it("reorders the complete catalog including hidden languages with bounded arrows", () => {
  render(<LanguagesPanel canAdd={false} />);
  fireEvent.click(
    row("中文").getByRole("button", { name: "localization.moveUp" }),
  );
  expect(state.reorder).toHaveBeenCalledWith({ codes: ["zh", "en", "fr"] });
  fireEvent.click(
    row("中文").getByRole("button", { name: "localization.moveDown" }),
  );
  expect(state.reorder).toHaveBeenCalledWith({ codes: ["en", "fr", "zh"] });
  expect(
    row("English")
      .getByRole("button", {
        name: "localization.moveUp",
      })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    row("Français")
      .getByRole("button", {
        name: "localization.moveDown",
      })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("refreshes both management and public selectors after changes", async () => {
  render(<LanguagesPanel canAdd={false} />);
  await act(async () => {
    await state.onSuccess!();
  });
  expect(state.managedInvalidation).toHaveBeenCalledOnce();
  expect(state.publicInvalidation).toHaveBeenCalledOnce();
});
it("prevents overlapping catalog changes while a save is pending", () => {
  state.pending = true;
  render(<LanguagesPanel canAdd={false} />);
  expect(
    screen.getAllByRole("button").every((b) => b.hasAttribute("disabled")),
  ).toBe(true);
});
it("lets a translator add a catalog without exposing management controls", () => {
  state.manage = false;
  render(<LanguagesPanel canAdd />);
  expect(
    screen.queryByRole("button", { name: "localization.moveUp" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "localization.disableLanguage" }),
  ).toBeNull();
  fireEvent.change(
    screen.getByRole("textbox", { name: "localization.addLanguageCode" }),
    { target: { value: "it" } },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "localization.addLanguageName" }),
    { target: { value: "Italiano" } },
  );
  // The field purpose remains visible and associated after its placeholder would disappear.
  expect(
    screen
      .getByText("localization.addLanguageCode")
      .closest("label")
      ?.contains(
        screen.getByRole("textbox", { name: "localization.addLanguageCode" }),
      ),
  ).toBe(true);
  expect(
    screen
      .getByText("localization.addLanguageName")
      .closest("label")
      ?.contains(
        screen.getByRole("textbox", { name: "localization.addLanguageName" }),
      ),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "localization.addLanguageBtn" }),
  );
  expect(state.add).toHaveBeenCalledWith({ code: "it", label: "Italiano" });
});
it("reports loading and query failures instead of showing an empty catalog", () => {
  state.loading = true;
  const { rerender } = render(<LanguagesPanel canAdd={false} />);
  expect(screen.getByRole("status")).toBeTruthy();
  state.loading = false;
  state.error = new Error("Catalog unavailable");
  rerender(<LanguagesPanel canAdd={false} />);
  expect(screen.getByRole("alert").textContent).toBe("Catalog unavailable");
});

it("retains a cached catalogue beside read-only Retry and blocks writes until recovery", async () => {
  state.error = new Error("Cached catalogue unavailable");
  const { rerender } = render(<LanguagesPanel canAdd />);
  expect(row("中文").getByText("localization.enabled")).toBeTruthy();
  expect(
    row("中文").getByRole<HTMLButtonElement>("button", {
      name: "localization.disableLanguage",
    }).disabled,
  ).toBe(true);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", {
      name: "localization.addLanguageCode",
    }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
  await waitFor(() => expect(state.retry).toHaveBeenCalledTimes(3));
  expect(state.add).not.toHaveBeenCalled();
  expect(state.toggle).not.toHaveBeenCalled();
  state.error = null;
  rerender(<LanguagesPanel canAdd />);
  await waitFor(() =>
    expect(
      row("中文").getByRole<HTMLButtonElement>("button", {
        name: "localization.disableLanguage",
      }).disabled,
    ).toBe(false),
  );
});

it("lets Coordinators propose catalog changes while protecting English", () => {
  state.role = "COORDINATOR";
  render(<LanguagesPanel canAdd={false} />);
  expect(
    row("English").getByRole<HTMLButtonElement>("button", {
      name: "localization.disableLanguage",
    }).disabled,
  ).toBe(true);
  fireEvent.click(
    row("中文").getByRole("button", { name: "localization.disableLanguage" }),
  );
  expect(state.toggle).toHaveBeenCalledWith({ code: "zh", enabled: false });
  // The immutable read stays unchanged while the server owns approval routing.
  expect(row("中文").getByText("localization.enabled")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "localization.addLanguageBtn" }),
  ).toBeNull();
});

it("keeps catalog management concealed from a viewer even if capabilities are stale", () => {
  state.role = "VIEWER";
  render(<LanguagesPanel canAdd={false} />);
  expect(
    screen.queryByRole("button", { name: "localization.disableLanguage" }),
  ).toBeNull();
  expect(state.toggle).not.toHaveBeenCalled();
});

it.each(["catalogue failure", "management loss", "denial"])(
  "rechecks live removal admission after a held confirmation and %s",
  async (cause) => {
    state.custom = true;
    let confirm!: (approved: boolean) => void;
    state.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          confirm = resolve;
        }),
    );
    const { rerender } = render(<LanguagesPanel canAdd={false} />);
    fireEvent.click(
      row("Synthetic Portuguese").getByRole("button", {
        name: "localization.removeLanguage",
      }),
    );
    expect(state.confirm).toHaveBeenCalledOnce();
    if (cause === "management loss") state.manage = false;
    else
      state.error =
        cause === "denial"
          ? Object.assign(new Error("Catalogue denied"), {
              data: { code: "FORBIDDEN" },
            })
          : new Error("Catalogue unavailable during confirmation");
    rerender(<LanguagesPanel canAdd={false} />);
    if (cause === "denial")
      expect(screen.queryByText("Synthetic Portuguese")).toBeNull();
    await act(async () => {
      confirm(true);
    });
    expect(state.remove).not.toHaveBeenCalled();
  },
);

it("does not release denied cached catalogue evidence on a successful null capability response", () => {
  state.error = Object.assign(new Error("Catalogue denied"), {
    data: { code: "FORBIDDEN" },
  });
  const { rerender } = render(<LanguagesPanel canAdd={false} />);
  expect(screen.queryByText("English")).toBeNull();
  state.error = null;
  state.nullCapability = true;
  rerender(<LanguagesPanel canAdd={false} />);
  expect(screen.queryByText("English")).toBeNull();
  state.error = new Error("Later transport failure");
  rerender(<LanguagesPanel canAdd={false} />);
  expect(screen.queryByText("English")).toBeNull();
  state.error = null;
  state.nullCapability = false;
  rerender(<LanguagesPanel canAdd={false} />);
  expect(screen.getByText("English")).toBeTruthy();
  expect(state.toggle).not.toHaveBeenCalled();
});
