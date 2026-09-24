import { TRPCError } from "@trpc/server";

/** Browsers stamp room visits locally. Allow one minute of clock skew, but never award
 * patrol credit or create attendance evidence for a visit that has not happened yet. */
export function assertObservedTimes(
  observations: { observedAt?: Date }[],
  now = new Date(),
) {
  const latest = now.getTime() + 60_000;
  if (
    observations.some(
      ({ observedAt }) => observedAt && observedAt.getTime() > latest,
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Observation times cannot be in the future (one minute of clock difference is allowed).",
    });
}
