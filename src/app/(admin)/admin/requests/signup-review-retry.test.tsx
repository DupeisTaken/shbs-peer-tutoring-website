// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import { SignupAssignmentRelease } from "./student-request-board";

const state = vi.hoisted(() => ({
  write: vi.fn(),
  prepare: vi.fn(),
  cancel: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      studentWorkflow: { adminRequests: { invalidate: state.refresh } },
      admin: {
        tutees: { invalidate: state.refresh },
        pairings: { invalidate: state.refresh },
      },
    }),
    studentWorkflow: {
      headUnassign: { useMutation: () => ({ mutateAsync: state.write }) },
      prepareAction: { useMutation: () => ({ mutateAsync: state.prepare }) },
      cancelAction: { useMutation: () => ({ mutate: state.cancel }) },
    },
  },
}));
beforeEach(() => {
  state.prepare.mockResolvedValue({
    id: "same-ticket",
    readyAt: new Date(0),
    serverNow: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  });
  state.refresh.mockResolvedValue(undefined);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("releases real timed admission after repeated identical failures while retaining the captured version and ticket", async () => {
  state.write.mockRejectedValue(new Error("Same transport failure"));
  const row = { id: "survey", currentVersion: 2 } as Parameters<
    typeof SignupAssignmentRelease
  >[0]["row"];
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <SignupAssignmentRelease
        row={row}
        pairing={
          { id: "pairing", subject: "Mathematics" } as Parameters<
            typeof SignupAssignmentRelease
          >[0]["pairing"]
        }
        proposal={false}
      />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Release assignment/ }));
  const confirm = await screen.findByRole("button", {
    name: en.workflow.confirm,
  });
  for (let count = 1; count <= 3; count++) {
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(confirm);
    await waitFor(() => expect(state.write).toHaveBeenCalledTimes(count));
    expect(state.write.mock.calls[count - 1]?.[0]).toMatchObject({
      id: "survey",
      pairingId: "pairing",
      expectedVersion: 2,
      signedTicket: "same-ticket",
    });
    expect(state.write.mock.calls[count - 1]?.[0]).toEqual(
      state.write.mock.calls[0]?.[0],
    );
  }
  expect(state.prepare).toHaveBeenCalledOnce();
  expect(state.refresh).not.toHaveBeenCalled();
});

it("closes an accepted timed write and recovers failed synchronization through reads only", async () => {
  state.write.mockResolvedValue({ ok: true });
  state.refresh.mockRejectedValue(new Error("Read unavailable"));
  const row = { id: "survey", currentVersion: 2 } as Parameters<
    typeof SignupAssignmentRelease
  >[0]["row"];
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <SignupAssignmentRelease
        row={row}
        pairing={
          { id: "pairing", subject: "Mathematics" } as Parameters<
            typeof SignupAssignmentRelease
          >[0]["pairing"]
        }
        proposal={false}
      />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Release assignment/ }));
  const confirm = await screen.findByRole("button", {
    name: en.workflow.confirm,
  });
  await waitFor(() =>
    expect((confirm as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(confirm);
  const retry = await screen.findByRole("button", {
    name: en.signupEditing.retryRefresh,
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(state.write).toHaveBeenCalledOnce();
  state.refresh.mockResolvedValue(undefined);
  fireEvent.click(retry);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: en.signupEditing.retryRefresh }),
    ).toBeNull(),
  );
  expect(state.write).toHaveBeenCalledOnce();
  expect(state.prepare).toHaveBeenCalledOnce();
});
