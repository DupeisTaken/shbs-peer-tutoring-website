// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { UnsubscribeForm } from "./unsubscribe-form";

const request = vi.fn<typeof fetch>();
const response = (body: unknown, ok = true) =>
  ({ ok, json: async () => body }) as Response;
const ready = (category: "messages" | "info" = "messages") =>
  response({ status: "ready", category });
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function view(token?: string, locale: "en" | "zh" = "en") {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
    >
      <UnsubscribeForm token={token} />
    </NextIntlClientProvider>
  );
}
function submitButton() {
  return screen.getByRole("button", { name: /Unsubscribe from/ });
}
function selectAll() {
  fireEvent.click(
    screen.getByRole("radio", { name: /^All optional notification emails/ }),
  );
}

beforeEach(() => {
  request.mockReset();
  vi.stubGlobal("fetch", request);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("public unsubscribe confirmation", () => {
  it("shows a generic invalid link without a request when no token is present", () => {
    render(view());
    expect(screen.getByText(en.unsubscribe.invalidTitle)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("only reads on open, defaults to the linked category, and explains account-wide effects", async () => {
    request.mockResolvedValueOnce(ready());
    render(view("opaque&token"));
    await screen.findByText(en.unsubscribe.choiceTitle);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe(
      "/api/email/unsubscribe?token=opaque%26token",
    );
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    expect(
      screen.getByRole<HTMLInputElement>("radio", {
        name: /^Private-message notifications/,
      }).checked,
    ).toBe(true);
    expect(screen.getByText(en.unsubscribe.accountWide)).toBeTruthy();
    expect(screen.getByText(en.unsubscribe.securityHelp)).toBeTruthy();
    expect(document.body.textContent).not.toContain("opaque&token");
  });

  it("recovers a failed read through GET retry without writing", async () => {
    request.mockRejectedValueOnce(new Error("private detail"));
    request.mockResolvedValueOnce(ready("info"));
    render(view("token"));
    await screen.findByText(en.unsubscribe.loadErrorTitle);
    expect(document.body.textContent).not.toContain("private detail");
    fireEvent.click(screen.getByRole("button", { name: en.unsubscribe.retry }));
    await screen.findByRole("radio", { name: /^Program notifications/ });
    expect(request.mock.calls.every(([, options]) => !options?.method)).toBe(
      true,
    );
  });

  it("renders invalid capabilities generically, including an HTTP error response", async () => {
    request.mockResolvedValueOnce(response({ status: "invalid" }, false));
    render(view("expired-token"));
    await screen.findByText(en.unsubscribe.invalidTitle);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(document.body.textContent).not.toContain("expired-token");
  });

  it("rejects a malformed read response and offers recovery", async () => {
    request.mockResolvedValueOnce(
      response({ status: "ready", category: "security" }),
    );
    render(view("token"));
    await screen.findByText(en.unsubscribe.loadErrorTitle);
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("requires explicit confirmation and excludes same-turn duplicate writes", async () => {
    const mutation = deferred();
    request.mockResolvedValueOnce(ready());
    request.mockReturnValueOnce(mutation.promise);
    render(view("capability"));
    await screen.findByText(en.unsubscribe.choiceTitle);
    const form = submitButton().closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ token: "capability", scope: "category" }),
      credentials: "omit",
    });
    expect(screen.getByRole("group").getAttribute("aria-busy")).toBe("true");
    expect(
      screen.getByRole("button", {
        name: en.unsubscribe.saving,
      }).matches(":disabled"),
    ).toBe(true);
    await act(async () =>
      mutation.resolve(
        response({ status: "unsubscribed", category: "messages" }),
      ),
    );
    await screen.findByText(en.unsubscribe.successTitle);
    expect(
      screen
        .getByRole("link", { name: en.unsubscribe.home })
        .getAttribute("href"),
    ).toBe("/");
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("preserves all-email choice on failure and retries only the deliberate selection", async () => {
    request.mockResolvedValueOnce(ready());
    request.mockRejectedValueOnce(new Error("transport failed"));
    request.mockResolvedValueOnce(response({ status: "unsubscribed" }));
    render(view("token"));
    await screen.findByText(en.unsubscribe.choiceTitle);
    selectAll();
    fireEvent.click(submitButton());
    await screen.findByText(en.unsubscribe.saveError);
    expect(
      screen.getByRole<HTMLInputElement>("radio", {
        name: /^All optional notification emails/,
      }).checked,
    ).toBe(true);
    fireEvent.click(submitButton());
    await screen.findByText(en.unsubscribe.successAll);
    expect(
      request.mock.calls.slice(1).map(([, options]) => options?.body),
    ).toEqual([
      JSON.stringify({ token: "token", scope: "all" }),
      JSON.stringify({ token: "token", scope: "all" }),
    ]);
  });

  it("allows an already-unsubscribed category to stop the other optional category", async () => {
    request.mockResolvedValueOnce(
      response({ status: "already-unsubscribed", category: "info" }),
    );
    request.mockResolvedValueOnce(response({ status: "unsubscribed" }));
    render(view("token"));
    await screen.findByText(en.unsubscribe.choiceTitle);
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    selectAll();
    fireEvent.click(submitButton());
    await screen.findByText(en.unsubscribe.successAll);
  });

  it("handles a capability becoming invalid between read and confirmation", async () => {
    request.mockResolvedValueOnce(ready());
    request.mockResolvedValueOnce(response({ status: "invalid" }, false));
    render(view("token"));
    await screen.findByText(en.unsubscribe.choiceTitle);
    fireEvent.click(submitButton());
    await screen.findByText(en.unsubscribe.invalidTitle);
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("aborts an old link read and ignores its late result when the token changes", async () => {
    const oldRead = deferred();
    request.mockReturnValueOnce(oldRead.promise);
    request.mockResolvedValueOnce(ready("info"));
    const ui = render(view("old"));
    const signal = request.mock.calls[0]?.[1]?.signal;
    ui.rerender(view("new"));
    await screen.findByRole("radio", { name: /^Program notifications/ });
    expect(signal?.aborted).toBe(true);
    await act(async () => oldRead.resolve(ready("messages")));
    expect(
      screen.queryByRole("radio", { name: /^Private-message notifications/ }),
    ).toBeNull();
  });

  it("aborts in-flight submission on unmount without applying a stale result", async () => {
    const mutation = deferred();
    request.mockResolvedValueOnce(ready());
    request.mockReturnValueOnce(mutation.promise);
    const ui = render(view("token"));
    await screen.findByText(en.unsubscribe.choiceTitle);
    fireEvent.click(submitButton());
    const signal = request.mock.calls[1]?.[1]?.signal;
    ui.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      mutation.resolve(response({ status: "unsubscribed" })),
    );
    await waitFor(() =>
      expect(screen.queryByText(en.unsubscribe.successTitle)).toBeNull(),
    );
  });

  it("renders the same choices and safety explanation in Chinese", async () => {
    request.mockResolvedValueOnce(ready("info"));
    render(view("token", "zh"));
    await screen.findByText(zh.unsubscribe.choiceTitle);
    expect(screen.getByText(zh.unsubscribe.accountWide)).toBeTruthy();
    expect(screen.getByText(zh.unsubscribe.securityHelp)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: zh.unsubscribe.confirmCategory }),
    ).toBeTruthy();
  });
});
