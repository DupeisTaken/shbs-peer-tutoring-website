// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "../../../messages/en.json";
import { SessionCalendarSubscription } from "./session-calendar-subscription";
const state = vi.hoisted(() => ({
  refetch: vi.fn(),
  rotate: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    sessionPlanning: {
      calendarStatus: {
        useQuery: () => ({
          data: { active: true, available: true },
          error: null,
          isFetching: false,
          refetch: state.refetch,
        }),
      },
      rotateCalendar: { useMutation: () => ({ mutateAsync: state.rotate }) },
      revokeCalendar: { useMutation: () => ({ mutateAsync: state.revoke }) },
    },
  },
}));
vi.mock("./profile-dialog", () => ({
  ProfileDialog: ({
    children,
    onClose,
    pending,
  }: {
    children: ReactNode;
    onClose: () => void;
    pending: boolean;
  }) => (
    <div role="dialog" aria-label="Subscription">
      <button disabled={pending} onClick={onClose}>
        Close subscription
      </button>
      {children}
    </div>
  ),
}));
vi.mock("./ui/modal", () => ({
  Modal: ({
    children,
    footer,
    title,
  }: {
    children: ReactNode;
    footer: ReactNode;
    title: string;
  }) => (
    <div role="dialog" aria-label={title}>
      {children}
      {footer}
    </div>
  ),
}));
beforeEach(() => {
  state.refetch.mockReset().mockResolvedValue({});
  state.rotate
    .mockReset()
    .mockResolvedValue({
      url: "https://example.test/api/session-calendar/synthetic-capability",
    });
  state.revoke.mockReset().mockResolvedValue({ revoked: 1 });
});
afterEach(cleanup);
it("requires review, displays a new private URL once and does not replay rotation after a refresh failure", async () => {
  const text = en.sessionPlanning;
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SessionCalendarSubscription />
    </NextIntlClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: text.calendarSubscription }),
  );
  fireEvent.click(screen.getByRole("button", { name: text.calendarRotate }));
  expect(state.rotate).not.toHaveBeenCalled();
  state.refetch.mockRejectedValueOnce(new Error("Synthetic offline status"));
  const review = screen.getByRole("dialog", { name: text.calendarRotate });
  await act(async () =>
    fireEvent.click(
      within(review).getByRole("button", { name: text.calendarCreate }),
    ),
  );
  expect(state.rotate).toHaveBeenCalledOnce();
  expect(
    screen.getByLabelText<HTMLInputElement>(text.calendarUrl).value,
  ).toContain("synthetic-capability");
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: text.retry })),
  );
  expect(state.rotate).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Close subscription" }));
  fireEvent.click(
    screen.getByRole("button", { name: text.calendarSubscription }),
  );
  expect(screen.queryByLabelText(text.calendarUrl)).toBeNull();
});
