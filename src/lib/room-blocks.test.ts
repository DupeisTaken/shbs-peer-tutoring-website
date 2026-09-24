import { expect, it } from "vitest";
import { createRoomBlockSchema, updateRoomBlockSchema } from "./room-blocks";

it("keeps midnight boundaries valid and trims reasons for both write paths", () => {
  const period = {
    dayOfWeek: 7,
    startMin: 0,
    endMin: 1440,
    reason: "  Closed all day  ",
  };
  expect(createRoomBlockSchema.parse({ roomId: "room", ...period })).toEqual({
    roomId: "room",
    ...period,
    reason: "Closed all day",
  });
  expect(updateRoomBlockSchema.parse({ id: "block", ...period })).toEqual({
    id: "block",
    ...period,
    reason: "Closed all day",
  });
});

it("does not allow an edit payload to relocate a block to another room", () => {
  expect(
    updateRoomBlockSchema.parse({
      id: "block",
      roomId: "other-room",
      dayOfWeek: 1,
      startMin: 60,
      endMin: 120,
    }),
  ).toEqual({ id: "block", dayOfWeek: 1, startMin: 60, endMin: 120 });
});

it.each([
  { dayOfWeek: 0 },
  { dayOfWeek: 8 },
  { startMin: -1 },
  { startMin: 1.5 },
  { endMin: 1441 },
  { endMin: 60 },
  { endMin: 59 },
  { reason: "x".repeat(201) },
])("rejects invalid direct and proposal inputs: %j", (change) => {
  const period = { dayOfWeek: 1, startMin: 60, endMin: 120, ...change };
  expect(
    createRoomBlockSchema.safeParse({ roomId: "room", ...period }).success,
  ).toBe(false);
  expect(
    updateRoomBlockSchema.safeParse({ id: "block", ...period }).success,
  ).toBe(false);
});
