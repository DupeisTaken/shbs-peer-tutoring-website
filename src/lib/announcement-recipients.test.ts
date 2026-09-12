import { describe, expect, it } from "vitest";
import {
  announcementAudienceSchema,
  announcementVisibility,
  defaultAnnouncementAudience,
  selectAnnouncementRecipients,
  type AnnouncementCandidate,
} from "./announcement-recipients";

const tutors: AnnouncementCandidate[] = [
  {
    id: "a",
    name: "A",
    gradeLevel: 12,
    status: "ACTIVE",
    subjects: ["Biology", "Math"],
    activeTutees: 0,
  },
  {
    id: "b",
    name: "B",
    gradeLevel: 12,
    status: "ACTIVE",
    subjects: ["Math"],
    activeTutees: 2,
  },
  {
    id: "c",
    name: "C",
    gradeLevel: 11,
    status: "PENDING",
    subjects: ["Biology"],
    activeTutees: 0,
  },
  {
    id: "d",
    name: "D",
    gradeLevel: null,
    status: "ARCHIVED",
    subjects: [],
    activeTutees: 0,
  },
];
const ids = (input: Parameters<typeof announcementAudienceSchema.parse>[0]) =>
  selectAnnouncementRecipients(
    tutors,
    announcementAudienceSchema.parse(input),
  ).map((tutor) => tutor.id);

describe("announcement recipients", () => {
  it("defaults to all currently existing tutor identities", () =>
    expect(ids(defaultAnnouncementAudience())).toEqual(["a", "b", "c", "d"]));
  it("ANDs grade, status, subject and assignment filters", () =>
    expect(
      ids({
        mode: "filtered",
        grades: [12],
        statuses: ["ACTIVE"],
        subjects: ["Biology"],
        assignment: "without",
      }),
    ).toEqual(["a"]));
  it("ORs selections within groups and excludes unknown grades only when a grade is selected", () => {
    expect(
      ids({
        mode: "filtered",
        grades: [11, 12],
        statuses: ["ACTIVE", "PENDING"],
      }),
    ).toEqual(["a", "b", "c"]);
    expect(ids({ mode: "filtered" })).toContain("d");
  });
  it("includes overrides outside filters; exclusion beats inclusion", () =>
    expect(
      ids({
        mode: "filtered",
        grades: [12],
        includeTutorIds: ["c", "b"],
        excludeTutorIds: ["b"],
      }),
    ).toEqual(["a", "c"]));
  it("specific mode starts empty and never silently becomes a broadcast", () => {
    expect(ids({ mode: "specific" })).toEqual([]);
    expect(
      ids({ mode: "specific", includeTutorIds: ["c", "c", "missing"] }),
    ).toEqual(["c"]);
  });
  it("has explicit legacy visibility and identity membership paths", () =>
    expect(announcementVisibility("a")).toEqual({
      OR: [{ audienceRestricted: false }, { recipientTutorIds: { has: "a" } }],
    }));
  it("rejects invalid criteria before publication", () => {
    expect(
      announcementAudienceSchema.safeParse({ statuses: ["ADMIN"] }).success,
    ).toBe(false);
    expect(announcementAudienceSchema.safeParse({ grades: [13] }).success).toBe(
      false,
    );
  });
});
