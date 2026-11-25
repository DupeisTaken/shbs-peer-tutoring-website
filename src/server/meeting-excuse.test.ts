import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

const headCaller = () =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: "head-user", name: "Head User", email: "head@example.test" },
      role: "HEAD",
      tutorId: null,
      expires: "2099-01-01",
    },
  });

const tutorCaller = () =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: {
        id: "tutor-user",
        name: "Tutor User",
        email: "tutor@example.test",
      },
      role: "TUTOR",
      tutorId: "ctutor0000000000000000001",
      expires: "2099-01-01",
    },
  });

const TUTOR_ID = "ctutor0000000000000000001";
const MEETING_ID = "cmeeting00000000000000001";

async function resetDb() {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((row) => `"${row.tablename.replaceAll('"', '""')}"`)
        .join(",") +
      " CASCADE",
  );
}

async function seedMeeting(minutesAhead = 120) {
  const term = await db.term.create({
    data: {
      id: "term-1",
      schoolYear: "2026-27",
      quarter: "Q1",
      name: "2026-27 Q1",
      active: true,
    },
  });
  await db.programFeature.upsert({
    where: { key: "MEETINGS" },
    create: { key: "MEETINGS", enabled: true },
    update: { enabled: true },
  });
  await db.tutor.create({
    data: {
      id: TUTOR_ID,
      englishName: "Synthetic Tutor",
      status: "ACTIVE",
    },
  });
  await db.user.createMany({
    data: [
      {
        id: "head-user",
        name: "Head User",
        email: "head@example.test",
        role: "HEAD",
      },
      {
        id: "tutor-user",
        name: "Tutor User",
        email: "tutor@example.test",
        role: "TUTOR",
        tutorId: TUTOR_ID,
      },
    ],
  });
  await db.tutorMeeting.create({
    data: {
      id: MEETING_ID,
      title: "Upcoming Staff Meeting",
      date: new Date(Date.now() + minutesAhead * 60_000),
      termId: term.id,
    },
  });
}

beforeEach(async () => {
  await resetDb();
  await seedMeeting(120);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("#637 staff vs tutor meeting attendance ownership and serialization", () => {
  it.each(["PRESENT", "EXEMPT", "UNEXCUSED_ABSENT"] as const)(
    "clears excusedAt and reason when staff overrides a self-excuse to %s, blocking stale cancel and overwrite",
    async (staffStatus) => {
      await tutorCaller().tutor.excuseMeeting({
        meetingId: MEETING_ID,
        reason: "Doctor appointment",
      });
      const selfRow = await db.meetingAttendance.findUniqueOrThrow({
        where: { meetingId_tutorId: { meetingId: MEETING_ID, tutorId: TUTOR_ID } },
      });
      expect(selfRow.excusedAt).not.toBeNull();
      expect(selfRow.reason).toBe("Doctor appointment");

      await headCaller().admin.recordMeetingAttendance({
        meetingId: MEETING_ID,
        entries: [{ tutorId: TUTOR_ID, status: staffStatus }],
      });
      const staffRow = await db.meetingAttendance.findUniqueOrThrow({
        where: { meetingId_tutorId: { meetingId: MEETING_ID, tutorId: TUTOR_ID } },
      });
      expect(staffRow.status).toBe(staffStatus);
      expect(staffRow.excusedAt).toBeNull();
      expect(staffRow.reason).toBeNull();

      // Stale tutor cancel must reject with CONFLICT without deleting staff attendance.
      await expect(
        tutorCaller().tutor.cancelMeetingExcuse({ meetingId: MEETING_ID }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      // Stale tutor excuse must reject with CONFLICT without overwriting staff attendance.
      await expect(
        tutorCaller().tutor.excuseMeeting({
          meetingId: MEETING_ID,
          reason: "Attempted overwrite",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      const after = await db.meetingAttendance.findUniqueOrThrow({
        where: { meetingId_tutorId: { meetingId: MEETING_ID, tutorId: TUTOR_ID } },
      });
      expect(after.status).toBe(staffStatus);
      expect(after.excusedAt).toBeNull();
      expect(after.reason).toBeNull();

      // Read models reflect staff ownership (excused: false, canExcuse: false).
      const myMeetings = await tutorCaller().tutor.myMeetings();
      expect(myMeetings[0]).toMatchObject({
        id: MEETING_ID,
        status: staffStatus,
        excused: false,
        canExcuse: false,
      });
    },
  );

  it("clears excusedAt and reason when staff explicitly saves same-status EXCUSED_ABSENT", async () => {
    await tutorCaller().tutor.excuseMeeting({
      meetingId: MEETING_ID,
      reason: "Private student excuse text",
    });
    await headCaller().admin.recordMeetingAttendance({
      meetingId: MEETING_ID,
      entries: [{ tutorId: TUTOR_ID, status: "EXCUSED_ABSENT" }],
    });
    const adopted = await db.meetingAttendance.findUniqueOrThrow({
      where: { meetingId_tutorId: { meetingId: MEETING_ID, tutorId: TUTOR_ID } },
    });
    expect(adopted.status).toBe("EXCUSED_ABSENT");
    expect(adopted.excusedAt).toBeNull();
    expect(adopted.reason).toBeNull();

    await expect(
      tutorCaller().tutor.cancelMeetingExcuse({ meetingId: MEETING_ID }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      tutorCaller().tutor.excuseMeeting({
        meetingId: MEETING_ID,
        reason: "Re-excuse attempt",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects tutor self-excuse over a fresh staff PRESENT/EXEMPT row without altering attendance", async () => {
    await headCaller().admin.recordMeetingAttendance({
      meetingId: MEETING_ID,
      entries: [{ tutorId: TUTOR_ID, status: "PRESENT" }],
    });
    await expect(
      tutorCaller().tutor.excuseMeeting({
        meetingId: MEETING_ID,
        reason: "Overwrite attempt",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const row = await db.meetingAttendance.findUniqueOrThrow({
      where: { meetingId_tutorId: { meetingId: MEETING_ID, tutorId: TUTOR_ID } },
    });
    expect(row.status).toBe("PRESENT");
    expect(row.excusedAt).toBeNull();
  });

  it("preserves legitimate self-excuse update/cancel before the 45-minute cutoff and enforces the 45-minute cutoff", async () => {
    await tutorCaller().tutor.excuseMeeting({
      meetingId: MEETING_ID,
      reason: "Initial reason",
    });
    await tutorCaller().tutor.excuseMeeting({
      meetingId: MEETING_ID,
      reason: "Updated reason",
    });
    const updated = await db.meetingAttendance.findUniqueOrThrow({
      where: { meetingId_tutorId: { meetingId: MEETING_ID, tutorId: TUTOR_ID } },
    });
    expect(updated.reason).toBe("Updated reason");
    expect(updated.excusedAt).not.toBeNull();

    await tutorCaller().tutor.cancelMeetingExcuse({ meetingId: MEETING_ID });
    expect(
      await db.meetingAttendance.findUnique({
        where: { meetingId_tutorId: { meetingId: MEETING_ID, tutorId: TUTOR_ID } },
      }),
    ).toBeNull();

    // Within 45 minutes: both excuse and cancel reject with BAD_REQUEST.
    await db.tutorMeeting.update({
      where: { id: MEETING_ID },
      data: { date: new Date(Date.now() + 44 * 60_000) },
    });
    await expect(
      tutorCaller().tutor.excuseMeeting({
        meetingId: MEETING_ID,
        reason: "Too late",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      tutorCaller().tutor.cancelMeetingExcuse({ meetingId: MEETING_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("serializes concurrent staff attendance writes and tutor self-excuse/cancel calls with consistent final ownership", async () => {
    // Uncoordinated concurrent race: either staff wins first (tutor gets CONFLICT),
    // or tutor commits first and staff either overrides cleanly or hits PostgreSQL SSI
    // write-conflict (P2034) and succeeds on retry with excusedAt/reason cleared.
    const [staffRes, excuseRes] = await Promise.allSettled([
      headCaller().admin.recordMeetingAttendance({
        meetingId: MEETING_ID,
        entries: [{ tutorId: TUTOR_ID, status: "PRESENT" }],
      }),
      tutorCaller().tutor.excuseMeeting({
        meetingId: MEETING_ID,
        reason: "Concurrent excuse",
      }),
    ]);
    if (staffRes.status === "fulfilled") {
      const row = await db.meetingAttendance.findUniqueOrThrow({
        where: { meetingId_tutorId: { meetingId: MEETING_ID, tutorId: TUTOR_ID } },
      });
      expect(row.status).toBe("PRESENT");
      expect(row.excusedAt).toBeNull();
      expect(row.reason).toBeNull();
      if (excuseRes.status === "rejected") {
        expect(excuseRes.reason).toMatchObject({ code: "CONFLICT" });
      }
    } else {
      // Tutor committed first during staff's Serializable snapshot; no corrupted state.
      expect(excuseRes.status).toBe("fulfilled");
      const mid = await db.meetingAttendance.findUniqueOrThrow({
        where: { meetingId_tutorId: { meetingId: MEETING_ID, tutorId: TUTOR_ID } },
      });
      expect(mid.status).toBe("EXCUSED_ABSENT");
      expect(mid.excusedAt).not.toBeNull();
      // Retrying staff write cleanly overrides and clears excusedAt/reason.
      await headCaller().admin.recordMeetingAttendance({
        meetingId: MEETING_ID,
        entries: [{ tutorId: TUTOR_ID, status: "PRESENT" }],
      });
      const finalRow = await db.meetingAttendance.findUniqueOrThrow({
        where: { meetingId_tutorId: { meetingId: MEETING_ID, tutorId: TUTOR_ID } },
      });
      expect(finalRow.status).toBe("PRESENT");
      expect(finalRow.excusedAt).toBeNull();
      expect(finalRow.reason).toBeNull();
    }

    // Also verify competing staff save vs tutor cancel on a fresh self-excuse never leaves a deleted/corrupted staff row.
    await db.meetingAttendance.deleteMany({ where: { meetingId: MEETING_ID } });
    await tutorCaller().tutor.excuseMeeting({
      meetingId: MEETING_ID,
      reason: "Will race cancel vs staff",
    });
    const [staffCancelRace, cancelRes] = await Promise.allSettled([
      headCaller().admin.recordMeetingAttendance({
        meetingId: MEETING_ID,
        entries: [{ tutorId: TUTOR_ID, status: "EXEMPT" }],
      }),
      tutorCaller().tutor.cancelMeetingExcuse({ meetingId: MEETING_ID }),
    ]);
    const finalRow = await db.meetingAttendance.findUnique({
      where: { meetingId_tutorId: { meetingId: MEETING_ID, tutorId: TUTOR_ID } },
    });
    if (staffCancelRace.status === "fulfilled") {
      // Staff won or committed after cancel: EXEMPT must exist with excusedAt: null.
      expect(finalRow).toMatchObject({
        status: "EXEMPT",
        excusedAt: null,
        reason: null,
      });
      if (cancelRes.status === "rejected") {
        expect(cancelRes.reason).toMatchObject({ code: "CONFLICT" });
      }
    } else {
      // Cancel committed first during staff's SSI snapshot; row is cleanly deleted.
      expect(cancelRes.status).toBe("fulfilled");
      expect(finalRow).toBeNull();
    }
  });
});
