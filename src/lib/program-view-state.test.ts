import { expect, it } from "vitest";
import {
  roomSelectionParser,
  scheduleFiltersParser,
} from "./program-view-state";
it("preserves defaults and deliberate empty selections while dropping removed or unknown room IDs", () => {
  const parse = roomSelectionParser(["room-a", "room-b"], "tutor-a");
  expect(
    parse({ owner: "tutor-a", ids: "default", privateDraft: "never copied" }),
  ).toEqual({ owner: "tutor-a", ids: "default" });
  expect(parse({ owner: "tutor-a", ids: [] })).toEqual({
    owner: "tutor-a",
    ids: [],
  });
  expect(parse({ owner: "tutor-a", ids: null })).toEqual({
    owner: "tutor-a",
    ids: null,
  });
  expect(
    parse({ owner: "tutor-a", ids: ["room-a", "removed", "room-a"] }),
  ).toEqual({ owner: "tutor-a", ids: ["room-a"] });
  expect(parse({ owner: "tutor-a", ids: [1] })).toBeUndefined();
  expect(parse({ owner: "other-tutor", ids: ["room-a"] })).toBeUndefined();
});
it("validates current room/slot/interval catalogs and weekday values without retaining record bodies", () => {
  const parse = scheduleFiltersParser({
    rooms: ["room-a"],
    slots: ["slot-a"],
    intervals: ["900:960"],
  });
  expect(
    parse({
      day: "1",
      room: "room-a",
      slot: "removed",
      interval: "900:960",
      evidence: "private",
    }),
  ).toEqual({ day: "1", room: "room-a", slot: "", interval: "900:960" });
  expect(parse({ day: "9", room: "", slot: "", interval: "" })).toBeUndefined();
});
