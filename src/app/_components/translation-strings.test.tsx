/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TranslationStrings } from "./translation-strings";

const state = vi.hoisted(() => ({
  write: vi.fn(),
  refresh: vi.fn<() => Promise<void>>(),
  fail: undefined as undefined | (() => void),
  accept: undefined as undefined | (() => Promise<void>),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    account: {
      me: { useQuery: () => ({ data: { role: "ADMIN", canTranslate: true } }) },
    },
    i18n: {
      managedLanguages: {
        useQuery: () => ({
          data: [
            { code: "en", label: "English", enabled: true },
            { code: "zh", label: "中文", enabled: true },
          ],
        }),
      },
    },
    localization: {
      strings: {
        useQuery: ({ locale }: { locale: string }) => ({
          data: [
            {
              key: "common.title",
              en: "Original title",
              base: locale === "en" ? "Original title" : "原标题",
              override: null,
            },
            {
              key: "other.subtitle",
              en: "Other text",
              base: "Other text",
              override: null,
            },
          ],
        }),
      },
      setString: {
        useMutation: (options: {
          onSuccess: (
            result: unknown,
            input: { value: string },
          ) => Promise<void>;
          onError: (error: Error) => void;
          onSettled: () => void;
        }) => ({
          mutate: (input: { locale: string; key: string; value: string }) => {
            state.write(input);
            state.fail = () => {
              options.onError(new Error("Synthetic write failed"));
              options.onSettled();
            };
            state.accept = async () => {
              await options.onSuccess({}, input);
              options.onSettled();
            };
          },
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      localization: { strings: { invalidate: state.refresh } },
      translationReview: { list: { invalidate: state.refresh } },
    }),
  },
}));
beforeEach(() => {
  state.write.mockReset();
  state.refresh.mockReset().mockResolvedValue(undefined);
  state.fail = undefined;
  state.accept = undefined;
});
afterEach(cleanup);
const field = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: "common.title" });
const toggle = () =>
  fireEvent.click(screen.getByRole("button", { name: /^Common/ }));

it("exposes namespace expansion and associates each editor with its save boundary", () => {
  render(<TranslationStrings />);
  const namespace = screen.getByRole("button", { name: /^Common/ });
  expect(namespace.getAttribute("aria-expanded")).toBe("false");
  const panelId = namespace.getAttribute("aria-controls")!;
  toggle();
  expect(namespace.getAttribute("aria-expanded")).toBe("true");
  expect(document.getElementById(panelId)?.contains(field())).toBe(true);
  const helpId = field().getAttribute("aria-describedby")!;
  expect(document.getElementById(helpId)?.textContent).toBe(
    "saveBoundary.blur",
  );
  toggle();
  expect(namespace.getAttribute("aria-expanded")).toBe("false");
  fireEvent.change(
    screen.getByRole("textbox", { name: "localization.searchLabel" }),
    { target: { value: "common" } },
  );
  expect(namespace.getAttribute("aria-expanded")).toBe("true");
  expect(namespace.getAttribute("aria-controls")).toBe(panelId);
  expect(document.getElementById(panelId)?.contains(field())).toBe(true);
  expect(state.write).not.toHaveBeenCalled();
});

it("retains a failed string draft across namespace, search and locale changes", async () => {
  render(<TranslationStrings />);
  toggle();
  fireEvent.change(field(), { target: { value: "Unsaved English" } });
  fireEvent.blur(field());
  await act(async () => {
    state.fail?.();
  });
  toggle();
  toggle();
  expect(field().value).toBe("Unsaved English");
  expect(screen.getByRole("alert").textContent).toBe("Synthetic write failed");
  fireEvent.change(
    screen.getByRole("textbox", { name: "localization.searchLabel" }),
    { target: { value: "other" } },
  );
  expect(screen.queryByLabelText("common.title")).toBeNull();
  fireEvent.change(
    screen.getByRole("textbox", { name: "localization.searchLabel" }),
    { target: { value: "" } },
  );
  expect(field().value).toBe("Unsaved English");
  fireEvent.change(
    screen.getByRole("combobox", { name: "localization.targetLanguage" }),
    { target: { value: "zh" } },
  );
  fireEvent.change(field(), { target: { value: "未保存的中文" } });
  fireEvent.change(
    screen.getByRole("combobox", { name: "localization.targetLanguage" }),
    { target: { value: "en" } },
  );
  expect(field().value).toBe("Unsaved English");
  fireEvent.change(
    screen.getByRole("combobox", { name: "localization.targetLanguage" }),
    { target: { value: "zh" } },
  );
  expect(field().value).toBe("未保存的中文");
  expect(state.write).toHaveBeenCalledOnce();
});

it("keeps a pending row disabled after remount and records its eventual failure", async () => {
  render(<TranslationStrings />);
  toggle();
  fireEvent.change(field(), { target: { value: "Pending draft" } });
  fireEvent.blur(field());
  toggle();
  toggle();
  expect(field().disabled).toBe(true);
  fireEvent.blur(field());
  expect(state.write).toHaveBeenCalledOnce();
  await act(async () => {
    state.fail?.();
  });
  expect(field().disabled).toBe(false);
  expect(field().value).toBe("Pending draft");
  expect(screen.getByRole("alert").textContent).toBe("Synthetic write failed");
});

it("recovers an accepted translation through reads without submitting it twice", async () => {
  state.refresh.mockRejectedValue(new Error("Refresh failed"));
  render(<TranslationStrings />);
  toggle();
  fireEvent.change(field(), { target: { value: "Accepted draft" } });
  fireEvent.blur(field());
  await act(async () => {
    await state.accept?.();
  });
  toggle();
  toggle();
  expect(field().disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain(
    "translationEditor.refreshFailed",
  );
  state.refresh.mockResolvedValue(undefined);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "uiPatterns.retry" }));
  });
  expect(field().disabled).toBe(false);
  fireEvent.blur(field());
  expect(state.write).toHaveBeenCalledOnce();
});
