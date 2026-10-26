/** @vitest-environment jsdom */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { FeatureToggles } from "./program-feature-settings";

const state = vi.hoisted(() => ({
  data: {
    canEdit: true,
    canApply: true,
    features: [
      {
        key: "AUTO_ASSIGN_ROOMS",
        enabled: true,
        pending: null as boolean | null,
      },
    ],
  },
  error: null as null | { message: string; data?: { code: string } },
  loading: false,
  mutationError: null as null | {
    message: string;
    data?: { approvalId?: string };
  },
  mutateAsync: vi.fn(),
  refetch: vi.fn(),
  nextRecruitmentInvalidate: vi.fn(),
  currentPeriodInvalidate: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      program: { nextRecruitment: { invalidate: state.nextRecruitmentInvalidate } },
      admin: { currentPeriod: { invalidate: state.currentPeriodInvalidate } },
    }),
    program: {
      featureSettings: {
        useQuery: () => ({
          data: state.loading ? undefined : state.data,
          error: state.error,
          isSuccess: !state.loading && !state.error,
          refetch: state.refetch,
        }),
      },
      setFeaturePending: {
        useMutation: () => ({
          mutateAsync: state.mutateAsync,
          error: state.mutationError,
        }),
      },
    },
  },
}));
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {children}
  </NextIntlClientProvider>
);
beforeEach(() => {
  state.data = {
    canEdit: true,
    canApply: true,
    features: [{ key: "AUTO_ASSIGN_ROOMS", enabled: true, pending: null }],
  };
  state.error = null;
  state.loading = false;
  state.mutationError = null;
  state.mutateAsync.mockReset().mockResolvedValue({});
  state.refetch.mockReset().mockResolvedValue({ isSuccess: true });
  state.nextRecruitmentInvalidate.mockReset().mockResolvedValue(undefined);
  state.currentPeriodInvalidate.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

it("keeps effective On distinct from pending Off and lets Head cancel the pending change", async () => {
  state.data.features[0]!.pending = false;
  render(<FeatureToggles />, { wrapper });
  expect(screen.getByText(messages.admin.program.features.on)).toBeTruthy();
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  fireEvent.click(screen.getByRole("switch"));
  await waitFor(() =>
    expect(state.mutateAsync).toHaveBeenCalledWith({
      key: "AUTO_ASSIGN_ROOMS",
      enabled: true,
    }),
  );
});

it("locks accepted writes after a failed read and retries only the read", async () => {
  state.refetch.mockResolvedValueOnce({ isSuccess: false });
  render(<FeatureToggles />, { wrapper });
  fireEvent.click(screen.getByRole("switch"));
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("switch").disabled).toBe(true),
  );
  await waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(1));
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.admin.program.features.retryRefresh,
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("switch").disabled).toBe(false),
  );
  expect(state.refetch).toHaveBeenCalledTimes(2);
  expect(state.mutateAsync).toHaveBeenCalledTimes(1);
});

it("refreshes both next-period identities after a mode save and retries failed dependent reads without another write", async () => {
  state.data.features[0]!.key = "QUARTER_SYSTEM";
  state.nextRecruitmentInvalidate.mockRejectedValueOnce(new Error("Read failed"));
  render(<FeatureToggles />, { wrapper });
  fireEvent.click(screen.getByRole("switch"));
  await waitFor(() => expect(screen.getByText(messages.admin.program.features.savedRefreshFailed)).toBeTruthy());
  expect(screen.getByRole<HTMLButtonElement>("switch").disabled).toBe(true);
  expect(state.nextRecruitmentInvalidate).toHaveBeenCalledWith(undefined, undefined, { throwOnError: true });
  expect(state.currentPeriodInvalidate).toHaveBeenCalledWith(undefined, undefined, { throwOnError: true });
  fireEvent.click(screen.getByRole("button", { name: messages.admin.program.features.retryRefresh }));
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("switch").disabled).toBe(false));
  expect(state.nextRecruitmentInvalidate).toHaveBeenCalledTimes(2);
  expect(state.currentPeriodInvalidate).toHaveBeenCalledTimes(2);
  expect(state.mutateAsync).toHaveBeenCalledExactlyOnceWith({ key: "QUARTER_SYSTEM", enabled: false });
});

it("blocks same-tick duplicate submits until mutation and refresh finish", async () => {
  let finish!: () => void;
  state.mutateAsync.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<FeatureToggles />, { wrapper });
  const toggle = screen.getByRole("switch");
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  expect(state.mutateAsync).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(1));
});

it("preserves live state for queued Admin requests and links the review", () => {
  state.data.canApply = false;
  state.mutationError = {
    message: "Queued",
    data: { approvalId: "request-389" },
  };
  render(<FeatureToggles />, { wrapper });
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  expect(
    screen
      .getByRole("link", { name: messages.approvals.viewRequest })
      .getAttribute("href"),
  ).toBe("/admin/approvals?request=request-389");
  expect(state.refetch).not.toHaveBeenCalled();
  expect(state.nextRecruitmentInvalidate).not.toHaveBeenCalled();
  expect(state.currentPeriodInvalidate).not.toHaveBeenCalled();
});

it("retains failed-write state and permits a deliberate retry", async () => {
  state.mutateAsync.mockRejectedValueOnce(new Error("Network error"));
  render(<FeatureToggles />, { wrapper });
  fireEvent.click(screen.getByRole("switch"));
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("switch").disabled).toBe(false),
  );
  expect(state.refetch).not.toHaveBeenCalled();
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("switch"));
  await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledTimes(2));
});

it("keeps the setting visible without exposing a switch to read-only roles", () => {
  state.data.canEdit = false;
  render(<FeatureToggles />, { wrapper });
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.getByText(messages.admin.program.features.on)).toBeTruthy();
});

it("hides cached switches and values after authorization loss until a successful authorized read", async () => {
  const view = render(<FeatureToggles />, { wrapper });
  expect(screen.getByRole("switch")).toBeTruthy();
  state.error = { message: "Denied", data: { code: "FORBIDDEN" } };
  view.rerender(<FeatureToggles />);
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.queryByText(messages.admin.program.features.on)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: messages.uiPatterns.retry }),
  );
  expect(state.refetch).toHaveBeenCalledOnce();
  expect(state.mutateAsync).not.toHaveBeenCalled();
  state.error = null;
  view.rerender(<FeatureToggles />);
  await waitFor(() => expect(screen.getByRole("switch")).toBeTruthy());
});
it("keeps a transient failed read visible but excludes writes until recovered", () => {
  const view = render(<FeatureToggles />, { wrapper });
  state.error = { message: "Temporary read failure" };
  view.rerender(<FeatureToggles />);
  const toggle = screen.getByRole<HTMLButtonElement>("switch");
  expect(toggle.disabled).toBe(true);
  fireEvent.click(toggle);
  expect(state.mutateAsync).not.toHaveBeenCalled();
  expect(screen.getByText(messages.admin.program.features.on)).toBeTruthy();
  state.error = null;
  state.data.canEdit = false;
  view.rerender(<FeatureToggles />);
  expect(screen.queryByRole("switch")).toBeNull();
});
it("does not render a feature state while the initial authorized query is loading", () => {
  state.loading = true;
  render(<FeatureToggles />, { wrapper });
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.getByText(messages.admin.program.loading)).toBeTruthy();
});
