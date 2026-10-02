// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
  permission: "ready",
  replies: false,
  sending: false,
  onSent: undefined as undefined | (() => Promise<void>),
}));
vi.mock("./student-portal", () => ({ Pager: () => null }));
vi.mock("~/trpc/react", () => ({
  api: {
    messaging: {
      permission: {
        useQuery: () => ({
          error:
            mocks.permission === "error"
              ? { message: "Permission unavailable" }
              : null,
          refetch: mocks.refetch,
          data:
            mocks.permission === "loading"
              ? undefined
              : {
                  groups: ["MANAGEMENT"],
                  source: "DEFAULT",
                  restricted: mocks.permission === "denied",
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
      inbox: {
        useQuery: () => ({
          data: mocks.replies
            ? ["1", "2"].map((id) => ({
                id: `message-${id}`,
                senderId: id,
                sender: `Sender ${id}`,
                senderUsername: `sender-${id}`,
                senderRole: "HEAD",
                recipient: "You",
                createdAt: new Date("2026-09-01T03:00:00Z"),
                incoming: true,
                canReply: true,
                readAt: new Date(),
                body: `Incoming message ${id}`,
              }))
            : [],
          refetch: mocks.refetch,
        }),
      },
      send: {
        useMutation: (options: { onSuccess: () => Promise<void> }) => {
          mocks.onSent = options.onSuccess;
          return {
            mutate: mocks.send,
            reset: mocks.reset,
            isPending: mocks.sending,
          };
        },
      },
      markRead: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.error = false;
  mocks.loading = false;
  mocks.more = false;
  mocks.permission = "ready";
  mocks.replies = false;
  mocks.sending = false;
  vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function ui(locale: "en" | "zh" = "en") {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
      timeZone="Asia/Shanghai"
    >
      <MessageInbox />
    </NextIntlClientProvider>
  );
}
function show(locale: "en" | "zh" = "en") {
  return render(ui(locale));
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

// General messages and replies are separate in-memory payloads, including retry keys.
it.each(["en", "zh"] as const)(
  "reveals reply context, restores drafts and returns focus in %s",
  (locale) => {
    mocks.replies = true;
    show(locale);
    const copy = locale === "en" ? en : zh;
    const body = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: copy.workflows.body,
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Pat @pat/ }));
    fireEvent.change(body, { target: { value: "Unsent general message" } });
    fireEvent.click(screen.getByRole("button", { name: copy.workflows.send }));
    const original = mocks.send.mock.calls[0]?.[0] as { clientKey: string };
    const [first, second] = screen.getAllByRole("button", {
      name: copy.workflows.reply,
    });
    fireEvent.click(first!);
    expect(body.value).toBe("");
    expect(document.activeElement).toBe(body);
    expect(screen.getByText(/Sender 1 \(@sender-1\)/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.change(body, { target: { value: "First reply" } });
    fireEvent.click(screen.getByRole("button", { name: copy.workflows.send }));
    const reply = mocks.send.mock.calls[1]?.[0] as { clientKey: string };
    fireEvent.click(second!);
    expect(body.value).toBe("");
    fireEvent.change(body, { target: { value: "Second reply" } });
    fireEvent.click(first!);
    expect(body.value).toBe("First reply");
    fireEvent.click(screen.getByRole("button", { name: copy.workflows.send }));
    expect(mocks.send.mock.calls[2]?.[0]).toMatchObject({
      body: "First reply",
      recipientIds: ["1"],
      clientKey: reply.clientKey,
    });
    fireEvent.click(
      screen.getByRole("button", { name: copy.messaging.cancelReply }),
    );
    expect(document.activeElement).toBe(first);
    expect(body.value).toBe("Unsent general message");
    fireEvent.click(screen.getByRole("button", { name: copy.workflows.send }));
    expect(mocks.send.mock.calls[3]?.[0]).toMatchObject({
      body: "Unsent general message",
      recipientIds: ["3"],
      clientKey: original.clientKey,
    });
  },
);
it.each(["loading", "error", "denied"])(
  "blocks sending/reply when permission is %s while retaining drafts",
  (permission) => {
    mocks.replies = true;
    const view = show();
    const body = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: en.workflows.body,
    });
    fireEvent.change(body, { target: { value: "Keep my draft" } });
    mocks.permission = permission;
    view.rerender(ui());
    expect(body.value).toBe("Keep my draft");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: en.workflows.send })
        .disabled,
    ).toBe(true);
    for (const reply of screen.getAllByRole<HTMLButtonElement>("button", {
      name: en.workflows.reply,
    }))
      expect(reply.disabled).toBe(true);
    if (permission === "error") {
      fireEvent.click(screen.getByRole("button", { name: en.messaging.retry }));
      expect(mocks.refetch).toHaveBeenCalledOnce();
    }
    expect(mocks.send).not.toHaveBeenCalled();
  },
);
it("locks reply transitions while the payload is being sent", () => {
  mocks.replies = true;
  const view = show();
  fireEvent.click(
    screen.getAllByRole("button", { name: en.workflows.reply })[0]!,
  );
  mocks.sending = true;
  view.rerender(ui());
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.messaging.cancelReply,
    }).disabled,
  ).toBe(true);
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: en.workflows.body,
    }).disabled,
  ).toBe(true);
});

it("restores the general draft after a successful reply and clears only that reply", async () => {
  mocks.replies = true;
  show();
  const body = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: en.workflows.body,
  });
  fireEvent.change(body, { target: { value: "General draft" } });
  const replies = screen.getAllByRole("button", { name: en.workflows.reply });
  fireEvent.click(replies[1]!);
  fireEvent.change(body, { target: { value: "Other reply" } });
  fireEvent.click(replies[0]!);
  fireEvent.change(body, { target: { value: "Delivered reply" } });
  await act(async () => {
    await mocks.onSent?.();
  });
  expect(body.value).toBe("General draft");
  expect(
    screen.queryByRole("button", { name: en.messaging.cancelReply }),
  ).toBeNull();
  fireEvent.click(replies[0]!);
  expect(body.value).toBe("");
  fireEvent.click(replies[1]!);
  expect(body.value).toBe("Other reply");
});

it("falls back to the restored composer when permission revokes the reply opener", () => {
  mocks.replies = true;
  const view = show();
  const body = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: en.workflows.body,
  });
  fireEvent.change(body, { target: { value: "General draft" } });
  fireEvent.click(
    screen.getAllByRole("button", { name: en.workflows.reply })[0]!,
  );
  mocks.permission = "denied";
  view.rerender(ui());
  fireEvent.click(
    screen.getByRole("button", { name: en.messaging.cancelReply }),
  );
  expect(body.value).toBe("General draft");
  expect(document.activeElement).toBe(body);
});
