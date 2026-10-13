import { expect, it } from "vitest";
import {
  confirmationDelayMs,
  confirmationState,
  type AnchoredConfirmation,
} from "./confirmation-timing";

const anchor = (delay = 2_000, life = 30 * 60_000): AnchoredConfirmation => ({
  ticket: {
    id: "proof",
    serverNow: new Date(100_000),
    readyAt: new Date(100_000 + delay),
    expiresAt: new Date(100_000 + life),
  },
  requestStartedAt: 10,
  receivedAt: 10,
});
it.each(Object.entries(confirmationDelayMs))(
  "%s enables at its exact deliberate boundary",
  (_, delay) => {
    const proof = anchor(delay);
    expect(confirmationState(proof, 10 + delay - 1)).toMatchObject({
      remaining: 1,
      eligible: false,
    });
    expect(confirmationState(proof, 10 + delay)).toMatchObject({
      remaining: 0,
      eligible: true,
    });
  },
);
it("uses elapsed time after suspended callbacks, independent of any wall clock", () => {
  const proof = anchor();
  expect(confirmationState(proof, 10)).toMatchObject({
    remaining: 2,
    eligible: false,
  });
  expect(confirmationState(proof, 200_010)).toMatchObject({
    remaining: 0,
    eligible: true,
  });
  expect(confirmationState(proof, 1_800_010)).toMatchObject({
    expired: true,
    eligible: false,
  });
});
it("does not extend expiry for a delayed response and fails closed on stale metadata", () => {
  const proof = anchor(2_000, 10_000);
  proof.receivedAt = 4_010;
  expect(confirmationState(proof, 4_010)).toMatchObject({
    remaining: 2,
    eligible: false,
  });
  expect(confirmationState(proof, 10_009)).toMatchObject({ eligible: true });
  expect(confirmationState(proof, 10_010)).toMatchObject({
    expired: true,
    eligible: false,
  });
  proof.ticket.expiresAt = new Date(102_000);
  expect(confirmationState(proof, 4_010)).toMatchObject({
    expired: true,
    eligible: false,
  });
  proof.ticket.readyAt = new Date("invalid");
  expect(confirmationState(proof, 4_010)).toMatchObject({
    expired: true,
    eligible: false,
  });
  expect(confirmationState(null, 10)).toMatchObject({
    remaining: null,
    eligible: false,
  });
});
