// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
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
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./confirm-dialog", () => ({
  useDialog: () => ({ confirm: vi.fn(), dialog: null }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
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
          data: [
            { code: "en", label: "English", enabled: true, builtIn: true },
            { code: "zh", label: "中文", enabled: true, builtIn: true },
            { code: "fr", label: "Français", enabled: false, builtIn: true },
          ],
        }),
      },
      canManageLanguages: { useQuery: () => ({ data: state.manage }) },
      setLanguageEnabled: {
        useMutation: (options: { onSuccess: () => Promise<unknown> }) => {
          state.onSuccess = options.onSuccess;
          return { mutate: state.toggle, isPending: state.pending };
        },
      },
      reorderLanguages: { useMutation: () => ({ mutate: state.reorder }) },
      addLanguage: { useMutation: () => ({ mutate: state.add }) },
      deleteLanguage: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));
import { LanguagesPanel } from "./languages-panel";
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.manage = true;
  state.loading = false;
  state.error = null;
  state.pending = false;
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
  await state.onSuccess!();
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
