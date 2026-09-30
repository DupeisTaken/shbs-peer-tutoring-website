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
  usePreferredNames: false,
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
      name: "Alexander Chen",
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
    ).toMatchObject({ name: "Alexander Chen", profileVersion: 1 });
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
  ).toMatchObject({ name: "Alexander Chen", profileVersion: 1 });
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
