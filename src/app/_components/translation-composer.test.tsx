// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { StaticTranslationQueryFixture } from "~/test/translation-query-bindings";
import type * as IntentClientModule from "~/lib/translation-intent-client";
import type {
  AcceptedTranslationReceipt,
  TranslationIntentEnvelope,
} from "~/lib/translation-intent";
type ComposerInput = Record<string, unknown> & {
  intent: TranslationIntentEnvelope;
};
type ComposerResult = { ok: true; receipt: AcceptedTranslationReceipt };
const state = vi.hoisted(() => ({
  queries: undefined as StaticTranslationQueryFixture | undefined,
  role: "COORDINATOR",
  mutate: vi.fn<(input: ComposerInput) => Promise<ComposerResult>>(),
  reset: vi.fn(),
  pending: false,
  error: null as null | { message: string },
  intentClient: undefined as
    IntentClientModule.TranslationIntentClient | undefined,
}));
vi.mock("~/lib/translation-intent-client", async (importOriginal) => {
  const actual = await importOriginal<typeof IntentClientModule>();
  return {
    ...actual,
    get translationIntentClient() {
      return state.intentClient!;
    },
  };
});
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/trpc/react", async () => {
  const { createStaticTranslationQueryFixture } =
    await import("~/test/translation-query-bindings");
  const queries = createStaticTranslationQueryFixture();
  state.queries = queries;
  const mutation = {
    useMutation: () => ({
      mutateAsync: state.mutate,
      reset: state.reset,
      isPending: state.pending,
      error: state.error,
    }),
  };
  const empty = (name: string) =>
    queries.read(`home.${name}`, () => ({ data: [] }));
  return {
    api: {
      account: {
        me: queries.read("account.me", () => ({
          data: { id: "composer-actor", role: state.role, canTranslate: true },
        })),
      },
      i18n: {
        managedLanguages: queries.read("i18n.managedLanguages", () => ({
          data: [
            { code: "en", label: "English" },
            { code: "zh", label: "中文" },
          ],
        })),
      },
      home: {
        content: queries.read(
          "home.content",
          () => ({
            data: [
              {
                key: "tagline",
                kind: "text",
                default: "Original",
                override: null,
              },
            ],
          }),
          [{ locale: "en" }, { locale: "zh" }],
        ),
        news: empty("news"),
        sections: empty("sections"),
        pages: empty("pages"),
        setContent: mutation,
        setNewsTranslation: mutation,
        setSectionTranslation: mutation,
        setPageTitle: mutation,
      },
      useUtils: () => ({
        client: {
          translationIntent: {
            get: {
              query: async ({ intentId }: { intentId: string }) => ({
                status: "NOT_RECORDED",
                version: 1,
                intentId,
              }),
            },
          },
        },
        translationIntent: {
          get: {
            fetch: async ({ intentId }: { intentId: string }) => ({
              status: "NOT_RECORDED",
              version: 1,
              intentId,
            }),
          },
        },
        translationReview: { list: { invalidate: vi.fn() } },
        home: { invalidate: vi.fn(), content: { fetch: async () => [] } },
      }),
    },
  };
});
import { TranslationComposer } from "./translation-composer";
import { createTranslationIntentClient } from "~/lib/translation-intent-client";
afterEach(() => {
  cleanup();
  state.queries!.client.clear();
});
function render(ui: ReactNode) {
  state.queries!.prepare();
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={state.queries!.client}>
      {children}
    </QueryClientProvider>
  );
  const view = rtlRender(wrap(ui));
  return {
    ...view,
    rerender: (next: ReactNode) => {
      act(() => {
        state.queries!.prepare();
        view.rerender(wrap(next));
      });
    },
  };
}
beforeEach(() => {
  state.queries!.reset();
  vi.clearAllMocks();
  state.role = "COORDINATOR";
  state.pending = false;
  state.error = null;
  sessionStorage.clear();
  state.intentClient = createTranslationIntentClient(() => sessionStorage);
  state.mutate.mockImplementation(async (input): Promise<ComposerResult> => ({
    ok: true,
    receipt: {
      status: "ACCEPTED",
      version: 1,
      intentId: input.intent.id,
      operation: "home.setContent",
      mode: input.intent.mode,
      outcome: input.intent.mode === "DRAFT" ? "DRAFT_SUBMITTED" : "PUBLISHED",
      acceptedAt: new Date("2026-11-09"),
      draftId: input.intent.mode === "DRAFT" ? "synthetic-draft" : null,
      cleared: false,
      replayed: false,
    },
  }));
});
it("submits a Coordinator translation with its selected destination", async () => {
  const anyId: unknown = expect.any(String);
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
    intent: { version: 1, id: anyId, actorId: "composer-actor", mode: "DRAFT" },
  });
  await screen.findByText("submitted");
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("translation").disabled,
    ).toBe(false),
  );
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
it("restores independent drafts after locale and content-type round trips", () => {
  render(<TranslationComposer />);
  fireEvent.change(screen.getByLabelText("target"), {
    target: { value: "tagline" },
  });
  fireEvent.change(screen.getByLabelText("translation"), {
    target: { value: "English draft" },
  });
  fireEvent.change(screen.getByLabelText("locale"), {
    target: { value: "zh" },
  });
  fireEvent.change(screen.getByLabelText("target"), {
    target: { value: "tagline" },
  });
  fireEvent.change(screen.getByLabelText("translation"), {
    target: { value: "中文草稿" },
  });
  fireEvent.change(screen.getByLabelText("locale"), {
    target: { value: "en" },
  });
  expect(screen.getByLabelText<HTMLTextAreaElement>("translation").value).toBe(
    "English draft",
  );
  fireEvent.change(screen.getByLabelText("contentType"), {
    target: { value: "news" },
  });
  fireEvent.change(screen.getByLabelText("contentType"), {
    target: { value: "content" },
  });
  expect(screen.getByLabelText<HTMLTextAreaElement>("translation").value).toBe(
    "English draft",
  );
  fireEvent.change(screen.getByLabelText("locale"), {
    target: { value: "zh" },
  });
  expect(screen.getByLabelText<HTMLTextAreaElement>("translation").value).toBe(
    "中文草稿",
  );
  expect(state.mutate).not.toHaveBeenCalled();
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
it("locks input while a draft submission is pending", async () => {
  let finish!: () => void;
  const response = state.mutate.getMockImplementation()!;
  state.mutate.mockImplementation(async (input) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return response(input);
  });
  render(<TranslationComposer />);
  fireEvent.change(screen.getByLabelText("target"), {
    target: { value: "tagline" },
  });
  fireEvent.click(screen.getByRole("button", { name: "submitDraft" }));
  expect(screen.getByLabelText<HTMLSelectElement>("locale").disabled).toBe(
    true,
  );
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("translation").disabled,
  ).toBe(true);
  await act(async () => {
    finish();
  });
  await screen.findByText("submitted");
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("translation").disabled,
    ).toBe(false),
  );
});
