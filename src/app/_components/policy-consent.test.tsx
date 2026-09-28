// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import de from "../../../messages/de.json";
import el from "../../../messages/el.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import ja from "../../../messages/ja.json";
import ko from "../../../messages/ko.json";
import { PolicyConsent } from "./policy-consent";

const mocks = vi.hoisted(() => ({
  policy: vi.fn(),
  refetch: vi.fn(),
  accept: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    student: {
      policy: { useQuery: mocks.policy },
      acceptPolicy: { useMutation: () => ({ mutate: mocks.accept }) },
    },
  },
}));

const documents = [
  {
    locale: "en",
    title: "Tutor policy",
    body: "## Published rules\nEnglish policy.",
    version: "v2",
  },
  {
    locale: "zh",
    title: "导师政策",
    body: "## 已发布的规则\n中文政策。",
    version: "v2",
  },
];
let query: {
  data: { accepted: boolean; revision: string; documents: typeof documents };
  isFetching: boolean;
  error: Error | null;
  refetch: typeof mocks.refetch;
};
function subject(
  locale = "en",
  // Locales can omit keys served by the application's English fallback.
  messages: AbstractIntlMessages = en,
  slug: "tutor-policy" | "tutee-policy" = "tutor-policy",
) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <PolicyConsent slug={slug} />
    </NextIntlClientProvider>
  );
}
function open(name = "current policy") {
  const trigger = screen.getByRole("button", { name });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}
beforeEach(() => {
  vi.clearAllMocks();
  query = {
    data: { accepted: true, revision: "v2", documents },
    isFetching: false,
    error: null,
    refetch: mocks.refetch,
  };
  mocks.policy.mockImplementation(() => query);
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    },
  });
});
afterEach(cleanup);

it("keeps the link when a deployment overrides the legacy plain-text message", () => {
  render(
    subject("en", {
      ...en,
      workflows: { ...en.workflows, accepted: "Custom acceptance message." },
    }),
  );
  open();
  expect(screen.getByRole("dialog", { name: "Tutor policy" })).toBeTruthy();
});

it.each(Object.entries({ en, zh, de, el, es, fr, ja, ko }))(
  "opens localized published text with English fallback in %s",
  (locale, messages) => {
    render(subject(locale, messages));
    expect(screen.queryByRole("dialog")).toBeNull();
    open(locale === "zh" ? "当前政策" : "current policy");
    const dialog = screen.getByRole("dialog", {
      name: locale === "zh" ? "导师政策" : "Tutor policy",
    });
    expect(
      within(dialog).getByText(
        locale === "zh" ? "中文政策。" : "English policy.",
      ),
    ).toBeTruthy();
    expect(within(dialog).getByText("v2")).toBeTruthy();
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  },
);

it.each(["button", "escape", "backdrop"])(
  "dismisses by %s and restores focus",
  (method) => {
    render(subject());
    const trigger = open();
    const dialog = screen.getByRole("dialog");
    // Content clicks must not dismiss the reader.
    fireEvent.click(screen.getByText("English policy."));
    expect(screen.getByRole("dialog")).toBeTruthy();
    if (method === "button")
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    else if (method === "escape")
      fireEvent(
        dialog,
        new Event("cancel", { bubbles: false, cancelable: true }),
      );
    else fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    open();
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
  },
);

it("hides stale text while refreshing and keeps a newer unaccepted publication readable", () => {
  const view = render(subject());
  open();
  query = { ...query, isFetching: true };
  view.rerender(subject());
  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.queryByText("English policy.")).toBeNull();
  query = {
    ...query,
    isFetching: false,
    data: {
      accepted: false,
      revision: "v3",
      documents: [
        {
          locale: "en",
          title: "New policy",
          body: "Latest rules.",
          version: "v3",
        },
      ],
    },
  };
  view.rerender(subject());
  expect(screen.getByRole("dialog", { name: "New policy" })).toBeTruthy();
  expect(screen.getByText("Latest rules.")).toBeTruthy();
  expect(mocks.accept).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(
    screen.getByRole("textbox", { name: en.workflows.signature }),
  ).toBeTruthy();
});

it("shows refresh failures without stale content and retries in the same popup", () => {
  const view = render(subject());
  open();
  query = { ...query, error: new Error("Network failed") };
  view.rerender(subject());
  expect(screen.getByRole("alert").textContent).toBe(
    en.workflow.policyLoadError,
  );
  expect(screen.queryByText("English policy.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en.workflow.retry }));
  expect(mocks.refetch).toHaveBeenCalledTimes(2);
  query = { ...query, error: null };
  view.rerender(subject());
  expect(screen.getByText("English policy.")).toBeTruthy();
});

it("falls back to English for a blank translation and handles missing publications", () => {
  query.data.documents = [{ ...documents[1]!, body: " " }, documents[0]!];
  const view = render(subject("zh", zh));
  open("当前政策");
  expect(screen.getByText("English policy.")).toBeTruthy();
  query = { ...query, data: { ...query.data, documents: [] } };
  view.rerender(subject("zh", zh));
  expect(screen.getByRole("alert")).toBeTruthy();
});

it("requests the relevant tutee policy when used without gated children", () => {
  render(subject("en", en, "tutee-policy"));
  open();
  expect(mocks.policy).toHaveBeenCalledWith({ slug: "tutee-policy" });
});
