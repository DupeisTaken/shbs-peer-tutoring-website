import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";

// Run only in the coordinator's scheduled database slot. No global truncation:
// this regression owns and removes only its prefixed, synthetic fixture rows.
assertIsolatedTestDatabase(process.env.DATABASE_URL);
const prefix = "viewer-model-regression-";
const privateNote = "PRIVATE_VIEWER_MODEL_NOTE\n私人记录";
const contact = "viewer-model-private@example.test";
const tutorId = `${prefix}tutor`;
const tuteeId = `${prefix}tutee`;
const sessionId = `${prefix}session`;
const appId = `${prefix}application`;
const auditId = `${prefix}audit`;
const pairingId = `${prefix}pairing`;
const termId = `${prefix}term`;
const actors = ["viewer", "observer", "HEAD", "ADMIN", "COORDINATOR"] as const;
type Actor = (typeof actors)[number];
const role = (actor: Actor): Session["role"] =>
  actor === "viewer" ? "VIEWER" : actor === "observer" ? "STUDENT" : actor;
const caller = (actor: Actor) =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: prefix + actor },
      role: role(actor),
      tutorId: null,
      expires: "2099-01-01",
    },
  });
async function cleanup() {
  await db.auditLog.deleteMany({ where: { id: auditId } });
  await db.tutorApplication.deleteMany({ where: { id: appId } });
  await db.sessionTutee.deleteMany({ where: { sessionId } });
  await db.session.deleteMany({ where: { id: sessionId } });
  await db.pairing.deleteMany({ where: { id: pairingId } });
  await db.tutee.deleteMany({ where: { id: tuteeId } });
  await db.tutor.deleteMany({ where: { id: tutorId } });
  await db.term.deleteMany({ where: { id: termId } });
  await db.user.deleteMany({
    where: { id: { in: actors.map((actor) => prefix + actor) } },
  });
}
beforeAll(async () => {
  await cleanup();
  await db.user.createMany({
    data: actors.map((actor) => ({
      id: prefix + actor,
      name: actor,
      role: role(actor),
      email: `${prefix}${actor.toLowerCase()}@example.test`,
    })),
  });
  await db.schoolDeparture.create({
    data: { userId: prefix + "observer", reason: "GRADUATED", source: "TEST" },
  });
  await db.tutor.create({
    data: { id: tutorId, englishName: "Synthetic Tutor" },
  });
  await db.tutee.create({
    data: { id: tuteeId, englishName: "Synthetic Tutee" },
  });
  await db.term.create({
    data: {
      id: termId,
      name: "Synthetic history",
      schoolYear: "87-88",
      quarter: "Q4",
    },
  });
  await db.pairing.create({
    data: {
      id: pairingId,
      subject: "Math",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
      tutorId,
      termId,
    },
  });
  await db.session.create({
    data: {
      id: sessionId,
      date: new Date("2026-10-01"),
      month: "2026-10",
      schoolYear: "87-88",
      quarter: "Q4",
      startMin: 900,
      endMin: 960,
      durationMin: 60,
      shFactor: 1,
      shCount: 1,
      tutorId,
      pairingId,
      comments: privateNote,
      tutorAbsentReason: privateNote,
      tutees: {
        create: {
          tuteeId,
          status: "EXCUSED_ABSENT",
          absenceReason: privateNote,
        },
      },
    },
  });
  await db.tutorApplication.create({
    data: {
      id: appId,
      name: "Synthetic Applicant",
      email: contact,
      preferredContact: privateNote,
      decisionComment: privateNote,
    },
  });
  // Match the legacy appeal writer: private reason embedded in action, no operation.
  await db.auditLog.create({
    data: {
      id: auditId,
      kind: "DECISION",
      action: `Appeal upheld: ${privateNote}`,
      entity: "StudentAppeal",
      details: { privateNote },
    },
  });
});
afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await db.$disconnect();
  }
});

it.each(["viewer", "observer"] as const)(
  "minimizes stored %s reads and cannot search hidden audit text",
  async (actor) => {
    const api = caller(actor);
    const session = (await api.admin.sessions({ month: "2026-10" })).find(
      (row) => row.id === sessionId,
    );
    const corrections = await api.corrections.attendance({ id: sessionId });
    const application = (await api.admin.tutorApplications()).find(
      (row) => row.id === appId,
    );
    const audit = (await api.admin.auditLog({ entity: "StudentAppeal" })).find(
      (row) => row.id === auditId,
    );
    expect(session).toMatchObject({
      shCount: 1,
      comments: null,
      tutorAbsentReason: null,
      tutor: { englishName: "Synthetic Tutor" },
    });
    expect(corrections[0]?.tutees[0]).toMatchObject({
      absenceReason: null,
      status: "EXCUSED_ABSENT",
    });
    expect(application).toMatchObject({
      name: "Synthetic Applicant",
      email: null,
      decisionComment: null,
    });
    expect(audit).toMatchObject({
      action: "Management decision",
      details: null,
      undoData: null,
    });
    const wire = JSON.stringify({ session, corrections, application, audit });
    expect(wire).not.toContain("PRIVATE_VIEWER_MODEL_NOTE");
    expect(wire).not.toContain(contact);
    expect(
      await api.admin.auditLog({ search: "PRIVATE_VIEWER_MODEL_NOTE" }),
    ).toEqual([]);
    expect(
      (await api.admin.auditLog({ search: "StudentAppeal" })).some(
        (row) => row.id === auditId,
      ),
    ).toBe(true);
  },
);

it.each(["HEAD", "ADMIN", "COORDINATOR"] as const)(
  "retains %s staff access to stored evidence",
  async (actor) => {
    const api = caller(actor);
    expect(
      (await api.admin.sessions({ month: "2026-10" })).find(
        (row) => row.id === sessionId,
      )?.comments,
    ).toBe(privateNote);
    expect(
      (await api.admin.tutorApplications()).find((row) => row.id === appId),
    ).toMatchObject({ email: contact, decisionComment: privateNote });
    expect(
      (await api.admin.auditLog({ search: "PRIVATE_VIEWER_MODEL_NOTE" })).find(
        (row) => row.id === auditId,
      )?.action,
    ).toContain(privateNote);
  },
);
