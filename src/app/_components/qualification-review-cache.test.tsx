// @vitest-environment jsdom
import React from "react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { QualificationReview } from "./qualification-review";

const mocks = vi.hoisted(() => ({
  success: undefined as (() => Promise<void>) | undefined,
  invalidateDetails: vi.fn<(input: { tutorId: string }) => Promise<void>>(),
  invalidateMine: vi.fn(),
  invalidateAvailability: vi.fn(),
  invalidateRoster: vi.fn(),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    account: {
      me: { useQuery: () => ({ data: { role: "ADMIN", tutorId: "reviewer" } }) },
    },
    qualificationApplication: {
      decide: {
        useMutation: ({ onSuccess }: { onSuccess: () => Promise<void> }) => {
          mocks.success = onSuccess;
          return { mutate: vi.fn(), isPending: false };
        },
      },
    },
    useUtils: () => ({
      qualificationApplication: { mine: { invalidate: mocks.invalidateMine } },
      subjectAvailability: { options: { invalidate: mocks.invalidateAvailability } },
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
  vi.clearAllMocks();
  mocks.success = undefined;
  client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false, gcTime: Infinity },
    },
  });
  mocks.invalidateDetails.mockImplementation(({ tutorId }) =>
    client.invalidateQueries({ queryKey: detailKey(tutorId) }),
  );
});
afterEach(() => {
  cleanup();
  client.clear();
});

function show(requestedTutorId: string | null | undefined) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QualificationReview
        app={{
          id: "additional-request",
          status: "PENDING",
          updatedAt: new Date("2026-09-01T00:00:00Z"),
          decisionComment: null,
          requestedTutorId,
        }}
        onChanged={vi.fn()}
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
      queryKey: detailKey("applicant"), queryFn: fetchDetails,
    }),
  ).toEqual(oldDetails);
  expect(fetchDetails).not.toHaveBeenCalled();

  show("applicant");
  expect(mocks.success).toBeDefined();
  await mocks.success!();

  expect(client.getQueryState(detailKey("applicant"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(detailKey("other"))?.isInvalidated).toBe(false);
  // Reopening while the original 30-second freshness window is still in effect
  // must load the new approval without changing willingness or membership data.
  expect(
    await client.fetchQuery({
      queryKey: detailKey("applicant"), queryFn: fetchDetails,
    }),
  ).toEqual(newDetails);
  expect(fetchDetails).toHaveBeenCalledTimes(1);
  expect(mocks.invalidateMine).toHaveBeenCalledTimes(1);
  expect(mocks.invalidateAvailability).toHaveBeenCalledTimes(1);
  expect(mocks.invalidateRoster).toHaveBeenCalledTimes(1);
});

it.each([null, undefined])("does not invalidate every tutor when the request has no tutor ID (%s)", async (tutorId) => {
  client.setQueryData(detailKey("other"), { qualified: true });
  show(tutorId);
  expect(mocks.success).toBeDefined();
  await mocks.success!();
  expect(mocks.invalidateDetails).not.toHaveBeenCalled();
  expect(client.getQueryState(detailKey("other"))?.isInvalidated).toBe(false);
});
