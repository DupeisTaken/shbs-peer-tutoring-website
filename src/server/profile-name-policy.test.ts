import { promoteApplicantToTutor } from "~/server/tutors/promote";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
const delivery = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: delivery.send },
  isEmailConfigured: () => true,
  isEmailDeliveryAvailable: () => true,
}));
vi.mock("~/server/rate-limit", () => ({ rateLimit: () => ({ ok: true }) }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { isLatinPrimaryName } from "~/lib/profile-policy";
import {
  lockAccountProfile,
  updateAccountProfile,
} from "~/server/account-profile";
import { currentPolicy } from "~/server/policy-acceptance";
import {
  startViewerSignup,
  verifyViewerCode,
  completeViewerSignup,
} from "~/server/auth/viewer-signup";
import {
  issueRegistrationCode,
  setEmailVerification,
  confirmEmailCode,
  completeRegistration,
} from "~/server/auth/registration";
import {
  submitSurvey,
  confirmSurvey,
  surveyInput,
} from "~/server/student-survey";

const policyError = {
  code: "BAD_REQUEST",
  message: "PROFILE_LATIN_NAME_REQUIRED",
};
const password = "PolicyTestPassword42!";
let serial = 0;
const publicCaller = () =>
  createCaller({
    db,
    session: null,
    headers: new Headers({ "x-real-ip": `name-policy-${++serial}` }),
  });
const setRequired = (required: boolean) =>
  db.programSettings.upsert({
    where: { id: "program" },
    create: { id: "program", requireLatinNames: required },
    update: { requireLatinNames: required },
  });

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw Error("Use shbs_shipping_test");
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((t) => '"' + t.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  delivery.send.mockReset().mockResolvedValue(undefined);
  await setRequired(true);
  await db.term.create({
    data: {
      id: "policy-term",
      name: "Policy term",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  await db.subject.create({ data: { id: "policy-math", name: "Math" } });
  await db.timeSlot.create({
    data: {
      id: "policy-slot",
      label: "After school",
      dayOfWeek: 1,
      startMin: 960,
      endMin: 1020,
    },
  });
  await db.policyDocument.createMany({
    data: ["tutor-policy", "tutee-policy"].map((slug) => ({
      slug,
      locale: "en",
      title: "Policy",
      body: "Synthetic policy",
    })),
  });
});
afterAll(() => db.$disconnect());

it.each([
  "José García",
  "Jose\u0301 Garci\u0301a",
  "Zoë O’Connor",
  "Jean-Luc",
  "Łukasz",
  "Madonna",
])("accepts Latin-script name %s without stripping accents", async (name) => {
  expect(isLatinPrimaryName(name)).toBe(true);
  const started = await startViewerSignup({
    email: "accent@example.test",
    name,
    affiliation: "Family",
  });
  expect(started.ok).toBe(true);
  expect(
    (
      await db.viewerSignup.findUniqueOrThrow({
        where: { email: "accent@example.test" },
      })
    ).name,
  ).toBe(name);
});

it.each([
  "王小明",
  "Аlice Chen",
  "Ali\u200bce",
  "Alice123",
  "Alice🙂",
  "\u0301Alice",
])(
  "rejects non-Latin or spoofed primary name %s through direct API",
  async (name) => {
    expect(isLatinPrimaryName(name)).toBe(false);
    await expect(
      publicCaller().viewer.start({
        email: "invalid@example.test",
        name,
        affiliation: "Family",
      }),
    ).rejects.toMatchObject(policyError);
    expect(await db.viewerSignup.count()).toBe(0);
    expect(delivery.send).not.toHaveBeenCalled();
  },
);

it("keeps existing non-Latin identity and unrestricted secondary names but rejects a changed non-Latin primary", async () => {
  const tutor = await db.tutor.create({
    data: { englishName: "王小明", username: "stablehandle" },
  });
  const user = await db.user.create({
    data: {
      name: "王小明",
      email: "legacy@example.test",
      role: "TUTOR",
      tutorId: tutor.id,
      username: "stablehandle",
    },
  });
  await updateAccountProfile(db, user.id, {
    alternativeNames: "小明 / Николай",
  });
  const caller = createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: user.id, name: user.name, email: user.email },
      role: "TUTOR",
      tutorId: tutor.id,
      expires: "2099-01-01",
    },
  });
  await expect(
    caller.account.updateName({ name: "王小明", alternativeNames: "任意文字" }),
  ).resolves.toEqual({ ok: true });
  const version = (await db.user.findUniqueOrThrow({ where: { id: user.id } }))
    .profileVersion;
  await expect(
    caller.account.updateName({
      name: "李小明",
      expectedProfileVersion: version,
    }),
  ).rejects.toMatchObject(policyError);
  expect(await db.user.findUnique({ where: { id: user.id } })).toMatchObject({
    name: "王小明",
    alternativeNames: "任意文字",
    profileVersion: version,
    username: "stablehandle",
  });
  expect(await db.tutor.findUnique({ where: { id: tutor.id } })).toMatchObject({
    englishName: "王小明",
    alternativeNames: "任意文字",
    username: "stablehandle",
  });
  await caller.account.updateName({
    name: "Xiaoming Wang",
    expectedProfileVersion: version,
  });
  expect(await db.user.findUnique({ where: { id: user.id } })).toMatchObject({
    name: "Xiaoming Wang",
    username: "stablehandle",
  });
});

async function tutorInput(name: string, email = "applicant@example.test") {
  return {
    name,
    email,
    agreed: true as const,
    policyRevision: (await currentPolicy(db, "tutor-policy")).revision,
    preferredContact: "Email",
    subjects: [{ subjectId: "policy-math" }],
  };
}
it("enforces new tutor and crew application names while preserving historical duplicate submissions", async () => {
  await expect(
    publicCaller().application.submit(await tutorInput("王小明")),
  ).rejects.toMatchObject(policyError);
  await expect(
    publicCaller().crew.submitApplication({
      name: "王小明",
      email: "crew@example.test",
    }),
  ).rejects.toMatchObject(policyError);
  expect(await db.tutorApplication.count()).toBe(0);
  expect(await db.crewApplication.count()).toBe(0);
  expect(await db.publicApplicationRateLimit.count()).toBe(0);
  await setRequired(false);
  await publicCaller().application.submit(await tutorInput("王小明"));
  await publicCaller().crew.submitApplication({
    name: "王小明",
    email: "crew@example.test",
    gradeLevel: 4,
  });
  await setRequired(true);
  await db.programSettings.update({
    where: { id: "program" },
    data: { offeredGrades: [10, 11, 12] },
  });
  await publicCaller().application.submit(await tutorInput("李小明"));
  await publicCaller().crew.submitApplication({
    name: "李小明",
    email: "crew@example.test",
    gradeLevel: 4,
  });
  expect(await db.tutorApplication.findFirst()).toMatchObject({
    name: "王小明",
  });
  expect(await db.crewApplication.findFirst()).toMatchObject({
    name: "王小明",
    gradeLevel: 4,
  });
  await expect(
    publicCaller().crew.submitApplication({
      name: "Alice Chen",
      email: "newcrew@example.test",
      gradeLevel: 4,
    }),
  ).rejects.toMatchObject({ message: "PROFILE_GRADE_NOT_OFFERED" });
});

it("rechecks an in-flight viewer signup at completion without consuming the verified challenge", async () => {
  await setRequired(false);
  const email = "inflight-viewer@example.test";
  const started = await startViewerSignup({
    email,
    name: "王小明",
    affiliation: "Family",
  });
  if (!started.ok) throw Error("Expected viewer signup");
  const verified = await verifyViewerCode(email, started.code);
  if (!verified.ok) throw Error("Expected verified signup");
  await setRequired(true);
  await expect(
    publicCaller().viewer.complete({
      email,
      password,
      completionProof: verified.completionProof,
    }),
  ).rejects.toMatchObject(policyError);
  expect(await db.user.count({ where: { email } })).toBe(0);
  expect(await db.viewerSignup.findUnique({ where: { email } })).toMatchObject({
    usedAt: null,
  });
  await setRequired(false);
  expect(
    await completeViewerSignup(email, password, verified.completionProof),
  ).toEqual({ ok: true });
});

async function verifiedInvitation(email: string, kind: "TUTOR" | "CREW") {
  const issued = await issueRegistrationCode({ kind, email });
  let row = await db.registrationCode.findUniqueOrThrow({
    where: { id: issued.id },
  });
  const staged = await setEmailVerification(row, email);
  if (!staged.ok) throw Error("Expected challenge");
  row = await db.registrationCode.findUniqueOrThrow({
    where: { id: issued.id },
  });
  const verified = await confirmEmailCode(row, staged.emailCode);
  if (!verified.ok) throw Error("Expected verified invitation");
  row = await db.registrationCode.findUniqueOrThrow({
    where: { id: issued.id },
  });
  return { row, code: issued.code, completionProof: verified.completionProof };
}
it.each(["TUTOR", "CREW"] as const)(
  "checks %s registration completion for invitations issued before the name policy",
  async (kind) => {
    await setRequired(false);
    const email = "inflight-invitation@example.test";
    const invitation = await verifiedInvitation(email, kind);
    await setRequired(true);
    await expect(
      publicCaller().registration.complete({
        code: invitation.code,
        completionProof: invitation.completionProof,
        firstName: "王小明",
        lastName: "",
        preferredLatinName: "Xiaoming Wang",
        password,
      }),
    ).rejects.toMatchObject(policyError);
    expect(await db.user.count({ where: { email } })).toBe(0);
    expect(
      await db.registrationCode.findUnique({
        where: { id: invitation.row.id },
      }),
    ).toMatchObject({ usedAt: null });
    expect(
      await completeRegistration(invitation.row, {
        firstName: "Xiaoming",
        lastName: "Wang",
        alternativeNames: "王小明",
        password,
        completionProof: invitation.completionProof,
      }),
    ).toMatchObject({ ok: true });
  },
);

it("allows an unchanged legacy primary name during tutor registration but rejects a changed non-Latin name", async () => {
  const email = "legacy-invitation@example.test";
  const user = await db.user.create({
    data: {
      email,
      name: "王小明",
      username: "legacyhandle",
      role: "STUDENT",
      emailVerifiedAt: new Date(),
    },
  });
  const invitation = await verifiedInvitation(email, "TUTOR");
  const profile = {
    lastName: "",
    password,
    completionProof: invitation.completionProof,
  };
  await expect(
    completeRegistration(invitation.row, { ...profile, firstName: "李小明" }),
  ).rejects.toMatchObject(policyError);
  expect(await db.user.findUnique({ where: { id: user.id } })).toMatchObject({
    name: "王小明",
    username: "legacyhandle",
    tutorId: null,
  });
  expect(
    await completeRegistration(invitation.row, {
      ...profile,
      firstName: "王小明",
      alternativeNames: "任意文字",
    }),
  ).toMatchObject({ ok: true, username: "legacyhandle" });
  expect(await db.user.findUnique({ where: { id: user.id } })).toMatchObject({
    name: "王小明",
    alternativeNames: "任意文字",
    username: "legacyhandle",
  });
});

async function studentInput(
  englishName: string,
  email = "student-policy@example.test",
) {
  return surveyInput.parse({
    englishName,
    email,
    preferredContact: email,
    firstChoiceId: "policy-math",
    slotIds: ["policy-slot"],
    signatureName: englishName,
    agreed: true,
    policyRevision: (await currentPolicy(db, "tutee-policy")).revision,
  });
}
function lastStudentToken() {
  const sent = delivery.send.mock.calls.at(-1)?.[0] as
    { text?: string } | undefined;
  const token = /token=([a-f0-9]{64})/.exec(sent?.text ?? "")?.[1];
  if (!token) throw Error("Missing student verification link");
  return token;
}
it("checks a new student survey and rechecks pre-policy submissions when creating an account", async () => {
  await expect(
    submitSurvey(db, await studentInput("王小明")),
  ).rejects.toMatchObject(policyError);
  expect(await db.studentSurvey.count()).toBe(0);
  await setRequired(false);
  await submitSurvey(db, await studentInput("王小明"));
  const token = lastStudentToken();
  await setRequired(true);
  await expect(confirmSurvey(db, token, password)).rejects.toMatchObject(
    policyError,
  );
  expect(await db.user.count()).toBe(0);
  expect(await db.studentSurvey.findFirst()).toMatchObject({
    confirmedAt: null,
    tuteeId: null,
  });
  await setRequired(false);
  await expect(confirmSurvey(db, token, password)).resolves.toEqual({
    ok: true,
  });
});

it("enrolls an existing non-Latin account without replacing its canonical name or handle", async () => {
  const email = "student-policy@example.test";
  const user = await db.user.create({
    data: {
      email,
      name: "王小明",
      username: "stablemember",
      role: "STUDENT",
      emailVerifiedAt: new Date(),
    },
  });
  await submitSurvey(db, await studentInput("Untrusted Submitted Name", email));
  await confirmSurvey(db, lastStudentToken(), password);
  expect(
    await db.user.findUnique({
      where: { id: user.id },
      include: { student: true },
    }),
  ).toMatchObject({
    name: "王小明",
    username: "stablemember",
    student: { englishName: "王小明" },
  });
});

it("rejects promotion of an old non-Latin application before creating a new roster or invitation", async () => {
  const app = await db.tutorApplication.create({
    data: {
      name: "王小明",
      email: "old-applicant@example.test",
      type: "INITIAL",
    },
  });
  await expect(promoteApplicantToTutor(app.id)).rejects.toMatchObject(
    policyError,
  );
  expect(await db.tutor.count()).toBe(0);
  expect(await db.registrationCode.count()).toBe(0);
  expect(
    await db.tutorApplication.findUnique({ where: { id: app.id } }),
  ).toMatchObject({ name: "王小明", promotedTutorId: null });
});

it("grandfathers an unchanged roster when reactivating an old application", async () => {
  const email = "returning-applicant@example.test";
  const roster = await db.tutor.create({
    data: {
      englishName: "王小明",
      email,
      username: "stablemember",
      status: "OPTED_OUT",
    },
  });
  const app = await db.tutorApplication.create({
    data: { name: "Different Submitted Name", email, type: "INITIAL" },
  });
  await promoteApplicantToTutor(app.id);
  expect(await db.tutor.findUnique({ where: { id: roster.id } })).toMatchObject(
    { englishName: "王小明", username: "stablemember", status: "ACTIVE" },
  );
  expect(await db.registrationCode.count()).toBe(1);
});

it("uses an existing verified account's grandfathered name when promotion creates its roster", async () => {
  const email = "verified-applicant@example.test";
  const user = await db.user.create({
    data: {
      email,
      name: "王小明",
      username: "canonicalmember",
      role: "STUDENT",
      emailVerifiedAt: new Date(),
    },
  });
  const app = await db.tutorApplication.create({
    data: { name: "Different Submitted Name", email, type: "INITIAL" },
  });
  await promoteApplicantToTutor(app.id);
  expect(
    await db.user.findUnique({
      where: { id: user.id },
      include: { tutor: true },
    }),
  ).toMatchObject({
    name: "王小明",
    username: "canonicalmember",
    tutor: { englishName: "王小明", username: "canonicalmember" },
  });
  expect(await db.registrationCode.count()).toBe(0);
});

it("rechecks the current name after a concurrent profile edit before grandfathering an invitation name", async () => {
  const email = "concurrent-invitation@example.test";
  const user = await db.user.create({
    data: {
      email,
      name: "王小明",
      username: "stablehandle",
      role: "STUDENT",
      emailVerifiedAt: new Date(),
    },
  });
  const invitation = await verifiedInvitation(email, "TUTOR");
  let locked!: () => void;
  let proceed!: () => void;
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const release = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  const profileEdit = db.$transaction(async (tx) => {
    await lockAccountProfile(tx, user.id);
    locked();
    await release;
    await updateAccountProfile(tx, user.id, { name: "Xiaoming Wang" });
  });
  await ready;
  const registration = completeRegistration(invitation.row, {
    firstName: "王小明",
    lastName: "",
    password,
    completionProof: invitation.completionProof,
  }).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  let waiting = false;
  try {
    // Observe the real database lock wait, ensuring registration read the old name
    // before the account editor commits its new canonical primary name.
    for (let attempt = 0; attempt < 50; attempt++) {
      const rows = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event = 'advisory' AND pid <> pg_backend_pid()`;
      if (Number(rows[0]?.count) > 0) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    proceed();
  }
  await profileEdit;
  expect(await registration).toMatchObject({ error: policyError });
  expect(waiting).toBe(true);
  expect(await db.user.findUnique({ where: { id: user.id } })).toMatchObject({
    name: "Xiaoming Wang",
    username: "stablehandle",
    tutorId: null,
  });
  expect(
    await db.registrationCode.findUnique({ where: { id: invitation.row.id } }),
  ).toMatchObject({ usedAt: null });
  expect(await db.tutor.count()).toBe(0);
});

it("grandfathers an invited roster's unchanged name for its first login but rejects another non-Latin name", async () => {
  const email = "roster-invitation@example.test";
  const roster = await db.tutor.create({
    data: { email, englishName: "王小明", username: "rosterhandle" },
  });
  const invitation = await verifiedInvitation(email, "TUTOR");
  const row = await db.registrationCode.update({
    where: { id: invitation.row.id },
    data: { tutorId: roster.id },
  });
  const profile = {
    lastName: "",
    password,
    completionProof: invitation.completionProof,
  };
  await expect(
    completeRegistration(row, { ...profile, firstName: "李小明" }),
  ).rejects.toMatchObject(policyError);
  expect(await db.user.count({ where: { email } })).toBe(0);
  expect(await db.tutor.findUnique({ where: { id: roster.id } })).toMatchObject(
    { englishName: "王小明", username: "rosterhandle" },
  );
  expect(
    await db.registrationCode.findUnique({ where: { id: row.id } }),
  ).toMatchObject({ usedAt: null });
  expect(
    await completeRegistration(row, {
      ...profile,
      firstName: "王小明",
      alternativeNames: "Xiaoming Wang",
    }),
  ).toMatchObject({ ok: true, username: "rosterhandle" });
  expect(await db.user.findUnique({ where: { email } })).toMatchObject({
    name: "王小明",
    username: "rosterhandle",
    tutorId: roster.id,
    alternativeNames: "Xiaoming Wang",
  });
});
