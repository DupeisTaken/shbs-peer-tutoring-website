// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { InvalidationTarget } from "~/lib/invalidate-refresh";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { QualificationReview } from "./qualification-review";

const mocks = vi.hoisted(() => ({
  success: undefined as (() => Promise<void>) | undefined,
  decide: vi.fn(),
  invalidateDetails:
    vi.fn<
      (
        input: { tutorId: string },
        filters?: Parameters<InvalidationTarget["invalidate"]>[1],
        options?: Parameters<InvalidationTarget["invalidate"]>[2],
      ) => Promise<void>
    >(),
  invalidateMine: vi.fn<InvalidationTarget["invalidate"]>(),
  invalidateAvailability: vi.fn<InvalidationTarget["invalidate"]>(),
  invalidateRoster: vi.fn<InvalidationTarget["invalidate"]>(),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    account: {
      me: {
        useQuery: () => ({ data: { role: "ADMIN", tutorId: "reviewer" } }),
      },
    },
    qualificationApplication: {
      decide: {
        useMutation: ({
          onSuccess,
          onSettled,
        }: {
          onSuccess: () => Promise<void>;
          onSettled: () => void;
        }) => {
          mocks.success = async () => {
            await onSuccess();
            onSettled();
          };
          return { mutate: mocks.decide, isPending: false };
        },
      },
    },
    useUtils: () => ({
      qualificationApplication: { mine: { invalidate: mocks.invalidateMine } },
      subjectAvailability: {
        options: { invalidate: mocks.invalidateAvailability },
      },
      admin: { tutors: { invalidate: mocks.invalidateRoster } },
      tutorDetails: { get: { invalidate: mocks.invalidateDetails } },
    }),
  },
}));

// Use real freshness/invalidation behavior behind the mocked transport. An
// unrelated roster refresh must not accidentally make this regression pass.
const detailKey = (tutorId: string) =>
  [["tutorDetails", "get"], { input: { tutorId }, type: "query" }] as const;
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.invalidateMine.mockResolvedValue(undefined);
  mocks.invalidateAvailability.mockResolvedValue(undefined);
  mocks.invalidateRoster.mockResolvedValue(undefined);
  mocks.success = undefined;
  client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false, gcTime: Infinity },
    },
  });
  mocks.invalidateDetails.mockImplementation(({ tutorId }, filters, options) =>
    client.invalidateQueries(
      { queryKey: detailKey(tutorId), ...filters },
      options,
    ),
  );
});
afterEach(() => {
  cleanup();
  client.clear();
});

function show(
  requestedTutorId: string | null | undefined,
  onChanged: () => Promise<unknown> | void = vi.fn(),
) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QualificationReview
        app={{
          id: "additional-request",
          name: "Synthetic Tutor",
          type: "ADDITIONAL_SUBJECT",
          subjectIntents: [{ subject: { name: "History" } }],
          status: "PENDING",
          updatedAt: new Date("2026-09-01T00:00:00Z"),
          decisionComment: null,
          requestedTutorId,
        }}
        onChanged={onChanged}
      />
    </NextIntlClientProvider>,
  );
}

it("refetches fresh cached details when the approved tutor is reopened, leaving other tutors fresh", async () => {
  const oldDetails = { qualified: false, willing: null, membership: "TUTOR" };
  const newDetails = { ...oldDetails, qualified: true };
  client.setQueryData(detailKey("applicant"), oldDetails);
  client.setQueryData(detailKey("other"), oldDetails);
  const fetchDetails = vi.fn().mockResolvedValue(newDetails);
  expect(
    await client.fetchQuery({
      queryKey: detailKey("applicant"),
      queryFn: fetchDetails,
    }),
  ).toEqual(oldDetails);
  expect(fetchDetails).not.toHaveBeenCalled();

  show("applicant");
  expect(mocks.success).toBeDefined();
  await act(async () => {
    await mocks.success!();
  });

  expect(client.getQueryState(detailKey("applicant"))?.isInvalidated).toBe(
    true,
  );
  expect(client.getQueryState(detailKey("other"))?.isInvalidated).toBe(false);
  // Reopening while the original 30-second freshness window is still in effect
  // must load the new approval without changing willingness or membership data.
  expect(
    await client.fetchQuery({
      queryKey: detailKey("applicant"),
      queryFn: fetchDetails,
    }),
  ).toEqual(newDetails);
  expect(fetchDetails).toHaveBeenCalledTimes(1);
  expect(mocks.invalidateMine).toHaveBeenCalledTimes(1);
  expect(mocks.invalidateAvailability).toHaveBeenCalledTimes(1);
  expect(mocks.invalidateRoster).toHaveBeenCalledTimes(1);
});

it.each([null, undefined])(
  "does not invalidate every tutor when the request has no tutor ID (%s)",
  async (tutorId) => {
    client.setQueryData(detailKey("other"), { qualified: true });
    show(tutorId);
    expect(mocks.success).toBeDefined();
    await act(async () => {
      await mocks.success!();
    });
    expect(mocks.invalidateDetails).not.toHaveBeenCalled();
    expect(client.getQueryState(detailKey("other"))?.isInvalidated).toBe(false);
  },
);

it.each([
  "invalidateMine",
  "invalidateAvailability",
  "invalidateRoster",
] as const)(
  "waits for every active read under %s before reporting its first failure",
  async (target) => {
    let release!: () => void;
    const held = new Promise<string>((resolve) => {
      release = () => resolve("fresh held");
    });
    const failedRead = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Matching read unavailable"))
      .mockResolvedValue("fresh failed");
    const failed = new QueryObserver(client, {
      queryKey: ["matching", "failed"],
      queryFn: failedRead,
      initialData: "cached failed",
      staleTime: Infinity,
    });
    const pending = new QueryObserver(client, {
      queryKey: ["matching", "held"],
      queryFn: () => held,
      initialData: "cached held",
      staleTime: Infinity,
    });
    const stopFailed = failed.subscribe(() => undefined);
    const stopPending = pending.subscribe(() => undefined);
    mocks[target].mockImplementation((_input, filters, options) =>
      client.invalidateQueries({ queryKey: ["matching"], ...filters }, options),
    );
    let completion: Promise<void> | undefined;
    try {
      show("applicant");
      fireEvent.click(
        screen.getByRole("button", { name: "Approve without Interview" }),
      );
      fireEvent.change(screen.getByLabelText("Decision note"), {
        target: { value: "Reviewed synthetic evidence" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Approve qualification" }),
      );
      expect(mocks.decide).toHaveBeenCalledOnce();
      await act(async () => {
        completion = mocks.success!();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await waitFor(() => expect(failed.getCurrentResult().isError).toBe(true));
      expect(pending.getCurrentResult().isFetching).toBe(true);
      const dialog = screen.getByRole("dialog", {
        name: "Review Qualification Request",
      });
      expect(dialog.getAttribute("aria-busy")).toBe("true");
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" })
          .disabled,
      ).toBe(true);
      expect(screen.queryByText("Matching read unavailable")).toBeNull();
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
      expect(dialog.isConnected).toBe(true);
      await act(async () => {
        release();
        await completion;
      });
      expect(screen.getByText("Matching read unavailable")).toBeTruthy();
      expect(dialog.getAttribute("aria-busy")).toBe("false");
      expect(
        screen.queryByRole("button", { name: "Approve qualification" }),
      ).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(failedRead).toHaveBeenCalledTimes(2);
      expect(mocks.decide).toHaveBeenCalledOnce();
    } finally {
      release();
      await completion;
      stopFailed();
      stopPending();
    }
  },
);

it("starts every independent cache refresh even when the page callback throws synchronously", async () => {
  show("applicant", () => {
    throw new Error("Page refresh unavailable");
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Approve without Interview" }),
  );
  await act(async () => {
    await mocks.success!();
  });
  expect(mocks.invalidateMine).toHaveBeenCalledOnce();
  expect(mocks.invalidateAvailability).toHaveBeenCalledOnce();
  expect(mocks.invalidateRoster).toHaveBeenCalledOnce();
  expect(mocks.invalidateDetails).toHaveBeenCalledOnce();
  expect(screen.getByText("Page refresh unavailable")).toBeTruthy();
});

it("reports an active detail refresh failure without invalidating another tutor", async () => {
  const otherRead = vi.fn(async () => ({ qualified: true }));
  const applicant = new QueryObserver(client, {
    queryKey: detailKey("applicant"),
    queryFn: async () => {
      throw new Error("Tutor detail unavailable");
    },
    initialData: { qualified: false },
    staleTime: Infinity,
  });
  const other = new QueryObserver(client, {
    queryKey: detailKey("other"),
    queryFn: otherRead,
    initialData: { qualified: false },
    staleTime: Infinity,
  });
  const stopApplicant = applicant.subscribe(() => undefined);
  const stopOther = other.subscribe(() => undefined);
  try {
    show("applicant");
    fireEvent.click(
      screen.getByRole("button", { name: "Approve without Interview" }),
    );
    await act(async () => {
      await mocks.success!();
    });
    expect(screen.getByText("Tutor detail unavailable")).toBeTruthy();
    expect(client.getQueryState(detailKey("other"))?.isInvalidated).toBe(false);
    expect(otherRead).not.toHaveBeenCalled();
  } finally {
    stopApplicant();
    stopOther();
  }
});
