// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "COORDINATOR",
  mutate: vi.fn(),
  reset: vi.fn(),
  pending: false,
  error: null as null | { message: string },
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/trpc/react", () => {
  const mutation = {
    useMutation: () => ({
      mutate: state.mutate,
      reset: state.reset,
      isPending: state.pending,
      error: state.error,
    }),
  };
  const empty = { useQuery: () => ({ data: [] }) };
  return {
    api: {
      account: {
        me: {
          useQuery: () => ({ data: { role: state.role, canTranslate: true } }),
        },
      },
      i18n: {
        managedLanguages: {
          useQuery: () => ({
            data: [
              { code: "en", label: "English" },
              { code: "zh", label: "中文" },
            ],
          }),
        },
      },
      home: {
        content: {
          useQuery: () => ({
            data: [
              {
                key: "tagline",
                kind: "text",
                default: "Original",
                override: null,
              },
            ],
          }),
        },
        news: empty,
        sections: empty,
        pages: empty,
        setContent: mutation,
        setNewsTranslation: mutation,
        setSectionTranslation: mutation,
        setPageTitle: mutation,
      },
      useUtils: () => ({
        translationReview: { list: { invalidate: vi.fn() } },
        home: { invalidate: vi.fn() },
      }),
    },
  };
});
import { TranslationComposer } from "./translation-composer";
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.role = "COORDINATOR";
  state.pending = false;
  state.error = null;
});
it("submits a Coordinator translation with its selected destination", () => {
  render(<TranslationComposer />);
  fireEvent.change(screen.getByLabelText("target"), {
    target: { value: "tagline" },
  });
  fireEvent.change(screen.getByLabelText<HTMLTextAreaElement>("translation"), {
    target: { value: "Proposed text" },
  });
  fireEvent.click(
    screen.getByRole<HTMLButtonElement>("button", { name: "submitDraft" }),
  );
  expect(state.mutate).toHaveBeenCalledWith({
    locale: "en",
    key: "tagline",
    value: "Proposed text",
  });
});
it("clears the destination and text when changing language", () => {
  render(<TranslationComposer />);
  fireEvent.change(screen.getByLabelText("target"), {
    target: { value: "tagline" },
  });
  fireEvent.change(screen.getByLabelText<HTMLSelectElement>("locale"), {
    target: { value: "zh" },
  });
  expect(screen.getByLabelText<HTMLTextAreaElement>("translation").value).toBe(
    "",
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "submitDraft" })
      .disabled,
  ).toBe(true);
  expect(state.reset).toHaveBeenCalled();
});
it("labels direct Admin edits as publication and displays server failures", () => {
  state.role = "ADMIN";
  state.error = { message: "Destination changed" };
  render(<TranslationComposer />);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "publishEdit" }),
  ).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toBe("Destination changed");
});
it("locks input while a draft submission is pending", () => {
  state.pending = true;
  render(<TranslationComposer />);
  expect(screen.getByLabelText<HTMLSelectElement>("locale").disabled).toBe(
    true,
  );
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("translation").disabled,
  ).toBe(true);
});
