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
  noCatalogue: false,
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
          data:
            state.loading || state.noCatalogue
              ? undefined
              : [
                  {
                    code: "en",
                    label: "English",
                    enabled: true,
                    builtIn: true,
                  },
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
  state.noCatalogue = false;
  state.retry.mockReset();
  state.managedInvalidation.mockReset();
  state.publicInvalidation.mockReset();
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
  expect(screen.getByRole("alert").textContent).toContain(
    "Catalog unavailable",
  );
});

it("recovers an initial failed catalogue through reads before exposing actions", async () => {
  state.noCatalogue = true;
  state.error = new Error("Initial catalogue unavailable");
  const { rerender } = render(<LanguagesPanel canAdd />);
  expect(screen.getByRole("alert").textContent).toContain(state.error.message);
  expect(screen.queryByText("English")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "uiPatterns.retry" }));
  await waitFor(() => expect(state.retry).toHaveBeenCalledTimes(3));
  expect(state.add).not.toHaveBeenCalled();
  expect(state.toggle).not.toHaveBeenCalled();
  state.noCatalogue = false;
  state.error = null;
  rerender(<LanguagesPanel canAdd />);
  expect(screen.getByText("English")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("retains custom rows and unfinished language fields across a failed read and failed Retry", async () => {
  state.custom = true;
  const { rerender } = render(<LanguagesPanel canAdd />);
  const code = screen.getByRole<HTMLInputElement>("textbox", {
    name: "localization.addLanguageCode",
  });
  const label = screen.getByRole<HTMLInputElement>("textbox", {
    name: "localization.addLanguageName",
  });
  fireEvent.change(code, { target: { value: "it" } });
  fireEvent.change(label, { target: { value: "Italiano" } });
  state.error = new Error("Cached catalogue unavailable");
  rerender(<LanguagesPanel canAdd />);
  expect(screen.getByText("Synthetic Portuguese")).toBeTruthy();
  expect(code.value).toBe("it");
  expect(label.value).toBe("Italiano");
  expect(code.disabled).toBe(true);
  state.retry.mockRejectedValueOnce(new Error("Retry still unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "uiPatterns.retry" }));
  await waitFor(() => expect(state.retry).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "uiPatterns.retry",
      }).disabled,
    ).toBe(false),
  );
  expect(code.disabled).toBe(true);
  expect(label.value).toBe("Italiano");
  fireEvent.click(screen.getByRole("button", { name: "uiPatterns.retry" }));
  await waitFor(() => expect(state.retry).toHaveBeenCalledTimes(6));
  state.error = null;
  rerender(<LanguagesPanel canAdd />);
  await waitFor(() => expect(code.disabled).toBe(false));
  expect(code.value).toBe("it");
  expect(label.value).toBe("Italiano");
  expect(state.add).not.toHaveBeenCalled();
  expect(state.toggle).not.toHaveBeenCalled();
  expect(state.reorder).not.toHaveBeenCalled();
  expect(state.remove).not.toHaveBeenCalled();
});

it("retries synchronization after an accepted toggle without toggling again", async () => {
  state.managedInvalidation.mockRejectedValueOnce(
    new Error("Accepted toggle refresh failed"),
  );
  render(<LanguagesPanel canAdd={false} />);
  const toggle = row("中文").getByRole<HTMLButtonElement>("button", {
    name: "localization.disableLanguage",
  });
  fireEvent.click(toggle);
  expect(state.toggle).toHaveBeenCalledOnce();
  await act(async () => {
    await state.onSuccess?.();
  });
  expect(screen.getByRole("alert").textContent).toContain(
    "Accepted toggle refresh failed",
  );
  expect(toggle.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "uiPatterns.retry" }));
  await waitFor(() =>
    expect(state.managedInvalidation).toHaveBeenCalledTimes(2),
  );
  await waitFor(() => expect(toggle.disabled).toBe(false));
  expect(state.publicInvalidation).toHaveBeenCalledTimes(2);
  expect(state.toggle).toHaveBeenCalledOnce();
  expect(state.add).not.toHaveBeenCalled();
  expect(state.remove).not.toHaveBeenCalled();
  expect(state.reorder).not.toHaveBeenCalled();
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
  fireEvent.click(screen.getByRole("button", { name: "uiPatterns.retry" }));
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
