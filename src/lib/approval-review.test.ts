import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import { APPROVAL_OPERATIONS } from "./approval-policy";
import { approvalReview } from "./approval-review";

describe("immutable approval presentation", () => {
  it("keeps academic year checks contextual and hides ignored legacy inputs", () => {
    const model = approvalReview(
      "admin.updateAccountAcademics",
      {
        userId: "person",
        status: "REPORTED",
        gradeLevel: 11,
        expectedSchoolYear: "26-27",
        schoolYear: "19-20",
        expectedProfileVersion: 4,
      },
      { academic: { userId: "person", gradeLevel: 10, schoolYear: "25-26" } },
    );
    expect(model.kind).toBe("action");
    expect(model.context).toContainEqual({
      key: "expectedSchoolYear",
      value: "26-27",
    });
    expect(model.changes.map(({ key }) => key)).toEqual([
      "status",
      "gradeLevel",
    ]);
    expect(model.changes.every(({ hasBefore }) => !hasBefore)).toBe(true);
  });
  it("gives every allowed operation an authored English and Chinese title", () => {
    for (const operation of Object.keys(APPROVAL_OPERATIONS)) {
      const key = operation.replaceAll(".", "_");
      for (const messages of [en, zh])
        expect(messages.approvals.review.operations).toHaveProperty(key);
    }
  });
  it("compares settings and management roles without presenting concurrency evidence as edits", () => {
    const settings = approvalReview(
      "program.setTimeZone",
      { timeZone: "Asia/Shanghai", expectedTimeZone: "UTC" },
      { programSettings: { id: "program", timeZone: "UTC" } },
    );
    expect(settings.changes).toEqual([
      { key: "timeZone", before: "UTC", requested: "Asia/Shanghai", hasBefore: true },
    ]);
    expect(approvalReview("admin.setUserRole", { userId: "person", role: "ADMIN", confirmPassword: "secret" }, {
      User: [{ record: { id: "person", role: "COORDINATOR" } }],
    }).changes).toEqual([
      { key: "role", before: "COORDINATOR", requested: "ADMIN", hasBefore: true },
    ]);
  });
  it("matches the requested language in immutable language visibility evidence", () => {
    expect(approvalReview("i18n.setLanguageEnabled", { code: "zh", enabled: false }, {
      languages: [{ code: "en", enabled: false }, { code: "zh", enabled: true }],
    }).changes.find(({ key }) => key === "enabled")).toEqual({
      key: "enabled", before: true, requested: false, hasBefore: true,
    });
  });
  it("compares only submitted fields against the exact target and separates unchanged values", () => {
    const model = approvalReview(
      "admin.updateRoom",
      {
        id: "a",
        name: "New",
        active: true,
        expectedUpdatedAt: new Date(),
        ticket: "secret",
      },
      {
        Room: [
          { record: { id: "unrelated", name: "Wrong" } },
          { record: { id: "a", name: "Old", active: true, capacity: 3 } },
        ],
      },
    );
    expect(model.changes).toEqual([
      { key: "name", before: "Old", requested: "New", hasBefore: true },
    ]);
    expect(model.unchanged.map((field) => field.key)).toEqual(["active"]);
    expect(model.context).toEqual([{ key: "id", value: "a" }]);
    expect(model.names.get("a")).toBe("Old");
  });
  it("does not use related record fields as a before snapshot", () => {
    const model = approvalReview(
      "admin.updateRoom",
      { id: "a", name: "New" },
      { Tutor: [{ record: { id: "a", name: "Wrong table" } }] },
    );
    expect(model.changes[0]).toMatchObject({
      hasBefore: false,
      before: undefined,
    });
  });
  it("supports existing room snapshots without a current database read", () => {
    expect(
      approvalReview(
        "admin.updateRoom",
        { id: "a", name: "New" },
        { rooms: [{ record: { id: "a", name: "Old" } }] },
      ).changes[0]?.before,
    ).toBe("Old");
  });
  it("distinguishes empty values, false and zero from unavailable evidence", () => {
    const model = approvalReview(
      "admin.updateRoom",
      { id: "a", name: "", active: false, capacity: 0, note: null },
      {
        Room: [{ record: { id: "a", name: null, active: true, capacity: 2 } }],
      },
    );
    expect(
      model.changes.map((field) => [
        field.key,
        field.hasBefore,
        field.requested,
      ]),
    ).toEqual([
      ["name", true, ""],
      ["active", true, false],
      ["capacity", true, 0],
      ["note", false, null],
    ]);
  });
  it("matches compound locale keys instead of showing another language's original text", () => {
    const model = approvalReview(
      "home.setContent",
      { key: "welcome", locale: "zh", value: "新文字" },
      {
        content: [
          { key: "welcome", locale: "en", value: "Old English" },
          { key: "welcome", locale: "zh", value: "旧文字" },
        ],
      },
    );
    expect(model.changes).toEqual([
      { key: "value", before: "旧文字", requested: "新文字", hasBefore: true },
    ]);
  });
  it("treats decisions as requested inputs, not imaginary database diffs", () => {
    const model = approvalReview(
      "studentWorkflow.resolveReview",
      { id: "review", approve: false },
      {
        StudentRequestReview: [{ record: { id: "review", state: "PENDING" } }],
      },
    );
    expect(model.kind).toBe("action");
    expect(model.changes).toEqual([
      { key: "approve", requested: false, before: undefined, hasBefore: false },
    ]);
  });
  it.each(["admin.createRoom", "admin.createPairing"])(
    "shows creation values without a misleading before column: %s",
    (operation) => {
      expect(approvalReview(operation, { name: "New" }, {}).kind).toBe(
        "create",
      );
    },
  );
  it("shows the deleted record and explicitly reports missing deletion evidence", () => {
    const payload = { id: "room" };
    expect(
      approvalReview("admin.deleteRoom", payload, {
        Room: [{ record: { id: "room", name: "Old", updatedAt: "date" } }],
      }).removed,
    ).toEqual([["name", "Old"]]);
    expect(
      approvalReview("admin.deleteRoom", payload, {}).hasRemovalSnapshot,
    ).toBe(false);
  });
  it("does not call removal of a translation deletion of the entire page", () => {
    expect(
      approvalReview(
        "home.removeSectionTranslation",
        { id: "a", locale: "zh" },
        {},
      ).kind,
    ).toBe("action");
  });
  it("normalizes stored dates and object key order when comparing", () => {
    const model = approvalReview(
      "corrections.correctAttendance",
      {
        id: "s",
        date: new Date("2026-09-30T00:00:00Z"),
        extra: { a: 1, b: 2 },
      },
      {
        Session: [
          {
            record: {
              id: "s",
              date: "2026-09-30T00:00:00.000Z",
              extra: { b: 2, a: 1 },
            },
          },
        ],
      },
    );
    expect(model.changes).toHaveLength(0);
    expect(model.unchanged).toHaveLength(2);
  });
  it("reads willingness only for the matching tutor and subject", () => {
    const input = { tutorId: "t", subjectId: "s", willing: false };
    expect(
      approvalReview("subjectAvailability.setWillingness", input, {
        willingness: { tutorId: "t", subjectId: "s", willing: true },
      }).changes.find((field) => field.key === "willing")?.before,
    ).toBe(true);
    expect(
      approvalReview("subjectAvailability.setWillingness", input, {
        willingness: { tutorId: "other", subjectId: "s", willing: true },
      }).changes.find((field) => field.key === "willing")?.hasBefore,
    ).toBe(false);
  });
  it("compares attendance using the session's child evidence and leaves input immutable", () => {
    const input = {
      id: "session",
      tutees: [{ tuteeId: "t", status: "PRESENT", absenceReason: null }],
    };
    const original = structuredClone(input);
    const result = approvalReview("corrections.correctAttendance", input, {
      "Session.SessionTutee": [
        {
          record: {
            sessionId: "session",
            tuteeId: "t",
            status: "EXCUSED_ABSENT",
            absenceReason: "Appointment",
            updatedAt: "ignored",
          },
        },
        {
          record: {
            sessionId: "other",
            tuteeId: "t",
            status: "UNEXCUSED_ABSENT",
          },
        },
      ],
    });
    expect(result.changes[0]?.before).toEqual([
      { tuteeId: "t", status: "EXCUSED_ABSENT", absenceReason: "Appointment" },
    ]);
    expect(input).toEqual(original);
  });
  it("handles absent or unknown legacy shapes without hiding submitted data", () => {
    expect(
      approvalReview("legacy.operation", { customField: "Value" }, null)
        .changes[0]?.requested,
    ).toBe("Value");
    expect(approvalReview("legacy.operation", null, null).changes).toEqual([]);
  });

  it("separates a correction's explanation from the fields being changed", () => {
    const model = approvalReview(
      "corrections.correctAttendance",
      { id: "s", reason: "Parent supplied evidence", online: true },
      { Session: [{ record: { id: "s", online: false } }] },
    );
    expect(model.changes.map((field) => field.key)).toEqual(["online"]);
    expect(model.context).toContainEqual({
      key: "requestReason",
      value: "Parent supplied evidence",
    });
  });

  it("does not report a roster change just because submitted students are reordered", () => {
    const model = approvalReview(
      "admin.updatePairing",
      { id: "p", tuteeIds: ["b", "a"] },
      {
        "Pairing.PairingTutee": [
          { record: { pairingId: "p", tuteeId: "a" } },
          { record: { pairingId: "p", tuteeId: "b" } },
        ],
      },
    );
    expect(model.changes).toEqual([]);
    expect(model.unchanged[0]?.key).toBe("tuteeIds");
  });

  it("compares recorded account capabilities without inventing missing tutor roster status", () => {
    const model = approvalReview(
      "admin.setMemberships",
      {
        userId: "u",
        membership: {
          rank: "COORDINATOR",
          translator: true,
          tutee: false,
          tutor: true,
          crew: false,
          viewer: false,
        },
      },
      {
        User: [
          {
            record: {
              id: "u",
              role: "COORDINATOR",
              canTranslate: false,
              tuteeMember: false,
              tutorId: "t",
              tutorAccessRevoked: false,
              crewStatus: null,
            },
          },
        ],
      },
    );
    expect(model.changes).toEqual([
      { key: "translator", requested: true, before: false, hasBefore: true },
      { key: "tutor", requested: true, before: undefined, hasBefore: false },
    ]);
    expect(model.unchanged.map((field) => field.key)).toEqual([
      "rank",
      "tutee",
      "crew",
      "viewer",
    ]);
  });

  it("labels an underlying request's reason without attributing it to this proposal", () => {
    const model = approvalReview(
      "studentWorkflow.resolveReview",
      { id: "r", approve: false },
      {
        StudentRequestReview: [
          {
            record: {
              id: "r",
              kind: "WITHDRAWAL",
              reason: "Scheduling conflict",
            },
          },
        ],
      },
    );
    expect(model.context).toContainEqual({
      key: "originalReason",
      value: "Scheduling conflict",
    });
    const block = approvalReview(
      "admin.updateRoomUnavailability",
      { id: "r", reason: "New reason" },
      { RoomUnavailability: [{ record: { id: "r", reason: "Old reason" } }] },
    );
    expect(block.context).toEqual([{ key: "id", value: "r" }]);
  });
});
