/** @vitest-environment jsdom */
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
import { TranslationStrings } from "./translation-strings";
import { TranslationIntentRecovery } from "./translation-intent-recovery";
import { createTranslationIntentClient } from "~/lib/translation-intent-client";
import type { TranslationIntentEnvelope } from "~/lib/translation-intent";

const state = vi.hoisted(() => ({
  queries: undefined as StaticTranslationQueryFixture | undefined,
  write: vi.fn(),
  refresh: vi.fn<() => Promise<void>>(),
  fail: undefined as undefined | (() => void),
  accept: undefined as undefined | (() => Promise<void>),
  languages: ["en", "zh"],
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
  return {
    api: {
      account: {
        me: queries.read("account.me", () => ({
          data: { id: "strings-actor", role: "ADMIN", canTranslate: true },
        })),
      },
      i18n: {
        managedLanguages: queries.read("i18n.managedLanguages", () => ({
          data: state.languages.map((code) => ({
            code,
            label: code,
            enabled: true,
          })),
        })),
      },
      localization: {
        strings: queries.read(
          "localization.strings",
          (input) => ({
            data: [
              {
                key: "common.title",
                en: "Original title",
                base:
                  (input as { locale: string }).locale === "en"
                    ? "Original title"
                    : "原标题",
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
          [
            { locale: "en", refLocales: [] },
            { locale: "zh", refLocales: [] },
          ],
        ),
        setString: {
          useMutation: () => ({
            mutateAsync: (input: {
              locale: string;
              key: string;
              value: string;
              intent: TranslationIntentEnvelope;
            }) =>
              new Promise((resolve, reject) => {
                state.write(input);
                state.fail = () => {
                  reject(new Error("Synthetic write failed"));
                };
                state.accept = async () => {
                  resolve({
                    ok: true,
                    receipt: {
                      status: "ACCEPTED",
                      version: 1,
                      intentId: input.intent.id,
                      operation: "localization.setString",
                      mode: input.intent.mode,
                      outcome:
                        input.intent.mode === "DRAFT"
                          ? "DRAFT_SUBMITTED"
                          : "PUBLISHED",
                      acceptedAt: new Date("2026-11-09"),
                      draftId:
                        input.intent.mode === "DRAFT"
                          ? "synthetic-draft"
                          : null,
                      cleared: false,
                      replayed: false,
                    },
                  });
                };
              }),
            isPending: false,
          }),
        },
      },
      translationIntent: {
        stop: {
          useMutation: () => ({
            mutateAsync: async ({ intentId }: { intentId: string }) => ({
              status: "STOPPED",
              version: 1,
              intentId,
              stoppedAt: new Date("2026-11-09"),
            }),
          }),
        },
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
        localization: {
          strings: { invalidate: state.refresh, fetch: async () => [] },
        },
        translationReview: { list: { invalidate: state.refresh } },
      }),
    },
  };
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
  state.languages = ["en", "zh"];
  state.write.mockReset();
  state.refresh.mockReset().mockResolvedValue(undefined);
  state.fail = undefined;
  state.accept = undefined;
  sessionStorage.clear();
  state.intentClient = createTranslationIntentClient(() => sessionStorage);
});
afterEach(() => {
  cleanup();
  state.queries!.client.clear();
});
const field = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: "common.title" });
const toggle = () =>
  fireEvent.click(screen.getByRole("button", { name: /^Common/ }));

it("falls back after language removal without reviving the old selection or discarding its draft", () => {
  const view = render(<TranslationStrings />);
  toggle();
  const select = () =>
    screen.getByRole<HTMLSelectElement>("combobox", {
      name: "localization.targetLanguage",
    });
  fireEvent.change(select(), { target: { value: "zh" } });
  fireEvent.change(field(), { target: { value: "保留的草稿" } });
  state.languages = ["en"];
  view.rerender(<TranslationStrings />);
  expect(select().value).toBe("en");
  expect(field().value).toBe("Original title");
  state.languages = ["en", "zh"];
  view.rerender(<TranslationStrings />);
  expect(select().value).toBe("en");
  fireEvent.change(select(), { target: { value: "zh" } });
  expect(field().value).toBe("保留的草稿");
  expect(state.write).not.toHaveBeenCalled();
});

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
  render(
    <>
      <TranslationIntentRecovery actorId="strings-actor" />
      <TranslationStrings />
    </>,
  );
  toggle();
  fireEvent.change(field(), { target: { value: "Unsaved English" } });
  fireEvent.blur(field());
  await act(async () => {
    state.fail?.();
  });
  toggle();
  toggle();
  expect(field().value).toBe("Unsaved English");
  expect(screen.getByText("Synthetic write failed")).toBeTruthy();
  // A failed response cannot authorize editing or a new UUID until Stop.
  expect(field().disabled).toBe(true);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "stop" }));
  });
  await waitFor(() => expect(field().disabled).toBe(false));
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
  render(
    <>
      <TranslationIntentRecovery actorId="strings-actor" />
      <TranslationStrings />
    </>,
  );
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
  expect(field().disabled).toBe(true);
  expect(field().value).toBe("Pending draft");
  expect(screen.getByText("Synthetic write failed")).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "stop" }));
  });
  await waitFor(() => expect(field().disabled).toBe(false));
  expect(field().value).toBe("Pending draft");
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
