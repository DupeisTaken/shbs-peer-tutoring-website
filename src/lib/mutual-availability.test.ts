import { describe, expect, it } from "vitest";
import { rankMutualAvailability } from "./mutual-availability";

const slot = (id: string, dayOfWeek = 1, startMin = 900, endMin = 960) => ({
  id,
  dayOfWeek,
  startMin,
  endMin,
});
const ids = (result: ReturnType<typeof rankMutualAvailability>) =>
  result.ranked.map(({ slot }) => slot.id);

describe("exact catalog availability ranking", () => {
  it("requires the tutor and every distinct current tutee, retaining all published options", () => {
    const slots = [slot("other"), slot("partial"), slot("mutual", 5)];
    const result = rankMutualAvailability({
      slots,
      tutorSlotIds: ["partial", "mutual"],
      tutees: [
        { id: "a", slotIds: ["partial", "mutual"] },
        { id: "b", slotIds: ["mutual"] },
        { id: "b", slotIds: ["mutual"] },
      ],
    });
    expect(ids(result)).toEqual(["mutual", "partial", "other"]);
    expect(result.totalTutees).toBe(2);
    expect(result.ranked.map((entry) => entry.mutual)).toEqual([
      true,
      false,
      false,
    ]);
    expect(result.status).toBe("mutual");
    expect(slots.map((item) => item.id)).toEqual([
      "other",
      "partial",
      "mutual",
    ]);
  });
  it("never infers agreement from identical or overlapping clock ranges", () => {
    const result = rankMutualAvailability({
      slots: [slot("tutor"), slot("identical"), slot("overlap", 1, 930, 990)],
      tutorSlotIds: ["tutor"],
      tutees: [{ id: "a", slotIds: ["identical", "overlap"] }],
    });
    expect(result.status).toBe("noCommon");
    expect(result.ranked.every((entry) => !entry.mutual)).toBe(true);
    expect(ids(result)[0]).toBe("tutor");
  });
  it("orders partial matches by tutee coverage and breaks ties by weekday/start/end/id", () => {
    const result = rankMutualAvailability({
      slots: [
        slot("z", 2),
        slot("b", 1, 900, 970),
        slot("c"),
        slot("a"),
        slot("late", 1, 910),
        slot("partial", 7),
      ],
      tutorSlotIds: ["z", "b", "c", "a", "late", "partial"],
      tutees: [
        { id: "a", slotIds: ["partial"] },
        { id: "b", slotIds: ["z"] },
        { id: "c", slotIds: ["partial"] },
      ],
    });
    expect(ids(result)).toEqual(["partial", "z", "a", "c", "b", "late"]);
    expect(result.status).toBe("noCommon");
  });
  it.each([undefined, [], ["retired"]])(
    "distinguishes missing tutee data %s from a known lack of common availability",
    (slotIds) => {
      const result = rankMutualAvailability({
        slots: [slot("active")],
        tutorSlotIds: ["active"],
        tutees: [{ id: "a", slotIds }],
      });
      expect(result.status).toBe("missing");
      expect(result.missingTutees).toBe(1);
      expect(result.ranked[0]?.mutual).toBe(false);
    },
  );
  it("reports missing tutor availability and keeps choices with no roster", () => {
    expect(
      rankMutualAvailability({
        slots: [slot("a")],
        tutorSlotIds: [],
        tutees: [{ id: "a", slotIds: ["a"] }],
      }).missingTutor,
    ).toBe(true);
    const emptyRoster = rankMutualAvailability({
      slots: [slot("a"), slot("b")],
      tutorSlotIds: ["b"],
      tutees: [],
    });
    expect(emptyRoster.status).toBe("noTutees");
    expect(ids(emptyRoster)).toEqual(["b", "a"]);
    expect(emptyRoster.ranked.every((entry) => !entry.mutual)).toBe(true);
  });
  it("reports unavailable guidance and falls back to catalog order during failed or loading reads", () => {
    const result = rankMutualAvailability({
      slots: [slot("b", 2), slot("a")],
      tutorSlotIds: ["b"],
      tutees: [{ id: "a", slotIds: ["b"] }],
      ready: false,
    });
    expect(result.status).toBe("unavailable");
    expect(ids(result)).toEqual(["a", "b"]);
    expect(result.ranked.every((entry) => !entry.mutual)).toBe(true);
    expect(
      rankMutualAvailability({ slots: [], tutorSlotIds: undefined, tutees: [] })
        .status,
    ).toBe("unavailable");
  });
});
