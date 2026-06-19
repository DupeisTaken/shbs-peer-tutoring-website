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

const COURSES = [
  { id: "course-math", name: "Mathematics" },
  { id: "course-physics", name: "Physics" },
  { id: "course-english", name: "English" },
  { id: "course-chemistry", name: "Chemistry" },
  { id: "course-biology", name: "Biology" },
];

// Reference time-slot catalog (label + day + HH:MM start/end).
const TIME_SLOTS = [
  { id: "slot-mon-a", label: "Mon block A", dayOfWeek: 1, start: "15:30", end: "16:30" },
  { id: "slot-tue-a", label: "Tue block A", dayOfWeek: 2, start: "15:30", end: "16:30" },
  { id: "slot-wed-a", label: "Wed block A", dayOfWeek: 3, start: "16:00", end: "17:00" },
  { id: "slot-thu-a", label: "Thu block A", dayOfWeek: 4, start: "15:30", end: "16:30" },
  { id: "slot-fri-a", label: "Fri block A", dayOfWeek: 5, start: "15:00", end: "16:15" },
];

const TUTEES = [
  { id: "tutee-emma", englishName: "Emma Sun", gradeLevel: "9", status: "ACTIVE" as const, firstChoiceId: "course-math" },
  { id: "tutee-frank", englishName: "Frank Wu", gradeLevel: "10", status: "ACTIVE" as const, firstChoiceId: "course-math" },
  { id: "tutee-grace", englishName: "Grace Lin", gradeLevel: "9", status: "ACTIVE" as const, firstChoiceId: "course-physics" },
  { id: "tutee-henry", englishName: "Henry Xu", gradeLevel: "11", status: "ACTIVE" as const, firstChoiceId: "course-english" },
  { id: "tutee-ivy", englishName: "Ivy Yang", gradeLevel: "10", status: "ACTIVE" as const, firstChoiceId: "course-english" },
  { id: "tutee-jack", englishName: "Jack Zhou", gradeLevel: "12", status: "ACTIVE" as const, firstChoiceId: "course-english" },
];

// One example of a public self-signup awaiting admin review.
const PENDING_SIGNUP = {
  id: "tutee-pending-kate",
  englishName: "Kate Park",
  gradeLevel: "9",
  email: "kate@example.edu",
  status: "PENDING" as const,
  firstChoiceId: "course-chemistry",
  secondChoiceId: "course-biology",
  signatureName: "Kate Park",
  slotIds: ["slot-tue-a", "slot-thu-a"],
};

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

  // --- Courses ---------------------------------------------------------------
  for (const course of COURSES) {
    await db.course.upsert({
      where: { id: course.id },
      update: { name: course.name },
      create: course,
    });
  }

  // --- Time slots ------------------------------------------------------------
  for (const slot of TIME_SLOTS) {
    await db.timeSlot.upsert({
      where: { id: slot.id },
      update: {
        label: slot.label,
        dayOfWeek: slot.dayOfWeek,
        startMin: hm(slot.start),
        endMin: hm(slot.end),
      },
      create: {
        id: slot.id,
        label: slot.label,
        dayOfWeek: slot.dayOfWeek,
        startMin: hm(slot.start),
        endMin: hm(slot.end),
      },
    });
  }

  // --- Tutees ----------------------------------------------------------------
  for (const tutee of TUTEES) {
    await db.tutee.upsert({
      where: { id: tutee.id },
      update: {
        englishName: tutee.englishName,
        gradeLevel: tutee.gradeLevel,
        status: tutee.status,
        firstChoiceId: tutee.firstChoiceId,
      },
      create: tutee,
    });
  }

  // --- Pending public signup (with availability) -----------------------------
  await db.tutee.upsert({
    where: { id: PENDING_SIGNUP.id },
    update: {
      englishName: PENDING_SIGNUP.englishName,
      gradeLevel: PENDING_SIGNUP.gradeLevel,
      email: PENDING_SIGNUP.email,
      status: PENDING_SIGNUP.status,
      firstChoiceId: PENDING_SIGNUP.firstChoiceId,
      secondChoiceId: PENDING_SIGNUP.secondChoiceId,
      signedRulebook: true,
      signatureName: PENDING_SIGNUP.signatureName,
      signedAt: new Date(),
    },
    create: {
      id: PENDING_SIGNUP.id,
      englishName: PENDING_SIGNUP.englishName,
      gradeLevel: PENDING_SIGNUP.gradeLevel,
      email: PENDING_SIGNUP.email,
      status: PENDING_SIGNUP.status,
      firstChoiceId: PENDING_SIGNUP.firstChoiceId,
      secondChoiceId: PENDING_SIGNUP.secondChoiceId,
      signedRulebook: true,
      signatureName: PENDING_SIGNUP.signatureName,
      signedAt: new Date(),
    },
  });
  for (const slotId of PENDING_SIGNUP.slotIds) {
    await db.tuteeAvailability.upsert({
      where: { tuteeId_slotId: { tuteeId: PENDING_SIGNUP.id, slotId } },
      update: {},
      create: { tuteeId: PENDING_SIGNUP.id, slotId },
    });
  }

  // --- Tutor availability ----------------------------------------------------
  const tutorAvailability: { tutorId: string; slotId: string }[] = [
    { tutorId: "tutor-alice", slotId: "slot-mon-a" },
    { tutorId: "tutor-alice", slotId: "slot-wed-a" },
    { tutorId: "tutor-bob", slotId: "slot-wed-a" },
    { tutorId: "tutor-carol", slotId: "slot-fri-a" },
  ];
  for (const a of tutorAvailability) {
    await db.tutorAvailability.upsert({
      where: { tutorId_slotId: { tutorId: a.tutorId, slotId: a.slotId } },
      update: {},
      create: a,
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
      timeSlotId: "slot-mon-a",
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
      timeSlotId: "slot-wed-a",
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
      timeSlotId: "slot-fri-a",
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
        timeSlotId: p.timeSlotId,
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
        timeSlotId: p.timeSlotId,
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
    `Seeded: 1 term, ${ROOMS.length} rooms, ${COURSES.length} courses, ` +
      `${TIME_SLOTS.length} time slots, ${TUTORS.length} tutors, ` +
      `${TUTEES.length} active tutees + 1 pending signup, ${pairings.length} pairings, ` +
      `${users.length} login users (password "${DEV_PASSWORD}").`,
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
