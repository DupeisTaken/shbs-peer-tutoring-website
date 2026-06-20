/**
 * Seed script for local/dev databases.
 *
 * Idempotent: uses fixed ids + upserts so it can be run repeatedly.
 * Run with `npm run db:seed` (after the database is up and migrated).
 */
import { PrismaClient } from "../generated/prisma";
import { hashPassword } from "../src/server/auth/password";
import { TUTEE_POLICY, TUTOR_POLICY } from "./policies";

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
  { id: "tutor-alice", firstName: "Alice", lastName: "Chen", altNames: "陈爱丽", username: "achen", email: "alice@example.edu", active: true },
  { id: "tutor-bob", firstName: "Bob", lastName: "Liu", altNames: "刘波", username: "bliu", email: "bob@example.edu", active: true },
  { id: "tutor-carol", firstName: "Carol", lastName: "Wang", altNames: null, username: "cwang", email: "carol@example.edu", active: true },
  { id: "tutor-david", firstName: "David", lastName: "Zhao", altNames: "赵大卫", username: "dzhao", email: null, active: false },
  // Example of a self-signed-up tutor awaiting admin activation.
  { id: "tutor-evan", firstName: "Evan", lastName: "Tutor", altNames: null, username: "etutor", email: "evan@example.edu", active: false },
].map((t) => ({ ...t, englishName: `${t.firstName} ${t.lastName}` }));

// Recurring room blackout periods (fixed ids so the seed stays idempotent).
const ROOM_BLOCKS = [
  { id: "block-library-mon", roomId: "room-library", dayOfWeek: 1, start: "15:30", end: "16:30", reason: "Book club" },
  { id: "block-a101-wed", roomId: "room-a101", dayOfWeek: 3, start: "16:00", end: "17:00", reason: "Faculty meeting" },
];

const COURSES = [
  { id: "course-math", name: "Mathematics", tag: "STANDARD" as const },
  { id: "course-physics", name: "Physics", tag: "AP" as const },
  { id: "course-english", name: "English", tag: "HONORS" as const },
  { id: "course-chemistry", name: "Chemistry", tag: "AP" as const },
  { id: "course-biology", name: "Biology", tag: "STANDARD" as const },
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
  preferredContact: "Text me at 555-0100 after 4pm",
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
      update: {
        firstName: tutor.firstName,
        lastName: tutor.lastName,
        englishName: tutor.englishName,
        alternativeNames: tutor.altNames,
        username: tutor.username,
        email: tutor.email,
        active: tutor.active,
      },
      create: {
        id: tutor.id,
        firstName: tutor.firstName,
        lastName: tutor.lastName,
        englishName: tutor.englishName,
        alternativeNames: tutor.altNames,
        username: tutor.username,
        email: tutor.email,
        active: tutor.active,
      },
    });
  }

  // --- Courses ---------------------------------------------------------------
  for (const course of COURSES) {
    await db.course.upsert({
      where: { id: course.id },
      update: { name: course.name, tag: course.tag },
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
      preferredContact: PENDING_SIGNUP.preferredContact,
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
      preferredContact: PENDING_SIGNUP.preferredContact,
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

  // --- Room blackout periods -------------------------------------------------
  for (const b of ROOM_BLOCKS) {
    await db.roomUnavailability.upsert({
      where: { id: b.id },
      update: {
        roomId: b.roomId,
        dayOfWeek: b.dayOfWeek,
        startMin: hm(b.start),
        endMin: hm(b.end),
        reason: b.reason,
      },
      create: {
        id: b.id,
        roomId: b.roomId,
        dayOfWeek: b.dayOfWeek,
        startMin: hm(b.start),
        endMin: hm(b.end),
        reason: b.reason,
      },
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
    { id: "user-bob", name: "Bob Liu", email: "bob@example.edu", role: "TUTOR" as const, tutorId: "tutor-bob" },
    // Evan's tutor record is inactive — signing in shows the pending-approval gate.
    { id: "user-evan", name: "Evan Tutor", email: "evan@example.edu", role: "TUTOR" as const, tutorId: "tutor-evan" },
  ];
  // Seeded users are pre-onboarded (emailVerifiedAt set) so local sign-in goes straight
  // to the dashboard; the first-login email gate only triggers for genuinely new accounts.
  for (const u of users) {
    await db.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        tutorId: u.tutorId,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
      create: {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        tutorId: u.tutorId,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
  }

  // --- Tutor application (in INTERVIEW, Alice is head) -----------------------
  await db.tutorApplication.upsert({
    where: { id: "app-fiona" },
    update: {
      name: "Fiona Applicant",
      email: "fiona@example.edu",
      preferredContact: "Email me, or call 555-0142 on weekends",
      status: "INTERVIEW",
    },
    create: {
      id: "app-fiona",
      name: "Fiona Applicant",
      email: "fiona@example.edu",
      preferredContact: "Email me, or call 555-0142 on weekends",
      status: "INTERVIEW",
      courseIntents: {
        create: [
          { courseId: "course-math", taken: true, grade: "A" },
          // Physics is AP-tagged: demonstrate an AP score.
          { courseId: "course-physics", taken: true, grade: "A", hasApScore: true, apScore: "5" },
          // Self-studied path with a qualification note.
          {
            courseId: "course-biology",
            selfStudied: true,
            selfStudyNote: "Completed an online MIT OCW course; regional science-fair finalist.",
          },
        ],
      },
    },
  });
  for (const a of [
    { tutorId: "tutor-alice", isHead: true },
    { tutorId: "tutor-bob", isHead: false },
  ]) {
    await db.interviewAssignment.upsert({
      where: { applicationId_tutorId: { applicationId: "app-fiona", tutorId: a.tutorId } },
      update: { isHead: a.isHead },
      create: { applicationId: "app-fiona", tutorId: a.tutorId, isHead: a.isHead },
    });
  }

  // --- Interview votes (panelists' accept/reject + comment) -------------------
  for (const v of [
    { tutorId: "tutor-alice", accept: true, comment: "Strong, well-structured demo." },
    { tutorId: "tutor-bob", accept: true, comment: "Clear explanations; good rapport." },
  ]) {
    await db.interviewVote.upsert({
      where: { applicationId_tutorId: { applicationId: "app-fiona", tutorId: v.tutorId } },
      update: { accept: v.accept, comment: v.comment },
      create: { applicationId: "app-fiona", tutorId: v.tutorId, accept: v.accept, comment: v.comment },
    });
  }

  // --- Announcements (shown to tutors on every login until acknowledged) ------
  await db.announcement.upsert({
    where: { id: "ann-welcome" },
    update: {
      title: "Welcome back — Q3 pairings are live",
      body: "Please confirm your session times with your tutees this week and submit attendance within 24h of each session.",
      pinned: true,
      active: true,
      createdById: "user-admin",
    },
    create: {
      id: "ann-welcome",
      title: "Welcome back — Q3 pairings are live",
      body: "Please confirm your session times with your tutees this week and submit attendance within 24h of each session.",
      pinned: true,
      active: true,
      createdById: "user-admin",
    },
  });

  // --- Disciplinary cards (yellow/red; see src/lib/discipline.ts) -------------
  const cards = [
    {
      id: "card-frank-y1",
      tuteeId: "tutee-frank",
      color: "YELLOW" as const,
      source: "TUTOR" as const,
      reason: "Did not complete assigned practice set.",
      reviewStatus: "VALID" as const,
      issuedByTutorId: "tutor-alice",
      reviewedById: "user-admin",
      reviewedAt: new Date(),
    },
    {
      id: "card-frank-y2",
      tuteeId: "tutee-frank",
      color: "YELLOW" as const,
      source: "TUTOR" as const,
      reason: "No response to messages for 24h+.",
      reviewStatus: "PENDING" as const,
      issuedByTutorId: "tutor-alice",
    },
    {
      id: "card-grace-r1",
      tuteeId: "tutee-grace",
      color: "RED" as const,
      source: "AUTO" as const,
      reason: "Unexcused absence (auto-issued).",
      reviewStatus: "VALID" as const,
    },
  ];
  for (const c of cards) {
    await db.disciplinaryCard.upsert({ where: { id: c.id }, update: c, create: c });
  }

  // --- Policy documents (editable in /admin/policies) ------------------------
  const policies = [
    { slug: "tutor-policy", title: "Peer Tutoring Tutor Policy", version: "v.2025.10.13M", body: TUTOR_POLICY },
    { slug: "tutee-policy", title: "Peer Tutoring Tutee Policy", version: "v.2025.04.25M", body: TUTEE_POLICY },
  ];
  for (const p of policies) {
    await db.policyDocument.upsert({
      where: { slug: p.slug },
      // Don't clobber admin edits on re-seed: only set the body when first created.
      update: { title: p.title, version: p.version },
      create: p,
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
