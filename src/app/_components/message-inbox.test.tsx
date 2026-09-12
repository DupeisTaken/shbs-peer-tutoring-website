// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { MessageInbox } from "./message-inbox";

vi.mock("./student-portal", () => ({ Pager: () => null }));
vi.mock("~/trpc/react", () => ({
  api: {
    messaging: {
      recipients: {
        useQuery: () => ({
          data: [
            { id: "1", name: "Alex", role: "STUDENT" },
            { id: "2", name: "Lee", role: "HEAD" },
            { id: "3", name: "Pat", role: "CREW" },
          ],
        }),
      },
      inbox: { useQuery: () => ({ data: [], refetch: vi.fn() }) },
      send: { useMutation: () => ({ mutate: vi.fn() }) },
      markRead: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));
afterEach(cleanup);

it.each([
  { locale: "en", messages: en },
  { locale: "zh", messages: zh },
])(
  "localizes message controls and account roles in $locale",
  ({ locale, messages }) => {
    render(
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="Asia/Shanghai"
      >
        <MessageInbox />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole("button", { name: messages.workflows.send }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", {
        name: `Alex · ${messages.admin.users.roles.STUDENT}`,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", {
        name: `Lee · ${messages.admin.users.roles.HEAD}`,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", {
        name: `Pat · ${messages.admin.users.roles.CREW}`,
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: /STUDENT|HEAD|CREW/ }),
    ).toBeNull();
  },
);
