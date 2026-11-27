import { describe, expect, it } from "vitest";
import {
  getMeetingAutoExemption,
  resolveEffectiveMeetingStatus,
  resolveTermForMeetingDate,
  type MeetingTermWindow,
} from "./meeting-quarter";

const termsByCreatedAt: MeetingTermWindow[] = [
  {
    id: "q1",
    schoolYear: "25-26",
    quarter: "Q1",
    name: "25-26 Q1",
    active: false,
    startDate: null,
    endDate: null,
    createdAt: new Date("2025-08-20T00:00:00Z"),
  },
  {
    id: "q2",
    schoolYear: "25-26",
    quarter: "Q2",
    name: "25-26 Q2",
    active: false,
    startDate: null,
    endDate: null,
    createdAt: new Date("2025-11-03T00:00:00Z"),
  },
  {
    id: "q3",
    schoolYear: "25-26",
    quarter: "Q3",
    name: "25-26 Q3",
    active: false,
    startDate: null,
    endDate: null,
    createdAt: new Date("2026-01-12T00:00:00Z"),
  },
  {
    id: "q4",
    schoolYear: "25-26",
    quarter: "Q4",
    name: "25-26 Q4",
    active: true,
    startDate: null,
    endDate: null,
    createdAt: new Date("2026-03-16T00:00:00Z"),
  },
];

describe("resolveTermForMeetingDate", () => {
  it("sorts meeting dates into matching quarter windows based on term createdAt", () => {
    expect(
      resolveTermForMeetingDate(
        new Date("2025-09-15T04:00:00Z"),
        termsByCreatedAt,
      )?.id,
    ).toBe("q1");
    expect(
      resolveTermForMeetingDate(
        new Date("2025-11-20T04:00:00Z"),
        termsByCreatedAt,
      )?.id,
    ).toBe("q2");
    expect(
      resolveTermForMeetingDate(
        new Date("2026-02-01T04:00:00Z"),
        termsByCreatedAt,
      )?.id,
    ).toBe("q3");
    expect(
      resolveTermForMeetingDate(
        new Date("2026-06-10T04:00:00Z"),
        termsByCreatedAt,
      )?.id,
    ).toBe("q4");
  });

  it("prefers explicit startDate/endDate bounds over createdAt", () => {
    const terms: MeetingTermWindow[] = [
      {
        id: "q1",
        schoolYear: "26-27",
        quarter: "Q1",
        name: "26-27 Q1",
        active: false,
        startDate: new Date("2026-09-01T00:00:00Z"),
        endDate: new Date("2026-10-31T00:00:00Z"),
        createdAt: new Date("2026-11-05T00:00:00Z"),
      },
      {
        id: "q2",
        schoolYear: "26-27",
        quarter: "Q2",
        name: "26-27 Q2",
        active: true,
        startDate: new Date("2026-11-01T00:00:00Z"),
        endDate: new Date("2027-01-15T00:00:00Z"),
        createdAt: new Date("2026-11-05T00:00:00Z"),
      },
    ];
    expect(
      resolveTermForMeetingDate(new Date("2026-10-31T08:00:00Z"), terms, {
        timeZone: "Asia/Shanghai",
      })?.id,
    ).toBe("q1");
    expect(
      resolveTermForMeetingDate(new Date("2026-11-01T08:00:00Z"), terms, {
        timeZone: "Asia/Shanghai",
      })?.id,
    ).toBe("q2");
    // Future date beyond the latest term endDate lands in the active term.
    expect(
      resolveTermForMeetingDate(new Date("2027-03-01T08:00:00Z"), terms, {
        timeZone: "Asia/Shanghai",
      })?.id,
    ).toBe("q2");
  });

  it("handles dates before the earliest term and tied initial timestamps", () => {
    expect(
      resolveTermForMeetingDate(
        new Date("2025-08-01T04:00:00Z"),
        termsByCreatedAt,
      )?.id,
    ).toBe("q1");

    const tiedTimestamp = new Date("2026-09-01T00:00:00Z");
    const tiedTerms: MeetingTermWindow[] = [
      {
        id: "old",
        schoolYear: "25-26",
        quarter: "Q1",
        name: "Old",
        active: false,
        startDate: null,
        endDate: null,
        createdAt: tiedTimestamp,
      },
      {
        id: "current",
        schoolYear: "26-27",
        quarter: "Q2",
        name: "Current",
        active: true,
        startDate: null,
        endDate: null,
        createdAt: tiedTimestamp,
      },
    ];
    expect(
      resolveTermForMeetingDate(new Date("2026-08-25T00:00:00Z"), tiedTerms)
        ?.id,
    ).toBe("current");
  });
});

describe("getMeetingAutoExemption & resolveEffectiveMeetingStatus", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("marks tutors without accounts as exempt for meetings that already happened, but not future meetings", () => {
    const noAccountTutor = { status: "ACTIVE", user: null };
    expect(
      getMeetingAutoExemption(
        noAccountTutor,
        new Date("2026-10-10T04:00:00Z"),
        now,
      ),
    ).toBe("no_account_at_meeting");
    expect(
      getMeetingAutoExemption(
        noAccountTutor,
        new Date("2026-10-20T04:00:00Z"),
        now,
      ),
    ).toBeNull();
  });

  it("marks tutors whose account was created after the meeting date as exempt", () => {
    const lateAccountTutor = {
      status: "ACTIVE",
      user: { createdAt: new Date("2026-10-12T00:00:00Z") },
    };
    expect(
      getMeetingAutoExemption(
        lateAccountTutor,
        new Date("2026-10-10T04:00:00Z"),
        now,
      ),
    ).toBe("no_account_at_meeting");
    expect(
      getMeetingAutoExemption(
        lateAccountTutor,
        new Date("2026-10-14T04:00:00Z"),
        now,
      ),
    ).toBeNull();
  });

  it("preserves existing recorded attendance over automatic exemption", () => {
    const noAccountTutor = { status: "ACTIVE", user: null };
    expect(
      resolveEffectiveMeetingStatus(
        "PRESENT",
        noAccountTutor,
        new Date("2026-10-10T04:00:00Z"),
        now,
      ),
    ).toEqual({
      status: "PRESENT",
      autoExemptReason: null,
      isRecorded: true,
    });
    expect(
      resolveEffectiveMeetingStatus(
        undefined,
        noAccountTutor,
        new Date("2026-10-10T04:00:00Z"),
        now,
      ),
    ).toEqual({
      status: "EXEMPT",
      autoExemptReason: "no_account_at_meeting",
      isRecorded: false,
    });
  });

  it("keeps unrecorded inactive tutors without invented historical status in tables", () => {
    expect(
      resolveEffectiveMeetingStatus(
        undefined,
        { status: "ARCHIVED", user: null },
        new Date("2026-10-10T04:00:00Z"),
        now,
      ),
    ).toEqual({
      status: undefined,
      autoExemptReason: "inactive",
      isRecorded: false,
    });
  });
});
