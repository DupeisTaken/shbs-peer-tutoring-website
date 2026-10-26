// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { RequestAppealForm } from "./request-appeal-form";
const fetchMock = vi.fn<typeof fetch>();
const ready = {
  status: "ready",
  kind: "tutor",
  recordedTime: "2026-10-13T03:00:00.000Z",
  timeZone: "Asia/Shanghai",
  appealStatus: null,
};
function response(data: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => data } as Response);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function ui(token = "synthetic-capability", locale: "en" | "zh" = "en") {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
      timeZone="Asia/Shanghai"
    >
      <RequestAppealForm token={token} />
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it.each(["en", "zh"] as const)(
  "only reads the limited capability on initial %s page load",
  async (locale) => {
    fetchMock.mockImplementation(() => response(ready));
    render(ui(undefined, locale));
    await screen.findByRole("textbox");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/api/request-appeal?token=",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
    expect(screen.getByText(/Asia\/Shanghai/)).toBeTruthy();
    expect(
      screen
        .getByRole("button", {
          name:
            locale === "en" ? en.requestAppeal.submit : zh.requestAppeal.submit,
        })
        .hasAttribute("disabled"),
    ).toBe(true);
  },
);
it("guards same-tick submission, retains failed text and retries the identical appeal", async () => {
  const send = deferred<Response>();
  fetchMock
    .mockImplementationOnce(() => response(ready))
    .mockImplementationOnce(() => send.promise)
    .mockImplementationOnce(() => response({ status: "submitted" }))
    .mockImplementationOnce(() =>
      response({ ...ready, appealStatus: "PENDING" }),
    );
  render(ui());
  const input = await screen.findByRole<HTMLTextAreaElement>("textbox");
  fireEvent.change(input, {
    target: { value: "Please review this synthetic request." },
  });
  const button = screen.getByRole("button", { name: en.requestAppeal.submit });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(input.disabled).toBe(false);
  expect(input.closest("fieldset")?.disabled).toBe(true);
  await act(async () =>
    send.resolve(await response({ status: "unavailable" }, false)),
  );
  await screen.findByText(en.requestAppeal.failed);
  expect(input.value).toBe("Please review this synthetic request.");
  fireEvent.click(
    screen.getByRole("button", { name: en.requestAppeal.submit }),
  );
  await screen.findByText(en.requestAppeal.submitted);
  const writes = fetchMock.mock.calls.filter(
    ([, options]) => options?.method === "POST",
  );
  expect(writes).toHaveLength(2);
  expect(writes[0]?.[1]?.body).toBe(writes[1]?.[1]?.body);
});
it("keeps an accepted write locked after a failed status read; recovery only GETs", async () => {
  fetchMock
    .mockImplementationOnce(() => response(ready))
    .mockImplementationOnce(() => response({ status: "submitted" }))
    .mockImplementationOnce(() => response({ status: "unavailable" }, false))
    .mockImplementationOnce(() =>
      response({ ...ready, appealStatus: "PENDING" }),
    );
  render(ui());
  fireEvent.change(await screen.findByRole("textbox"), {
    target: { value: "Please review this synthetic request." },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.requestAppeal.submit }),
  );
  await screen.findByText(en.requestAppeal.readFailed);
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en.requestAppeal.retry }));
  await screen.findByText(en.requestAppeal.statusPending);
  expect(
    fetchMock.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(1);
});
it("explains that a changed-body duplicate retained the already-recorded appeal", async () => {
  fetchMock
    .mockImplementationOnce(() => response(ready))
    .mockImplementationOnce(() => response({ status: "already-submitted" }))
    .mockImplementationOnce(() =>
      response({ ...ready, appealStatus: "PENDING" }),
    );
  render(ui());
  fireEvent.change(await screen.findByRole("textbox"), {
    target: { value: "Different text after a lost response." },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.requestAppeal.submit }),
  );
  await screen.findByText(en.requestAppeal.existing);
  expect(screen.queryByRole("textbox")).toBeNull();
});
it("shows an existing appeal as already recorded after a fresh GET", async () => {
  fetchMock.mockImplementation(() =>
    response({ ...ready, appealStatus: "DECLINED" }),
  );
  render(ui());
  await screen.findByText(en.requestAppeal.existing);
  expect(screen.getByText(en.requestAppeal.statusDeclined)).toBeTruthy();
  expect(
    fetchMock.mock.calls.some(([, options]) => options?.method === "POST"),
  ).toBe(false);
});
it.each(["en", "zh"] as const)(
  "separates the submission receipt from each %s review outcome",
  async (locale) => {
    const messages = locale === "en" ? en : zh;
    for (const [appealStatus, text, color] of [
      ["DECLINED", messages.requestAppeal.statusDeclined, "bg-amber-50"],
      ["PENDING", messages.requestAppeal.statusPending, "bg-slate-50"],
      ["CLEARED", messages.requestAppeal.statusCleared, "bg-emerald-50"],
    ]) {
      fetchMock.mockImplementation(() => response({ ...ready, appealStatus }));
      const page = render(ui("synthetic-capability", locale));
      const decision = await screen.findByText(text!);
      const receipt = screen
        .getByText(messages.requestAppeal.submitted)
        .closest('[role="status"]');
      expect(decision.closest('[role="status"]')).not.toBe(receipt);
      expect(
        decision.closest('[role="status"]')?.classList.contains(color!),
      ).toBe(true);
      expect(receipt?.classList.contains("bg-slate-50")).toBe(true);
      expect(screen.queryByRole("textbox")).toBeNull();
      page.unmount();
    }
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === "POST"),
    ).toBe(false);
  },
);

it("labels the appeal once while preserving its guidance and pending fieldset", async () => {
  fetchMock.mockImplementation(() => response(ready));
  render(ui());
  const input = await screen.findByRole("textbox", {
    name: en.requestAppeal.body,
  });
  expect(screen.getAllByText(en.requestAppeal.body)).toHaveLength(1);
  expect(input.getAttribute("aria-describedby")).toBe("request-appeal-help");
  expect(input.closest("fieldset")).toBeTruthy();
});
it("treats throttling as recoverable instead of invalidating the capability", async () => {
  fetchMock
    .mockImplementationOnce(() => response({ status: "throttled" }, false))
    .mockImplementationOnce(() => response(ready));
  render(ui());
  await screen.findByText(en.requestAppeal.error);
  expect(screen.queryByText(en.requestAppeal.invalid)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en.requestAppeal.retry }));
  await screen.findByRole("textbox");
});
it("retains the appeal text after throttled submission", async () => {
  fetchMock
    .mockImplementationOnce(() => response(ready))
    .mockImplementationOnce(() => response({ status: "throttled" }, false));
  render(ui());
  const input = await screen.findByRole<HTMLTextAreaElement>("textbox");
  fireEvent.change(input, {
    target: { value: "Please review this synthetic request." },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.requestAppeal.submit }),
  );
  await screen.findByText(en.requestAppeal.failed);
  expect(input.value).toBe("Please review this synthetic request.");
});
it("uses neutral recovery for invalid capabilities and never reflects unrelated evidence", async () => {
  fetchMock.mockImplementation(() =>
    response(
      {
        status: "invalid",
        body: "Private original answer",
        reason: "Private staff reason",
        email: "private@example.test",
      },
      false,
    ),
  );
  render(ui());
  await screen.findByText(en.requestAppeal.invalid);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(document.body.textContent).not.toContain("Private");
  expect(document.body.textContent).not.toContain("private@example.test");
});
it("keeps a late response from an old capability out of the next draft", async () => {
  const old = deferred<Response>();
  fetchMock
    .mockImplementationOnce(() => old.promise)
    .mockImplementationOnce(() =>
      response({ ...ready, kind: "tutee", recordedTime: null }),
    );
  const view = render(ui("old-capability"));
  view.rerender(ui("new-capability"));
  await screen.findByText(en.requestAppeal.tutee);
  await act(async () => old.resolve(await response(ready)));
  await waitFor(() =>
    expect(screen.queryByText(en.requestAppeal.tutor)).toBeNull(),
  );
  expect(screen.getByText(/Original submission time unavailable/)).toBeTruthy();
});
