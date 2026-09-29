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
import { useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { useSignupCaptcha } from "./signup-captcha";
import { ProgramCaptchaSettings } from "./program-captcha-settings";
const mocks = vi.hoisted(() => ({
  settings: {
    enabled: false,
    version: 0,
    ready: true,
    config: {
      provider: "aliyun-v2" as const,
      prefix: "prefix",
      region: "cn" as const,
      scenes: { tutee: "tutee", viewer: "viewer" },
    },
  },
  fresh: vi.fn(),
  verify: vi.fn(),
  work: vi.fn(),
  destroy: vi.fn(),
  canEdit: true,
  save: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      program: {
        captchaSettings: { invalidate: vi.fn() },
        captchaPublic: { invalidate: vi.fn() },
      },
    }),
    program: {
      captchaPublic: {
        useQuery: () => ({ data: mocks.settings, refetch: mocks.fresh }),
      },
      verifySignupCaptcha: {
        useMutation: () => ({ mutateAsync: mocks.verify }),
      },
      captchaSettings: {
        useQuery: () => ({
          data: { ...mocks.settings, canEdit: mocks.canEdit },
        }),
      },
      setCaptcha: { useMutation: () => ({ mutate: mocks.save }) },
    },
  },
}));
function Form() {
  const [email, setEmail] = useState("person@example.test");
  const captcha = useSignupCaptcha("viewer.start", email);
  return (
    <>
      <input
        aria-label="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button
        disabled={captcha.pending}
        onClick={() => void captcha.run(mocks.work)}
      >
        Submit
      </button>
      {captcha.panel}
    </>
  );
}
const wrap = (child: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={en}>
    {child}
  </NextIntlClientProvider>
);
let widget: Parameters<NonNullable<Window["initAliyunCaptcha"]>>[0] | undefined;
beforeEach(() => {
  mocks.settings = {
    ...mocks.settings,
    enabled: false,
    version: 0,
    ready: true,
  };
  mocks.fresh
    .mockReset()
    .mockImplementation(async () => ({ data: mocks.settings }));
  mocks.verify.mockReset().mockResolvedValue({ grant: "a".repeat(64) });
  mocks.work.mockReset().mockResolvedValue(undefined);
  mocks.destroy.mockClear();
  mocks.save.mockClear();
  mocks.canEdit = true;
  widget = undefined;
  window.initAliyunCaptcha = vi.fn(
    (options: Parameters<NonNullable<Window["initAliyunCaptcha"]>>[0]) => {
      widget = options;
      options.getInstance({ destroy: mocks.destroy });
    },
  );
});
afterEach(() => {
  cleanup();
  delete window.initAliyunCaptcha;
  document
    .querySelectorAll('script[src*="aliyunCaptcha"]')
    .forEach((el) => el.remove());
});
it("disabled signup never loads a script or calls provider verification", async () => {
  render(wrap(<Form />));
  fireEvent.click(screen.getByText("Submit"));
  await waitFor(() => expect(mocks.work).toHaveBeenCalledTimes(1));
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(window.initAliyunCaptcha).not.toHaveBeenCalled();
  expect(document.querySelector('script[src*="aliyunCaptcha"]')).toBeNull();
});
it("uses freshly enabled settings and blocks the mutation until a server grant arrives", async () => {
  render(wrap(<Form />));
  mocks.fresh.mockImplementationOnce(async () => {
    mocks.settings = { ...mocks.settings, enabled: true, version: 1 };
    return { data: mocks.settings };
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "retained@example.test" },
  });
  fireEvent.click(screen.getByText("Submit"));
  await waitFor(() => expect(widget).toBeDefined());
  expect(mocks.work).not.toHaveBeenCalled();
  await act(async () => {
    await widget!.captchaVerifyCallback("proof");
  });
  expect(mocks.verify).toHaveBeenCalledWith({
    action: "viewer.start",
    email: "retained@example.test",
    proof: "proof",
  });
  expect(mocks.work).toHaveBeenCalledWith("a".repeat(64));
  expect(screen.getByLabelText<HTMLInputElement>("Email").value).toBe(
    "retained@example.test",
  );
});
it("removes a widget when disabled and lets the next explicit submit proceed without a proof", async () => {
  mocks.settings.enabled = true;
  const view = render(wrap(<Form />));
  fireEvent.click(screen.getByText("Submit"));
  await waitFor(() => expect(widget).toBeDefined());
  mocks.settings = { ...mocks.settings, enabled: false, version: 2 };
  view.rerender(wrap(<Form />));
  await waitFor(() => expect(mocks.destroy).toHaveBeenCalled());
  fireEvent.click(screen.getByText("Submit"));
  await waitFor(() => expect(mocks.work).toHaveBeenCalledTimes(1));
  expect(mocks.verify).not.toHaveBeenCalled();
});
it("retains input and reports provider rejection distinctly without submitting", async () => {
  mocks.settings.enabled = true;
  mocks.verify.mockRejectedValue(new Error("CAPTCHA_REJECTED"));
  render(wrap(<Form />));
  fireEvent.click(screen.getByText("Submit"));
  await waitFor(() => expect(widget).toBeDefined());
  await act(async () => {
    await widget!.captchaVerifyCallback("proof");
  });
  expect(screen.getByRole("alert").textContent).toMatch(/rejected or expired/);
  expect(screen.getByLabelText<HTMLInputElement>("Email").value).toBe(
    "person@example.test",
  );
  expect(mocks.work).not.toHaveBeenCalled();
});
it("does not reuse stale callbacks after email changes or allow concurrent widget callbacks", async () => {
  mocks.settings.enabled = true;
  render(wrap(<Form />));
  fireEvent.click(screen.getByText("Submit"));
  await waitFor(() => expect(widget).toBeDefined());
  const previous = widget!;
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "changed@example.test" },
  });
  await act(async () => {
    await previous.captchaVerifyCallback("old");
  });
  expect(mocks.verify).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Submit"));
  await waitFor(() => expect(widget).not.toBe(previous));
  let resolve!: (value: { grant: string }) => void;
  mocks.verify.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => {
    const first = widget!.captchaVerifyCallback("one");
    const second = widget!.captchaVerifyCallback("two");
    resolve({ grant: "b".repeat(64) });
    await Promise.all([first, second]);
  });
  expect(mocks.verify).toHaveBeenCalledTimes(1);
  expect(mocks.work).toHaveBeenCalledTimes(1);
});
it("discards a late grant after an email edit invalidates the pending intent", async () => {
  mocks.settings.enabled = true;
  render(wrap(<Form />));
  fireEvent.click(screen.getByText("Submit"));
  await waitFor(() => expect(widget).toBeDefined());
  let resolve!: (value: { grant: string }) => void;
  mocks.verify.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  let verification!: Promise<unknown>;
  await act(async () => {
    verification = widget!.captchaVerifyCallback("proof");
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "changed@example.test" },
  });
  await act(async () => {
    resolve({ grant: "b".repeat(64) });
    await verification;
  });
  expect(mocks.work).not.toHaveBeenCalled();
  expect(screen.getByLabelText<HTMLInputElement>("Email").value).toBe(
    "changed@example.test",
  );
});
it("offers accessible retry/support on script failure without network verification", async () => {
  mocks.settings.enabled = true;
  delete window.initAliyunCaptcha;
  render(wrap(<Form />));
  fireEvent.click(screen.getByText("Submit"));
  await waitFor(() =>
    expect(
      document.querySelector('script[src*="aliyunCaptcha"]'),
    ).not.toBeNull(),
  );
  await act(async () => {
    document
      .querySelector('script[src*="aliyunCaptcha"]')!
      .dispatchEvent(new Event("error"));
  });
  expect(screen.getByRole("alert").textContent).toMatch(
    /script could not load/,
  );
  expect(screen.getByRole("button", { name: "Try Again" })).toBeTruthy();
  expect(screen.queryByText("Loading verification…")).toBeNull();
  expect(mocks.verify).not.toHaveBeenCalled();
});
it("blocks an unready enable, allows disable while unready, and omits edit controls for readers", () => {
  mocks.settings.ready = false;
  const view = render(wrap(<ProgramCaptchaSettings />));
  expect(screen.getByRole<HTMLInputElement>("switch").disabled).toBe(true);
  mocks.settings = { ...mocks.settings, enabled: true, version: 3 };
  view.rerender(wrap(<ProgramCaptchaSettings />));
  expect(screen.getByRole<HTMLInputElement>("switch").disabled).toBe(false);
  fireEvent.click(screen.getByRole("switch"));
  expect(mocks.save).toHaveBeenCalledWith({
    enabled: false,
    expectedVersion: 3,
  });
  mocks.canEdit = false;
  view.rerender(wrap(<ProgramCaptchaSettings />));
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.getByText(/Only Administrators/)).toBeTruthy();
});
