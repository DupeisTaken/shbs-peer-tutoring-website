/**
 * Seed script for local/dev databases.
 *
 * Idempotent: uses fixed ids + upserts so it can be run repeatedly.
 * Run with `npm run db:seed` (after the database is up and migrated).
 */
import { PrismaClient } from "../generated/prisma";
import { hashPassword } from "../src/server/auth/password";

const db = new PrismaClient();

/**
 * Dev-only login password shared by every seeded user. CHANGE THIS before any real use —
 * these accounts exist only to make local development usable. See README-LOCAL.md.
 */
const DEV_PASSWORD = "Password123!";

/** Convert "HH:MM" to minutes from midnight. */
function hm(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const ROOMS = [
  { id: "room-a101", name: "A101" },
  { id: "room-a102", name: "A102" },
  { id: "room-b201", name: "B201" },
  { id: "room-library", name: "Library" },
];

const TUTORS = [
  { id: "tutor-alice", englishName: "Alice Chen", email: "alice@example.edu", active: true },
  { id: "tutor-bob", englishName: "Bob Liu", email: "bob@example.edu", active: true },
  { id: "tutor-carol", englishName: "Carol Wang", email: "carol@example.edu", active: true },
  { id: "tutor-david", englishName: "David Zhao", email: null, active: false },
];

const TUTEES = [
  { id: "tutee-emma", englishName: "Emma Sun" },
  { id: "tutee-frank", englishName: "Frank Wu" },
  { id: "tutee-grace", englishName: "Grace Lin" },
  { id: "tutee-henry", englishName: "Henry Xu" },
  { id: "tutee-ivy", englishName: "Ivy Yang" },
  { id: "tutee-jack", englishName: "Jack Zhou" },
];

async function main() {
  // --- Term ------------------------------------------------------------------
  const term = await db.term.upsert({
    where: { id: "term-2025-q3" },
    update: { name: "2025-2026 Q3", quarter: "Q3", active: true },
    create: { id: "term-2025-q3", name: "2025-2026 Q3", quarter: "Q3", active: true },
  });

  // --- Rooms -----------------------------------------------------------------
  for (const room of ROOMS) {
    await db.room.upsert({
      where: { id: room.id },
      update: { name: room.name },
      create: room,
    });
  }

  // --- Tutors ----------------------------------------------------------------
  for (const tutor of TUTORS) {
    await db.tutor.upsert({
      where: { id: tutor.id },
      update: { englishName: tutor.englishName, email: tutor.email, active: tutor.active },
      create: tutor,
    });
  }

  // --- Tutees ----------------------------------------------------------------
  for (const tutee of TUTEES) {
    await db.tutee.upsert({
      where: { id: tutee.id },
      update: { englishName: tutee.englishName },
      create: tutee,
    });
  }

  // --- Pairings (with rostered tutees) ---------------------------------------
  const pairings = [
    {
      id: "pairing-alice-math",
      tutorId: "tutor-alice",
      subject: "Mathematics",
      dayOfWeek: 1, // Monday
      start: "15:30",
      end: "16:30",
      roomId: "room-a101",
      tuteeIds: ["tutee-emma", "tutee-frank"],
    },
    {
      id: "pairing-bob-physics",
      tutorId: "tutor-bob",
      subject: "Physics",
      dayOfWeek: 3, // Wednesday
      start: "16:00",
      end: "17:00",
      roomId: "room-b201",
      tuteeIds: ["tutee-grace"],
    },
    {
      id: "pairing-carol-english",
      tutorId: "tutor-carol",
      subject: "English",
      dayOfWeek: 5, // Friday
      start: "15:00",
      end: "16:15",
      roomId: "room-library",
      tuteeIds: ["tutee-henry", "tutee-ivy", "tutee-jack"],
    },
  ];

  for (const p of pairings) {
    await db.pairing.upsert({
      where: { id: p.id },
      update: {
        subject: p.subject,
        dayOfWeek: p.dayOfWeek,
        startMin: hm(p.start),
        endMin: hm(p.end),
        tutorId: p.tutorId,
        termId: term.id,
        roomId: p.roomId,
      },
      create: {
        id: p.id,
        subject: p.subject,
        dayOfWeek: p.dayOfWeek,
        startMin: hm(p.start),
        endMin: hm(p.end),
        tutorId: p.tutorId,
        termId: term.id,
        roomId: p.roomId,
      },
    });

    // Roster join rows (idempotent).
    for (const tuteeId of p.tuteeIds) {
      await db.pairingTutee.upsert({
        where: { pairingId_tuteeId: { pairingId: p.id, tuteeId } },
        update: {},
        create: { pairingId: p.id, tuteeId },
      });
    }
  }

  // --- Dev login users -------------------------------------------------------
  // Password auth: these accounts let you sign in locally. The TUTOR user is linked
  // to a Tutor by id; the jwt callback also links by matching email at sign-in.
  const passwordHash = hashPassword(DEV_PASSWORD);
  const users = [
    { id: "user-admin", name: "Admin", email: "admin@example.edu", role: "ADMIN" as const, tutorId: null },
    { id: "user-alice", name: "Alice Chen", email: "alice@example.edu", role: "TUTOR" as const, tutorId: "tutor-alice" },
  ];
  for (const u of users) {
    await db.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, tutorId: u.tutorId, passwordHash },
      create: {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        tutorId: u.tutorId,
        passwordHash,
      },
    });
  }

  console.log(
    `Seeded: 1 term, ${ROOMS.length} rooms, ${TUTORS.length} tutors, ${TUTEES.length} tutees, ` +
      `${pairings.length} pairings, ${users.length} login users (password "${DEV_PASSWORD}").`,
  );
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
