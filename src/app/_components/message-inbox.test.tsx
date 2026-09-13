// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { MessageInbox } from "./message-inbox";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  reset: vi.fn(),
  refetch: vi.fn(),
  error: false,
  loading: false,
  more: false,
}));
vi.mock("./student-portal", () => ({ Pager: () => null }));
vi.mock("~/trpc/react", () => ({
  api: {
    messaging: {
      permission: {
        useQuery: () => ({
          data: {
            groups: ["MANAGEMENT"],
            source: "DEFAULT",
            restricted: false,
          },
        }),
      },
      recipients: {
        useQuery: ({ search, page }: { search: string; page: number }) => ({
          data: {
            people: (page
              ? [
                  {
                    id: "4",
                    name: "Second Page",
                    username: "second",
                    role: "HEAD",
                  },
                ]
              : [
                  {
                    id: "1",
                    name: "Alex",
                    username: "alex-one",
                    role: "STUDENT",
                  },
                  { id: "2", name: "Alex", username: "alex-two", role: "HEAD" },
                  { id: "3", name: "Pat", username: "pat", role: "CREW" },
                ]
            ).filter((c) =>
              `${c.name} ${c.username}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            ),
            more: mocks.more,
          },
          error: mocks.error ? { message: "Contact fetch failed" } : null,
          isFetching: mocks.loading,
          refetch: mocks.refetch,
        }),
      },
      inbox: { useQuery: () => ({ data: [], refetch: mocks.refetch }) },
      send: { useMutation: () => ({ mutate: mocks.send, reset: mocks.reset }) },
      markRead: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.error = false;
  mocks.loading = false;
  mocks.more = false;
});
afterEach(cleanup);
function show(locale: "en" | "zh" = "en") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
      timeZone="Asia/Shanghai"
    >
      <MessageInbox />
    </NextIntlClientProvider>,
  );
}
it.each([
  { locale: "en" as const, messages: en },
  { locale: "zh" as const, messages: zh },
])(
  "localizes disclosure and disambiguates recipient identities in $locale",
  ({ locale, messages }) => {
    show(locale);
    expect(
      screen.getByRole("button", { name: messages.workflows.send }),
    ).toBeTruthy();
    expect(screen.getByText(messages.messaging.disclosure)).toBeTruthy();
    expect(
      screen.getByRole("checkbox", {
        name: `Alex @alex-one · ${messages.admin.users.roles.STUDENT}`,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", {
        name: `Alex @alex-two · ${messages.admin.users.roles.HEAD}`,
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  },
);
it("retains selections across searches, exposes removal, and sends private batches with disclosure", () => {
  show();
  fireEvent.click(screen.getByRole("checkbox", { name: /Alex @alex-one/ }));
  fireEvent.change(screen.getByRole("textbox", { name: en.workflows.search }), {
    target: { value: "Pat" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /Pat @pat/ }));
  expect(
    screen.getByRole("button", { name: "Remove Alex (@alex-one)" }),
  ).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: en.workflows.body }), {
    target: { value: "Hello separately" },
  });
  fireEvent.click(screen.getByRole("button", { name: en.workflows.send }));
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({
      recipientIds: ["1", "3"],
      body: "Hello separately",
      disclosureVersion: 1,
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Alex (@alex-one)" }),
  );
  expect(
    screen.queryByRole("button", { name: "Remove Alex (@alex-one)" }),
  ).toBeNull();
});
it("keeps the idempotency key for a retry and rotates it only for payload changes", () => {
  show();
  fireEvent.click(screen.getByRole("checkbox", { name: /Pat @pat/ }));
  fireEvent.change(screen.getByRole("textbox", { name: en.workflows.body }), {
    target: { value: "First body" },
  });
  const button = screen.getByRole("button", { name: en.workflows.send });
  fireEvent.click(button);
  fireEvent.click(button);
  const first = mocks.send.mock.calls[0]?.[0] as { clientKey: string };
  const retry = mocks.send.mock.calls[1]?.[0] as { clientKey: string };
  expect(retry.clientKey).toBe(first.clientKey);
  fireEvent.change(screen.getByRole("textbox", { name: en.workflows.body }), {
    target: { value: "Changed body" },
  });
  fireEvent.click(button);
  expect(
    (mocks.send.mock.calls[2]?.[0] as { clientKey: string }).clientKey,
  ).not.toBe(first.clientKey);
});
it("does not implicitly send while a keyboard user searches or explores recipient checkboxes", () => {
  show();
  const checkbox = screen.getByRole("checkbox", { name: /Pat @pat/ });
  fireEvent.click(checkbox);
  fireEvent.change(screen.getByRole("textbox", { name: en.workflows.body }), {
    target: { value: "Draft ready to send" },
  });
  expect(
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: en.workflows.search }),
      { key: "Enter" },
    ),
  ).toBe(false);
  expect(fireEvent.keyDown(checkbox, { key: "Enter" })).toBe(false);
  expect(mocks.send).not.toHaveBeenCalled();
});
it("paginates recipients while retaining selections and resets paging for a new search", () => {
  mocks.more = true;
  show();
  fireEvent.click(screen.getByRole("checkbox", { name: /Pat @pat/ }));
  fireEvent.click(screen.getByRole("button", { name: en.messaging.next }));
  expect(screen.getByRole("checkbox", { name: /Second Page/ })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Remove Pat (@pat)" }),
  ).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: en.workflows.search }), {
    target: { value: "Alex" },
  });
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
});
it("provides explicit loading, error retry and no-match states", () => {
  mocks.loading = true;
  mocks.error = true;
  show();
  expect(screen.getByText(en.messaging.loading)).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain(
    "Contact fetch failed",
  );
  fireEvent.click(screen.getByRole("button", { name: en.messaging.retry }));
  expect(mocks.refetch).toHaveBeenCalled();
  cleanup();
  mocks.loading = false;
  mocks.error = false;
  show();
  fireEvent.change(screen.getByRole("textbox", { name: en.workflows.search }), {
    target: { value: "Nobody" },
  });
  expect(screen.getByText(en.messaging.noMatches)).toBeTruthy();
});
