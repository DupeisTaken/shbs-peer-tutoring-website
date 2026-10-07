import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import {
  updateAccountProfile,
  lockAccountProfile,
} from "~/server/account-profile";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { personNameSchema } from "~/lib/person-name";
const defaults = {
  requireLatinNames: true,
  requireLatinLegalNames: false,
  usePreferredNames: true,
  showAlternateNames: false,
  offeredGrades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};
const caller = () =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: "name-head", name: "Head" },
      role: "HEAD",
      tutorId: null,
      expires: "2099-01-01",
    },
  });
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw Error("Wrong database");
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
  await db.user.create({
    data: {
      id: "name-head",
      email: "head@example.test",
      name: "Head",
      role: "HEAD",
    },
  });
  await db.tutor.create({
    data: { id: "name-tutor", englishName: "Original" },
  });
  await db.tutee.create({
    data: {
      id: "name-student",
      englishName: "Original",
      signatureName: "Original signature",
    },
  });
  await db.user.create({
    data: {
      id: "name-user",
      email: "person@example.test",
      name: "Original",
      username: "stablehandle",
      tutorId: "name-tutor",
      studentId: "name-student",
    },
  });
  await updateAccountProfile(db, "name-user", {
    firstName: "Alexander",
    lastName: "Chen",
    preferredName: "Alex",
    alternativeNames: "陈晓明",
  });
});
afterAll(() => db.$disconnect());

it("uses preferred names before settings exist and refreshes linked labels on the first opt-out", async () => {
  const read = () => db.user.findUniqueOrThrow({
    where: { id: "name-user" }, include: { tutor: true, student: true },
  });
  expect(await db.programSettings.findUnique({ where: { id: "program" } })).toBeNull();
  expect(await read()).toMatchObject({
    name: "Alex Chen", tutor: { englishName: "Alex Chen" }, student: { englishName: "Alex Chen" },
  });
  await caller().program.setProfilePolicy({
    ...defaults, usePreferredNames: false, expectedPolicy: defaults,
  });
  expect(await read()).toMatchObject({
    name: "Alexander Chen", preferredName: "Alex", username: "stablehandle",
    tutor: { englishName: "Alexander Chen" },
    student: { englishName: "Alexander Chen", signatureName: "Original signature" },
  });
});

it.each([undefined, null, "", "   "])(
  "falls back to legal name for preferred name %s under the new default",
  async (preferredName) => {
    const user = await db.user.create({ data: {
      email: "fallback@example.test",
      name: "Original label", firstName: "Alexander", lastName: "Chen", preferredName,
    } });
    expect(user.name).toBe("Alexander Chen");
  },
);
it.each([
  [false, false, "Alexander Chen"],
  [true, false, "Alex Chen"],
  [false, true, "Alexander Chen · 陈晓明"],
  [true, true, "Alex Chen · 陈晓明"],
] as const)(
  "renders current names consistently (preferred=%s, alternate=%s)",
  async (usePreferredNames, showAlternateNames, label) => {
    const before = await db.user.findUniqueOrThrow({
      where: { id: "name-user" },
    });
    const settings = await caller().program.setProfilePolicy({
      ...defaults,
      usePreferredNames,
      showAlternateNames,
      expectedPolicy: defaults,
    });
    const user = await db.user.findUniqueOrThrow({
      where: { id: "name-user" },
      include: { tutor: true, student: true },
    });
    expect(user).toMatchObject({
      name: label,
      firstName: "Alexander",
      lastName: "Chen",
      preferredName: "Alex",
      alternativeNames: "陈晓明",
      username: "stablehandle",
      profileVersion: before.profileVersion,
      legacyName: "Original",
      tutor: { englishName: label },
      student: { englishName: label, signatureName: "Original signature" },
    });
    await caller().program.setProfilePolicy({
      ...defaults,
      expectedPolicy: settings,
    });
    expect(await db.user.findUnique({ where: { id: user.id } })).toMatchObject({
      name: "Alex Chen",
      preferredName: "Alex",
      alternativeNames: "陈晓明",
    });
  },
);
it("falls back for empty optional names and supports a single given name", async () => {
  await updateAccountProfile(db, "name-user", {
    firstName: "José",
    lastName: "",
    preferredName: " ",
    alternativeNames: null,
  });
  await caller().program.setProfilePolicy({
    ...defaults,
    usePreferredNames: true,
    showAlternateNames: true,
    expectedPolicy: defaults,
  });
  expect(
    await db.user.findUnique({ where: { id: "name-user" } }),
  ).toMatchObject({ name: "José", preferredName: null, lastName: "" });
});
it.each(["firstName", "lastName", "preferredName"] as const)(
  "rejects non-Latin %s without partial writes",
  async (field) => {
    await expect(
      updateAccountProfile(db, "name-user", {
        firstName: "Alice",
        lastName: "Chen",
        preferredName: "Ali",
        [field]: "王",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "PROFILE_LATIN_NAME_REQUIRED",
    });
    expect(
      await db.user.findUnique({ where: { id: "name-user" } }),
    ).toMatchObject({ name: "Alex Chen", profileVersion: 1 });
  },
);
it("preserves unstructured names and unconfirmed historical tutor splits through display changes", async () => {
  await db.tutor.create({
    data: {
      id: "historical",
      englishName: "王小明",
      firstName: "Incorrect",
      lastName: "Guess",
      nameFieldsConfirmed: false,
      alternativeNames: "任意文字",
    },
  });
  const settings = await caller().program.setProfilePolicy({
    ...defaults,
    usePreferredNames: true,
    showAlternateNames: true,
    expectedPolicy: defaults,
  });
  expect(
    await db.tutor.findUnique({ where: { id: "historical" } }),
  ).toMatchObject({
    englishName: "王小明 · 任意文字",
    firstName: "Incorrect",
    lastName: "Guess",
    legacyName: "王小明",
    nameFieldsConfirmed: false,
  });
  await caller().program.setProfilePolicy({
    ...defaults,
    expectedPolicy: settings,
  });
  expect(
    await db.tutor.findUnique({ where: { id: "historical" } }),
  ).toMatchObject({ englishName: "王小明" });
});
it("refuses an old display-string edit to structured fields instead of silently ignoring it", async () => {
  await expect(
    updateAccountProfile(db, "name-user", { name: "Unrelated Name" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    await db.user.findUnique({ where: { id: "name-user" } }),
  ).toMatchObject({ name: "Alex Chen", profileVersion: 1 });
});
it("refreshes settings atomically after a concurrent account edit", async () => {
  let unlock!: () => void;
  let announce!: () => void;
  const ready = new Promise<void>((r) => (announce = r));
  const released = new Promise<void>((r) => (unlock = r));
  const edit = db.$transaction(async (tx) => {
    await lockAccountProfile(tx, "name-user");
    announce();
    await released;
    await updateAccountProfile(tx, "name-user", { preferredName: "Lex" });
  });
  await ready;
  const change = caller().program.setProfilePolicy({
    ...defaults,
    usePreferredNames: true,
    showAlternateNames: true,
    expectedPolicy: defaults,
  });
  // Observe the actual table lock before releasing the profile transaction.
  let waiting = false;
  try {
    for (let i = 0; i < 100; i++) {
      const rows = await db.$queryRaw<
        { n: bigint }[]
      >`SELECT count(*) n FROM pg_locks WHERE relation='"User"'::regclass AND mode='ExclusiveLock' AND NOT granted`;
      if (Number(rows[0]?.n)) {
        waiting = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  } finally {
    unlock();
  }
  await edit;
  await change;
  expect(waiting).toBe(true);
  expect(
    await db.user.findUnique({
      where: { id: "name-user" },
      include: { tutor: true, student: true },
    }),
  ).toMatchObject({
    name: "Lex Chen · 陈晓明",
    preferredName: "Lex",
    tutor: { englishName: "Lex Chen · 陈晓明" },
    student: { englishName: "Lex Chen · 陈晓明" },
  });
});
it("preserves accents and Unicode alternate names in the shared validator", () => {
  expect(
    personNameSchema.parse({
      firstName: "José",
      lastName: "O’Connor",
      preferredName: "Jean-Luc",
      alternativeNames: "王小明 / Николай",
    }),
  ).toMatchObject({
    firstName: "José",
    preferredName: "Jean-Luc",
    alternativeNames: "王小明 / Николай",
  });
});

it.each([false, true])(
  "preserves legacy tutee identity during notes-only edits (linked=%s)",
  async (linked) => {
    const row = await db.tutee.create({
      data: { englishName: "张小明", status: "INACTIVE" },
    });
    if (linked)
      await db.user.create({
        data: {
          name: "张小明",
          email: "legacy@example.test",
          studentId: row.id,
        },
      });
    await caller().admin.updateTutee({
      id: row.id,
      expectedUpdatedAt: row.updatedAt,
      englishName: row.englishName,
      status: "INACTIVE",
      notes: "Corrected notes",
    });
    expect(
      await db.tutee.findUniqueOrThrow({ where: { id: row.id } }),
    ).toMatchObject({
      englishName: "张小明",
      firstName: null,
      lastName: null,
      notes: "Corrected notes",
    });
  },
);
it.each([false, true])(
  "preserves legacy tutor identity and confirmation provenance (linked=%s)",
  async (linked) => {
    const row = await db.tutor.create({
      data: {
        englishName: "王小明",
        status: "ARCHIVED",
        alternativeNames: "Original alias",
        nameFieldsConfirmed: false,
      },
    });
    if (linked)
      await db.user.create({
        data: {
          name: "王小明",
          email: "legacy@example.test",
          tutorId: row.id,
          alternativeNames: "Original alias",
          username: "legacyuser",
        },
      });
    await caller().admin.updateTutor({
      id: row.id,
      expectedUpdatedAt: row.updatedAt,
      status: "ARCHIVED",
    });
    expect(
      await db.tutor.findUniqueOrThrow({ where: { id: row.id } }),
    ).toMatchObject({
      englishName: "王小明",
      firstName: null,
      lastName: null,
      preferredName: null,
      alternativeNames: "Original alias",
      nameFieldsConfirmed: false,
    });
  },
);
it.each([
  { lastName: "Chen" },
  { preferredName: "Alex" },
  { firstName: "王" },
  { firstName: "" },
])(
  "rejects incomplete or non-Latin legacy tutor conversions: %j",
  async (fields) => {
    const row = await db.tutor.create({
      data: { englishName: "王小明", status: "ARCHIVED" },
    });
    await expect(
      caller().admin.updateTutor({ id: row.id, status: "ARCHIVED", ...fields }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await db.tutor.findUniqueOrThrow({ where: { id: row.id } }),
    ).toMatchObject({ englishName: "王小明", firstName: null });
  },
);
it("converts a legacy tutor only when a valid explicit first name is supplied", async () => {
  const row = await db.tutor.create({
    data: { englishName: "王小明", status: "ARCHIVED" },
  });
  await caller().admin.updateTutor({
    id: row.id,
    status: "ARCHIVED",
    firstName: "José",
    lastName: "García",
  });
  expect(
    await db.tutor.findUniqueOrThrow({ where: { id: row.id } }),
  ).toMatchObject({
    englishName: "José García",
    firstName: "José",
    lastName: "García",
    nameFieldsConfirmed: true,
  });
});
it("allows an account alias correction without inventing structured legacy names", async () => {
  const account = await db.user.create({
    data: { name: "张小明", email: "legacy@example.test" },
  });
  await caller().admin.updateAccountProfile({
    userId: account.id,
    name: "张小明",
    alternativeNames: "小明",
    expectedProfileVersion: 0,
  });
  expect(
    await db.user.findUniqueOrThrow({ where: { id: account.id } }),
  ).toMatchObject({
    name: "张小明",
    firstName: null,
    lastName: null,
    alternativeNames: "小明",
  });
});

it.each([false, true])(
  "repeated legacy edits preserve the source name with alternate display enabled (linked=%s)",
  async (linked) => {
    await caller().program.setProfilePolicy({
      ...defaults,
      showAlternateNames: true,
      expectedPolicy: defaults,
    });
    const row = await db.tutee.create({
      data: {
        englishName: "张小明",
        alternativeNames: "Original alias",
        status: "INACTIVE",
      },
    });
    const user = linked
      ? await db.user.create({
          data: {
            name: "张小明",
            email: "legacy@example.test",
            studentId: row.id,
            alternativeNames: "Original alias",
          },
        })
      : null;
    for (const alias of ["New alias", "Final alias"]) {
      const latest = await db.tutee.findUniqueOrThrow({
        where: { id: row.id },
      });
      await caller().admin.updateTutee({
        id: row.id,
        expectedUpdatedAt: latest.updatedAt,
        englishName: "张小明",
        alternativeNames: alias,
        status: "INACTIVE",
        notes: alias,
      });
      expect(
        await db.tutee.findUniqueOrThrow({ where: { id: row.id } }),
      ).toMatchObject({
        englishName: `张小明 · ${alias}`,
        legacyName: "张小明",
        firstName: null,
      });
    }
    if (user) {
      const latest = await db.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      await caller().admin.updateAccountProfile({
        userId: user.id,
        expectedProfileVersion: latest.profileVersion,
        name: "张小明",
        alternativeNames: "Account alias",
      });
      expect(
        await db.user.findUniqueOrThrow({ where: { id: user.id } }),
      ).toMatchObject({
        name: "张小明 · Account alias",
        legacyName: "张小明",
        firstName: null,
      });
    }
  },
);
