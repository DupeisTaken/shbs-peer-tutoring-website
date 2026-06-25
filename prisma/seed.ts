/**
 * Seed script for local/dev databases — a rich, idempotent dataset that demonstrates the
 * full system (courses/levels, tutors, tutee + tutor requests, pairings, attendance with
 * computed service hours, discipline cards, adjustments, interview workflow, announcements,
 * meetings, notifications).
 *
 * Idempotent: fixed ids + upserts, so it can be run repeatedly. Run with `npm run db:seed`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "../generated/prisma";
import { hashPassword } from "../src/server/auth/password";
import { generateRegistrationCode } from "../src/server/auth/code";
import {
  computeSessionHours,
  monthKey,
  type SessionTutorStatus,
  type TuteeAttendanceStatus,
} from "../src/lib/service-hours";
import { graduationYear } from "../src/lib/period";
import { LOCALES, LOCALE_LABELS } from "../src/i18n/config";
import { TUTEE_POLICY, TUTOR_POLICY } from "./policies";

/** School year the seed's active term belongs to (used to derive class-of years). */
const SEED_SCHOOL_YEAR = "26-27";

/** First initial + last name + 2-digit class-of year, e.g. "achen29" — mirrors defaultUsername. */
function seedUsername(firstName: string, lastName: string, gradeLevel: number): string {
  const first = firstName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const last = lastName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const yy = String(graduationYear(gradeLevel, SEED_SCHOOL_YEAR) % 100).padStart(2, "0");
  return `${first.slice(0, 1)}${last}${yy}`;
}

const db = new PrismaClient();

/** Dev-only login password shared by every seeded user. CHANGE before any real use. */
const DEV_PASSWORD = "Password123!";

/** Convert "HH:MM" to minutes from midnight. */
function hm(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** A Date `n` days before now (for spreading attendance/requests across time). */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

type Role = "HEAD" | "ADMIN" | "COORDINATOR" | "TUTOR";
type TutorStatus = "ACTIVE" | "PENDING" | "GRADUATED" | "OPTED_OUT" | "ARCHIVED";

// ---------------------------------------------------------------------------
// Reference catalogues
// ---------------------------------------------------------------------------

const ROOMS = [
  { id: "room-a101", name: "A101" },
  { id: "room-a102", name: "A102" },
  { id: "room-a103", name: "A103" },
  { id: "room-b201", name: "B201" },
  { id: "room-b202", name: "B202" },
  { id: "room-library", name: "Library" },
  { id: "room-lab1", name: "Science Lab" },
];

const ROOM_BLOCKS = [
  { id: "block-library-mon", roomId: "room-library", dayOfWeek: 1, start: "15:30", end: "16:30", reason: "Book club" },
  { id: "block-a101-wed", roomId: "room-a101", dayOfWeek: 3, start: "16:00", end: "17:00", reason: "Faculty meeting" },
  { id: "block-lab1-thu", roomId: "room-lab1", dayOfWeek: 4, start: "15:30", end: "16:30", reason: "Robotics club" },
];

const LEVELS = [
  { id: "level-ap", name: "AP", rank: 0, apScored: true },
  { id: "level-honors", name: "Honors", rank: 1, apScored: false },
  { id: "level-standard", name: "Standard", rank: 2, apScored: false },
];

const COURSES = [
  { id: "course-math", name: "Mathematics", levelId: "level-standard" },
  { id: "course-algebra2", name: "Algebra II", levelId: "level-standard" },
  { id: "course-precalc", name: "Precalculus", levelId: "level-honors" },
  { id: "course-apcalc", name: "AP Calculus BC", levelId: "level-ap" },
  { id: "course-apstats", name: "AP Statistics", levelId: "level-ap" },
  { id: "course-physics", name: "Physics", levelId: "level-ap" },
  { id: "course-apphysics", name: "AP Physics C", levelId: "level-ap" },
  { id: "course-chemistry", name: "Chemistry", levelId: "level-ap" },
  { id: "course-biology", name: "Biology", levelId: "level-standard" },
  { id: "course-apbio", name: "AP Biology", levelId: "level-ap" },
  { id: "course-english", name: "English", levelId: "level-honors" },
  { id: "course-apenglit", name: "AP English Literature", levelId: "level-ap" },
  { id: "course-worldhistory", name: "World History", levelId: "level-standard" },
  { id: "course-apush", name: "AP US History", levelId: "level-ap" },
  { id: "course-spanish", name: "Spanish", levelId: "level-standard" },
  { id: "course-compsci", name: "Computer Science", levelId: "level-honors" },
  { id: "course-apcs", name: "AP Computer Science A", levelId: "level-ap" },
  { id: "course-economics", name: "Economics", levelId: "level-honors" },
];

const TIME_SLOTS = [
  { id: "slot-mon-a", label: "Mon block A", dayOfWeek: 1, start: "15:30", end: "16:30" },
  { id: "slot-mon-b", label: "Mon block B", dayOfWeek: 1, start: "16:45", end: "17:45" },
  { id: "slot-tue-a", label: "Tue block A", dayOfWeek: 2, start: "15:30", end: "16:30" },
  { id: "slot-tue-b", label: "Tue block B", dayOfWeek: 2, start: "16:45", end: "17:45" },
  { id: "slot-wed-a", label: "Wed block A", dayOfWeek: 3, start: "16:00", end: "17:00" },
  { id: "slot-wed-b", label: "Wed block B", dayOfWeek: 3, start: "17:15", end: "18:15" },
  { id: "slot-thu-a", label: "Thu block A", dayOfWeek: 4, start: "15:30", end: "16:30" },
  { id: "slot-thu-b", label: "Thu block B", dayOfWeek: 4, start: "16:45", end: "17:45" },
  { id: "slot-fri-a", label: "Fri block A", dayOfWeek: 5, start: "15:00", end: "16:15" },
  { id: "slot-fri-b", label: "Fri block B", dayOfWeek: 5, start: "16:30", end: "17:30" },
];

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const TUTORS = [
  { id: "tutor-alice", firstName: "Alice", lastName: "Chen", altNames: "陈爱丽", email: "alice@example.edu", status: "ACTIVE" as TutorStatus, role: "TUTOR" as Role },
  { id: "tutor-bob", firstName: "Bob", lastName: "Liu", altNames: "刘波", email: "bob@example.edu", status: "ACTIVE" as TutorStatus, role: "TUTOR" as Role },
  { id: "tutor-carol", firstName: "Carol", lastName: "Wang", altNames: null, email: "carol@example.edu", status: "ACTIVE" as TutorStatus, role: "COORDINATOR" as Role },
  { id: "tutor-david", firstName: "David", lastName: "Zhao", altNames: "赵大卫", email: "david@example.edu", status: "ACTIVE" as TutorStatus, role: "TUTOR" as Role },
  { id: "tutor-gina", firstName: "Gina", lastName: "Hill", altNames: null, email: "gina@example.edu", status: "ACTIVE" as TutorStatus, role: "TUTOR" as Role },
  { id: "tutor-harold", firstName: "Harold", lastName: "Adams", altNames: null, email: "harold@example.edu", status: "ACTIVE" as TutorStatus, role: "TUTOR" as Role },
  { id: "tutor-iris", firstName: "Iris", lastName: "Patel", altNames: null, email: "iris@example.edu", status: "ACTIVE" as TutorStatus, role: "TUTOR" as Role },
  { id: "tutor-jason", firstName: "Jason", lastName: "Kim", altNames: "金在勋", email: "jason@example.edu", status: "ACTIVE" as TutorStatus, role: "TUTOR" as Role },
  { id: "tutor-karen", firstName: "Karen", lastName: "Diaz", altNames: null, email: "karen@example.edu", status: "ACTIVE" as TutorStatus, role: "TUTOR" as Role },
  { id: "tutor-leo", firstName: "Leo", lastName: "Murphy", altNames: null, email: "leo@example.edu", status: "ACTIVE" as TutorStatus, role: "TUTOR" as Role },
  { id: "tutor-mona", firstName: "Mona", lastName: "Rossi", altNames: null, email: "mona@example.edu", status: "ACTIVE" as TutorStatus, role: "TUTOR" as Role },
  { id: "tutor-nora", firstName: "Nora", lastName: "Park", altNames: "박노라", email: "nora@example.edu", status: "ACTIVE" as TutorStatus, role: "TUTOR" as Role },
  // Lifecycle showcase — each non-active status so the admin roster + tutor dashboards demo them:
  //  PENDING   → must self-activate on the dashboard (shows the availability prompt).
  //  OPTED_OUT → read-only; has a pending reentry request (see TUTOR_STATUS_REQUESTS).
  //  GRADUATED → aged out; read-only.
  //  ARCHIVED  → removed from rotation; read-only.
  { id: "tutor-evan", firstName: "Evan", lastName: "Tutor", altNames: null, email: "evan@example.edu", status: "PENDING" as TutorStatus, role: "TUTOR" as Role },
  { id: "tutor-oscar", firstName: "Oscar", lastName: "Brown", altNames: null, email: "oscar@example.edu", status: "OPTED_OUT" as TutorStatus, role: "TUTOR" as Role },
  { id: "tutor-pia", firstName: "Pia", lastName: "Novak", altNames: null, email: "pia@example.edu", status: "GRADUATED" as TutorStatus, role: "TUTOR" as Role },
  { id: "tutor-reese", firstName: "Reese", lastName: "Cole", altNames: null, email: "reese@example.edu", status: "ARCHIVED" as TutorStatus, role: "TUTOR" as Role },
].map((t, i) => {
  // Demo grades cycling 9–12 (some G12s so a year-refresh shows graduation/aging).
  const gradeLevel = 9 + (i % 4);
  return {
    ...t,
    englishName: `${t.firstName} ${t.lastName}`,
    gradeLevel,
    // Usernames are initialised with the class-of year (e.g. "achen29").
    username: seedUsername(t.firstName, t.lastName, gradeLevel),
  };
});

const TUTEES = [
  { id: "tutee-emma", englishName: "Emma Sun", gradeLevel: "9", firstChoiceId: "course-math" },
  { id: "tutee-frank", englishName: "Frank Wu", gradeLevel: "10", firstChoiceId: "course-math" },
  { id: "tutee-grace", englishName: "Grace Lin", gradeLevel: "9", firstChoiceId: "course-physics" },
  { id: "tutee-henry", englishName: "Henry Xu", gradeLevel: "11", firstChoiceId: "course-english" },
  { id: "tutee-ivy", englishName: "Ivy Yang", gradeLevel: "10", firstChoiceId: "course-english" },
  { id: "tutee-jack", englishName: "Jack Zhou", gradeLevel: "12", firstChoiceId: "course-english" },
  { id: "tutee-liam", englishName: "Liam Foster", gradeLevel: "9", firstChoiceId: "course-math" },
  { id: "tutee-mia", englishName: "Mia Reed", gradeLevel: "10", firstChoiceId: "course-chemistry" },
  { id: "tutee-noah", englishName: "Noah Bell", gradeLevel: "11", firstChoiceId: "course-apcalc" },
  { id: "tutee-olivia", englishName: "Olivia Ward", gradeLevel: "9", firstChoiceId: "course-chemistry" },
  { id: "tutee-peter", englishName: "Peter Gray", gradeLevel: "12", firstChoiceId: "course-physics" },
  { id: "tutee-quinn", englishName: "Quinn Lee", gradeLevel: "10", firstChoiceId: "course-spanish" },
  { id: "tutee-rachel", englishName: "Rachel Cole", gradeLevel: "11", firstChoiceId: "course-apenglit" },
  { id: "tutee-sam", englishName: "Sam Diaz", gradeLevel: "9", firstChoiceId: "course-apush" },
  { id: "tutee-tina", englishName: "Tina Hong", gradeLevel: "10", firstChoiceId: "course-apcalc" },
  { id: "tutee-umar", englishName: "Umar Khan", gradeLevel: "12", firstChoiceId: "course-economics" },
  { id: "tutee-vera", englishName: "Vera Ng", gradeLevel: "11", firstChoiceId: "course-apcs" },
  { id: "tutee-will", englishName: "Will Tan", gradeLevel: "9", firstChoiceId: "course-spanish" },
  { id: "tutee-xena", englishName: "Xena Ross", gradeLevel: "10", firstChoiceId: "course-apush" },
  { id: "tutee-yuki", englishName: "Yuki Sato", gradeLevel: "11", firstChoiceId: "course-apcs" },
  { id: "tutee-aaron", englishName: "Aaron Webb", gradeLevel: "9", firstChoiceId: "course-algebra2" },
  { id: "tutee-bella", englishName: "Bella Cruz", gradeLevel: "10", firstChoiceId: "course-apbio" },
  { id: "tutee-cory", englishName: "Cory Flynn", gradeLevel: "11", firstChoiceId: "course-precalc" },
  { id: "tutee-dana", englishName: "Dana Iverson", gradeLevel: "12", firstChoiceId: "course-economics" },
  { id: "tutee-eli", englishName: "Eli Mercer", gradeLevel: "9", firstChoiceId: "course-apbio" },
  { id: "tutee-faye", englishName: "Faye Okafor", gradeLevel: "10", firstChoiceId: "course-precalc" },
  { id: "tutee-gabe", englishName: "Gabe Solis", gradeLevel: "11", firstChoiceId: "course-apbio" },
  { id: "tutee-hana", englishName: "Hana Kato", gradeLevel: "9", firstChoiceId: "course-precalc" },
  { id: "tutee-ian", englishName: "Ian Boyd", gradeLevel: "10", firstChoiceId: "course-worldhistory" },
  { id: "tutee-jana", englishName: "Jana Petrov", gradeLevel: "12", firstChoiceId: "course-apenglit" },
  { id: "tutee-kyle", englishName: "Kyle Ahmed", gradeLevel: "11", firstChoiceId: "course-apcalc" },
  { id: "tutee-lena", englishName: "Lena Brooks", gradeLevel: "10", firstChoiceId: "course-spanish" },
];

// Public self-signups awaiting review — ordered earliest-first (priority) by `daysAgo`.
const PENDING_SIGNUPS = [
  { id: "tutee-pending-kate", englishName: "Kate Park", gradeLevel: "9", email: "kate@example.edu", preferredContact: "Text me at 555-0100 after 4pm", firstChoiceId: "course-chemistry", secondChoiceId: "course-biology", slotIds: ["slot-tue-a", "slot-thu-a"], daysAgo: 6 },
  { id: "tutee-pending-omar", englishName: "Omar Said", gradeLevel: "10", email: "omar@example.edu", preferredContact: "Email me; I reply within a day", firstChoiceId: "course-apcalc", secondChoiceId: "course-precalc", slotIds: ["slot-mon-a", "slot-wed-a"], daysAgo: 5 },
  { id: "tutee-pending-lily", englishName: "Lily Tran", gradeLevel: "11", email: "lily@example.edu", preferredContact: "Call after 5pm", firstChoiceId: "course-apenglit", secondChoiceId: "course-english", slotIds: ["slot-fri-a"], daysAgo: 3 },
  { id: "tutee-pending-raj", englishName: "Raj Mehta", gradeLevel: "12", email: "raj@example.edu", preferredContact: "WeChat / text 555-0188", firstChoiceId: "course-apcs", secondChoiceId: "course-compsci", slotIds: ["slot-wed-b", "slot-thu-b"], daysAgo: 2 },
  { id: "tutee-pending-sara", englishName: "Sara Cohen", gradeLevel: "9", email: "sara@example.edu", preferredContact: "Email preferred", firstChoiceId: "course-spanish", slotIds: ["slot-tue-b"], daysAgo: 1 },
  { id: "tutee-pending-tom", englishName: "Tom Becker", gradeLevel: "10", email: "tom@example.edu", preferredContact: "Text 555-0177", firstChoiceId: "course-apush", secondChoiceId: "course-worldhistory", slotIds: ["slot-fri-b"], daysAgo: 0 },
  { id: "tutee-pending-uma", englishName: "Uma Devi", gradeLevel: "10", email: "uma@example.edu", preferredContact: "Email; replies same day", firstChoiceId: "course-apbio", secondChoiceId: "course-biology", slotIds: ["slot-thu-a"], daysAgo: 4 },
  { id: "tutee-pending-victor", englishName: "Victor Lim", gradeLevel: "11", email: "victor@example.edu", preferredContact: "Text 555-0199 evenings", firstChoiceId: "course-apphysics", secondChoiceId: "course-physics", slotIds: ["slot-mon-b"], daysAgo: 2 },
  { id: "tutee-pending-wendy", englishName: "Wendy Cho", gradeLevel: "9", email: "wendy@example.edu", preferredContact: "Email preferred", firstChoiceId: "course-algebra2", slotIds: ["slot-tue-a"], daysAgo: 0 },
  // Same name + email as the discipline-removed tutee below → the signup queue flags it as a
  // possible re-signup this quarter (see admin `tutees` bannedMatch). Demonstrates the ban label.
  { id: "tutee-pending-zoe", englishName: "Zoe Banner", gradeLevel: "11", email: "zoe@example.edu", preferredContact: "Text 555-0220", firstChoiceId: "course-apbio", secondChoiceId: "course-biology", slotIds: ["slot-thu-a"], daysAgo: 0 },
];

// Tutees no longer in the program — INACTIVE and detached (no pairings). They populate the
// "removed & opted-out" list and the discipline standing meter; see TUTEE_REMOVALS for the
// matching request rows.
const REMOVED_TUTEES = [
  { id: "tutee-yara", englishName: "Yara Voss", gradeLevel: "10", email: "yara@example.edu", phone: "555-0210" },
  { id: "tutee-zoe", englishName: "Zoe Banner", gradeLevel: "11", email: "zoe@example.edu", phone: "555-0220" },
];

// ---------------------------------------------------------------------------
// Pairings + attendance
// ---------------------------------------------------------------------------

const PAIRINGS = [
  { id: "pairing-alice-math", tutorId: "tutor-alice", subjectId: "course-math", subject: "Mathematics", day: 1, start: "15:30", end: "16:30", roomId: "room-a101", slotId: "slot-mon-a", tuteeIds: ["tutee-emma", "tutee-frank", "tutee-liam"] },
  { id: "pairing-bob-physics", tutorId: "tutor-bob", subjectId: "course-physics", subject: "Physics", day: 3, start: "16:00", end: "17:00", roomId: "room-b201", slotId: "slot-wed-a", tuteeIds: ["tutee-grace", "tutee-peter"] },
  { id: "pairing-carol-english", tutorId: "tutor-carol", subjectId: "course-english", subject: "English", day: 5, start: "15:00", end: "16:15", roomId: "room-library", slotId: "slot-fri-a", tuteeIds: ["tutee-henry", "tutee-ivy", "tutee-jack"] },
  { id: "pairing-david-chem", tutorId: "tutor-david", subjectId: "course-chemistry", subject: "Chemistry", day: 2, start: "15:30", end: "16:30", roomId: "room-lab1", slotId: "slot-tue-a", tuteeIds: ["tutee-mia", "tutee-olivia"] },
  { id: "pairing-gina-apcalc", tutorId: "tutor-gina", subjectId: "course-apcalc", subject: "AP Calculus BC", day: 4, start: "16:45", end: "17:45", roomId: "room-a102", slotId: "slot-thu-b", tuteeIds: ["tutee-noah", "tutee-tina"] },
  { id: "pairing-harold-apenglit", tutorId: "tutor-harold", subjectId: "course-apenglit", subject: "AP English Literature", day: 1, start: "16:45", end: "17:45", roomId: "room-a103", slotId: "slot-mon-b", tuteeIds: ["tutee-rachel"] },
  { id: "pairing-iris-spanish", tutorId: "tutor-iris", subjectId: "course-spanish", subject: "Spanish", day: 2, start: "16:45", end: "17:45", roomId: "room-b202", slotId: "slot-tue-b", tuteeIds: ["tutee-quinn", "tutee-will"] },
  { id: "pairing-jason-apcs", tutorId: "tutor-jason", subjectId: "course-apcs", subject: "AP Computer Science A", day: 3, start: "17:15", end: "18:15", roomId: "room-a101", slotId: "slot-wed-b", tuteeIds: ["tutee-vera", "tutee-yuki"] },
  { id: "pairing-karen-econ", tutorId: "tutor-karen", subjectId: "course-economics", subject: "Economics", day: 4, start: "16:45", end: "17:45", roomId: "room-a103", slotId: "slot-thu-b", tuteeIds: ["tutee-umar"] },
  { id: "pairing-leo-apush", tutorId: "tutor-leo", subjectId: "course-apush", subject: "AP US History", day: 5, start: "16:30", end: "17:30", roomId: "room-b201", slotId: "slot-fri-b", tuteeIds: ["tutee-xena", "tutee-sam"] },
  { id: "pairing-mona-precalc", tutorId: "tutor-mona", subjectId: "course-precalc", subject: "Precalculus", day: 2, start: "15:30", end: "16:30", roomId: "room-a102", slotId: "slot-tue-a", tuteeIds: ["tutee-faye", "tutee-cory", "tutee-hana"] },
  { id: "pairing-nora-apbio", tutorId: "tutor-nora", subjectId: "course-apbio", subject: "AP Biology", day: 4, start: "16:45", end: "17:45", roomId: "room-lab1", slotId: "slot-thu-b", tuteeIds: ["tutee-bella", "tutee-eli", "tutee-gabe"] },
];

type SessionSpec = {
  id: string;
  pairingId: string;
  tutorId: string;
  daysAgo: number;
  tutorStatus: SessionTutorStatus;
  start: string;
  end: string;
  ratings?: number;
  comments?: string;
  tutorAbsentReason?: string;
  tutees: { tuteeId: string; status: TuteeAttendanceStatus; reason?: string }[];
};

const SESSIONS: SessionSpec[] = [
  // Alice / Math — a full group, then a session with an unexcused absence.
  { id: "sess-alice-1", pairingId: "pairing-alice-math", tutorId: "tutor-alice", daysAgo: 12, tutorStatus: "PRESENT", start: "15:30", end: "16:30", ratings: 5, comments: "Great progress on quadratics.", tutees: [{ tuteeId: "tutee-emma", status: "PRESENT" }, { tuteeId: "tutee-frank", status: "PRESENT" }, { tuteeId: "tutee-liam", status: "PRESENT" }] },
  { id: "sess-alice-2", pairingId: "pairing-alice-math", tutorId: "tutor-alice", daysAgo: 5, tutorStatus: "PRESENT", start: "15:30", end: "16:30", ratings: 4, comments: "Frank no-showed without notice.", tutees: [{ tuteeId: "tutee-emma", status: "PRESENT" }, { tuteeId: "tutee-liam", status: "PRESENT" }, { tuteeId: "tutee-frank", status: "UNEXCUSED_ABSENT" }] },
  // Bob / Physics — one with an excused absence.
  { id: "sess-bob-1", pairingId: "pairing-bob-physics", tutorId: "tutor-bob", daysAgo: 9, tutorStatus: "PRESENT", start: "16:00", end: "17:00", ratings: 4, comments: "Kinematics review.", tutees: [{ tuteeId: "tutee-grace", status: "PRESENT" }, { tuteeId: "tutee-peter", status: "EXCUSED_ABSENT", reason: "Family appointment (notified in advance)." }] },
  { id: "sess-bob-2", pairingId: "pairing-bob-physics", tutorId: "tutor-bob", daysAgo: 35, tutorStatus: "PRESENT", start: "16:00", end: "17:00", ratings: 5, comments: "Last month — strong session.", tutees: [{ tuteeId: "tutee-grace", status: "PRESENT" }, { tuteeId: "tutee-peter", status: "PRESENT" }] },
  // Carol / English — present, plus a rescheduled (held later, still credited).
  { id: "sess-carol-1", pairingId: "pairing-carol-english", tutorId: "tutor-carol", daysAgo: 8, tutorStatus: "PRESENT", start: "15:00", end: "16:15", ratings: 5, comments: "Essay structure workshop.", tutees: [{ tuteeId: "tutee-henry", status: "PRESENT" }, { tuteeId: "tutee-ivy", status: "PRESENT" }, { tuteeId: "tutee-jack", status: "PRESENT" }] },
  { id: "sess-carol-2", pairingId: "pairing-carol-english", tutorId: "tutor-carol", daysAgo: 1, tutorStatus: "RESCHEDULED", start: "16:30", end: "17:30", ratings: 4, comments: "Moved to a later block this week.", tutees: [{ tuteeId: "tutee-henry", status: "PRESENT" }, { tuteeId: "tutee-ivy", status: "PRESENT" }, { tuteeId: "tutee-jack", status: "EXCUSED_ABSENT", reason: "Sports meet." }] },
  // David / Chemistry.
  { id: "sess-david-1", pairingId: "pairing-david-chem", tutorId: "tutor-david", daysAgo: 6, tutorStatus: "PRESENT", start: "15:30", end: "16:30", ratings: 4, comments: "Stoichiometry.", tutees: [{ tuteeId: "tutee-mia", status: "PRESENT" }, { tuteeId: "tutee-olivia", status: "PRESENT" }] },
  // Gina / AP Calc — one regular + one EXTRA session.
  { id: "sess-gina-1", pairingId: "pairing-gina-apcalc", tutorId: "tutor-gina", daysAgo: 7, tutorStatus: "PRESENT", start: "16:45", end: "17:45", ratings: 5, comments: "Series convergence.", tutees: [{ tuteeId: "tutee-noah", status: "PRESENT" }, { tuteeId: "tutee-tina", status: "PRESENT" }] },
  { id: "sess-gina-2", pairingId: "pairing-gina-apcalc", tutorId: "tutor-gina", daysAgo: 2, tutorStatus: "EXTRA", start: "16:45", end: "17:45", ratings: 5, comments: "Extra exam-prep session.", tutees: [{ tuteeId: "tutee-noah", status: "PRESENT" }, { tuteeId: "tutee-tina", status: "PRESENT" }] },
  // Iris / Spanish.
  { id: "sess-iris-1", pairingId: "pairing-iris-spanish", tutorId: "tutor-iris", daysAgo: 9, tutorStatus: "PRESENT", start: "16:45", end: "17:45", ratings: 4, comments: "Subjunctive practice.", tutees: [{ tuteeId: "tutee-quinn", status: "PRESENT" }, { tuteeId: "tutee-will", status: "PRESENT" }] },
  // Jason / AP CS.
  { id: "sess-jason-1", pairingId: "pairing-jason-apcs", tutorId: "tutor-jason", daysAgo: 4, tutorStatus: "PRESENT", start: "17:15", end: "18:15", ratings: 5, comments: "Recursion + arrays.", tutees: [{ tuteeId: "tutee-vera", status: "PRESENT" }, { tuteeId: "tutee-yuki", status: "PRESENT" }] },
  // Karen / Economics — tutor was absent (no credit, reason recorded).
  { id: "sess-karen-1", pairingId: "pairing-karen-econ", tutorId: "tutor-karen", daysAgo: 3, tutorStatus: "TUTOR_ABSENT", start: "16:45", end: "17:45", tutorAbsentReason: "Was sick; will reschedule.", tutees: [{ tuteeId: "tutee-umar", status: "PRESENT" }] },
  // Leo / APUSH.
  { id: "sess-leo-1", pairingId: "pairing-leo-apush", tutorId: "tutor-leo", daysAgo: 10, tutorStatus: "PRESENT", start: "16:30", end: "17:30", ratings: 4, comments: "DBQ practice.", tutees: [{ tuteeId: "tutee-xena", status: "PRESENT" }, { tuteeId: "tutee-sam", status: "PRESENT" }] },
  { id: "sess-leo-2", pairingId: "pairing-leo-apush", tutorId: "tutor-leo", daysAgo: 3, tutorStatus: "PRESENT", start: "16:30", end: "17:30", ratings: 4, comments: "Cold War review.", tutees: [{ tuteeId: "tutee-xena", status: "PRESENT" }, { tuteeId: "tutee-sam", status: "PRESENT" }] },
  // A few more recent sessions across tutors (this semester).
  { id: "sess-alice-3", pairingId: "pairing-alice-math", tutorId: "tutor-alice", daysAgo: 1, tutorStatus: "PRESENT", start: "15:30", end: "16:30", ratings: 5, comments: "Systems of equations.", tutees: [{ tuteeId: "tutee-emma", status: "PRESENT" }, { tuteeId: "tutee-frank", status: "PRESENT" }, { tuteeId: "tutee-liam", status: "PRESENT" }] },
  { id: "sess-jason-2", pairingId: "pairing-jason-apcs", tutorId: "tutor-jason", daysAgo: 1, tutorStatus: "PRESENT", start: "17:15", end: "18:15", ratings: 5, comments: "Sorting algorithms.", tutees: [{ tuteeId: "tutee-vera", status: "PRESENT" }, { tuteeId: "tutee-yuki", status: "PRESENT" }] },
  { id: "sess-david-2", pairingId: "pairing-david-chem", tutorId: "tutor-david", daysAgo: 2, tutorStatus: "RESCHEDULED", start: "16:30", end: "17:30", ratings: 4, comments: "Make-up: acids & bases.", tutees: [{ tuteeId: "tutee-mia", status: "PRESENT" }, { tuteeId: "tutee-olivia", status: "PRESENT" }] },
  // Mona / Precalculus (new pairing).
  { id: "sess-mona-1", pairingId: "pairing-mona-precalc", tutorId: "tutor-mona", daysAgo: 4, tutorStatus: "PRESENT", start: "15:30", end: "16:30", ratings: 5, comments: "Limits & continuity.", tutees: [{ tuteeId: "tutee-faye", status: "PRESENT" }, { tuteeId: "tutee-cory", status: "PRESENT" }, { tuteeId: "tutee-hana", status: "PRESENT" }] },
  { id: "sess-mona-2", pairingId: "pairing-mona-precalc", tutorId: "tutor-mona", daysAgo: 1, tutorStatus: "PRESENT", start: "15:30", end: "16:30", ratings: 4, comments: "Trig identities.", tutees: [{ tuteeId: "tutee-faye", status: "PRESENT" }, { tuteeId: "tutee-cory", status: "EXCUSED_ABSENT", reason: "Clinic appointment (notified)." }, { tuteeId: "tutee-hana", status: "PRESENT" }] },
  // Nora / AP Biology (new pairing) — one with an unexcused absence (auto red card).
  { id: "sess-nora-1", pairingId: "pairing-nora-apbio", tutorId: "tutor-nora", daysAgo: 6, tutorStatus: "PRESENT", start: "16:45", end: "17:45", ratings: 5, comments: "Cellular respiration.", tutees: [{ tuteeId: "tutee-bella", status: "PRESENT" }, { tuteeId: "tutee-eli", status: "PRESENT" }, { tuteeId: "tutee-gabe", status: "PRESENT" }] },
  { id: "sess-nora-2", pairingId: "pairing-nora-apbio", tutorId: "tutor-nora", daysAgo: 2, tutorStatus: "PRESENT", start: "16:45", end: "17:45", ratings: 4, comments: "Genetics problem set.", tutees: [{ tuteeId: "tutee-bella", status: "PRESENT" }, { tuteeId: "tutee-eli", status: "UNEXCUSED_ABSENT" }, { tuteeId: "tutee-gabe", status: "PRESENT" }] },
];

// Disciplinary cards — varied colours / review states to show the 6-slot standing meter.
// (noah reaches 2 effective reds -> removal pending.)
type CardSpec = {
  id: string;
  tuteeId: string;
  color: "YELLOW" | "RED";
  source: "TUTOR" | "AUTO";
  reason: string;
  reviewStatus: "PENDING" | "VALID" | "INVALID";
  issuedByTutorId?: string;
  sessionId?: string;
  reviewedById?: string;
  reviewed: boolean;
};

const CARDS: CardSpec[] = [
  { id: "card-frank-y1", tuteeId: "tutee-frank", color: "YELLOW", source: "TUTOR", reason: "Did not complete assigned practice set.", reviewStatus: "VALID", issuedByTutorId: "tutor-alice", reviewedById: "user-admin", reviewed: true },
  { id: "card-frank-y2", tuteeId: "tutee-frank", color: "YELLOW", source: "TUTOR", reason: "No response to messages for 24h+.", reviewStatus: "PENDING", issuedByTutorId: "tutor-alice", reviewed: false },
  { id: "card-frank-auto", tuteeId: "tutee-frank", color: "RED", source: "AUTO", reason: "Unexcused absence (auto-issued).", reviewStatus: "VALID", sessionId: "sess-alice-2", reviewed: false },
  { id: "card-grace-r1", tuteeId: "tutee-grace", color: "RED", source: "AUTO", reason: "Unexcused absence (auto-issued).", reviewStatus: "VALID", reviewed: false },
  { id: "card-mia-y1", tuteeId: "tutee-mia", color: "YELLOW", source: "TUTOR", reason: "Late by 20 minutes, no notice.", reviewStatus: "VALID", issuedByTutorId: "tutor-david", reviewedById: "user-admin", reviewed: true },
  { id: "card-mia-y2", tuteeId: "tutee-mia", color: "YELLOW", source: "TUTOR", reason: "Incomplete homework.", reviewStatus: "VALID", issuedByTutorId: "tutor-david", reviewedById: "user-admin", reviewed: true },
  { id: "card-mia-y3", tuteeId: "tutee-mia", color: "YELLOW", source: "TUTOR", reason: "Unresponsive for two days.", reviewStatus: "VALID", issuedByTutorId: "tutor-david", reviewedById: "user-admin", reviewed: true },
  // Noah: 1 valid red (on warning) + a pending tutor card (not yet counted) — a live tutee at
  // threshold would be auto-removed, so the active roster never sits AT removal.
  { id: "card-noah-r1", tuteeId: "tutee-noah", color: "RED", source: "TUTOR", reason: "Disruptive behaviour during session.", reviewStatus: "VALID", issuedByTutorId: "tutor-gina", reviewedById: "user-admin", reviewed: true },
  { id: "card-noah-y1", tuteeId: "tutee-noah", color: "YELLOW", source: "TUTOR", reason: "Arrived without the assigned problem set.", reviewStatus: "PENDING", issuedByTutorId: "tutor-gina", reviewed: false },
  { id: "card-umar-inv", tuteeId: "tutee-umar", color: "YELLOW", source: "TUTOR", reason: "Late — but tutee had notified; flagged invalid.", reviewStatus: "INVALID", issuedByTutorId: "tutor-karen", reviewedById: "user-admin", reviewed: true },
  { id: "card-eli-auto", tuteeId: "tutee-eli", color: "RED", source: "AUTO", reason: "Unexcused absence (auto-issued).", reviewStatus: "VALID", sessionId: "sess-nora-2", reviewed: false },
  { id: "card-cory-y1", tuteeId: "tutee-cory", color: "YELLOW", source: "TUTOR", reason: "Forgot materials.", reviewStatus: "PENDING", issuedByTutorId: "tutor-mona", reviewed: false },
  { id: "card-bella-y1", tuteeId: "tutee-bella", color: "YELLOW", source: "TUTOR", reason: "Late submission of practice set.", reviewStatus: "VALID", issuedByTutorId: "tutor-nora", reviewedById: "user-admin", reviewed: true },
  { id: "card-gabe-y1", tuteeId: "tutee-gabe", color: "YELLOW", source: "TUTOR", reason: "Phone use during session.", reviewStatus: "VALID", issuedByTutorId: "tutor-nora", reviewedById: "user-admin", reviewed: true },
  // Zoe: 2 valid reds → at the removal threshold (full 6-slot meter). She was auto-removed
  // (INACTIVE) — see TUTEE_REMOVALS (PUNISHMENT). Shows the meter maxed + a discipline removal.
  { id: "card-zoe-r1", tuteeId: "tutee-zoe", color: "RED", source: "TUTOR", reason: "Repeated disruption despite warnings.", reviewStatus: "VALID", issuedByTutorId: "tutor-nora", reviewedById: "user-admin", reviewed: true },
  { id: "card-zoe-r2", tuteeId: "tutee-zoe", color: "RED", source: "AUTO", reason: "Unexcused absence (auto-issued).", reviewStatus: "VALID", reviewed: false },
];

// ---------------------------------------------------------------------------
// Lifecycle requests — tutor opt-out/reentry, tutee opt-out/removal, registration codes
// ---------------------------------------------------------------------------

// Tutor membership requests (TutorStatusRequest). leo: opt-out still in its cooldown (recallable;
// admin can approve once eligible). oscar: opted out, now requesting reentry (no cooldown).
const TUTOR_STATUS_REQUESTS = [
  { id: "tsr-leo-optout", tutorId: "tutor-leo", kind: "OPT_OUT" as const, reason: "Heavy course load next month — need a break.", cooldownDaysFromNow: 5 },
  { id: "tsr-oscar-reentry", tutorId: "tutor-oscar", kind: "REENTRY" as const, reason: "Ready to come back this quarter.", cooldownDaysFromNow: null },
];

// Tutee opt-outs & removals (TuteeRemovalRequest). will: opt-out relayed by Iris, still in its
// 7-day recall window. yara: opt-out already finalized (removed). zoe: auto-removed on discipline.
const TUTEE_REMOVALS: {
  id: string; tuteeId: string; kind: "VOLUNTARY" | "PUNISHMENT"; state: "PENDING" | "APPROVED";
  pairingId: string | null; tutorId: string | null; reason: string;
  eligibleInDays: number | null; resolvedDaysAgo: number | null;
}[] = [
  { id: "trr-will-pending", tuteeId: "tutee-will", kind: "VOLUNTARY", state: "PENDING", pairingId: "pairing-iris-spanish", tutorId: "tutor-iris", reason: "Family is moving; wants to stop after this week.", eligibleInDays: 5, resolvedDaysAgo: null },
  { id: "trr-yara-optout", tuteeId: "tutee-yara", kind: "VOLUNTARY", state: "APPROVED", pairingId: null, tutorId: "tutor-carol", reason: "Decided to focus on other commitments.", eligibleInDays: null, resolvedDaysAgo: 2 },
  { id: "trr-zoe-pun", tuteeId: "tutee-zoe", kind: "PUNISHMENT", state: "APPROVED", pairingId: null, tutorId: null, reason: "Reached the removal threshold (2 red cards).", eligibleInDays: null, resolvedDaysAgo: 1 },
];

// Registration codes (security keys for new tutors) in each status: active, used, expired.
// Codes are randomly generated (Steam-style 5-char) on each seed, matching production.
const REGISTRATION_CODES = [
  { id: "regcode-active", code: generateRegistrationCode(), email: "maya@example.edu", label: "Maya Lindqvist (recruit)", expiresInDays: 7, usedDaysAgo: null, applicationId: null },
  { id: "regcode-used", code: generateRegistrationCode(), email: "george@example.edu", label: "George Adler", expiresInDays: 6, usedDaysAgo: 1, applicationId: "app-george" },
  { id: "regcode-expired", code: generateRegistrationCode(), email: "old@example.edu", label: "Lapsed invite", expiresInDays: -1, usedDaysAgo: null, applicationId: null },
];

// ---------------------------------------------------------------------------
// Tutor applications (the recruitment workflow, at various stages)
// ---------------------------------------------------------------------------

type AppSpec = {
  id: string;
  name: string;
  email: string;
  preferredContact: string;
  status: "PENDING" | "INTERVIEW" | "ACCEPTED" | "REJECTED";
  daysAgo: number;
  intents: { subjectId: string; taken?: boolean; grade?: string; hasApScore?: boolean; apScore?: string; selfStudied?: boolean; selfStudyNote?: string }[];
  panel?: { tutorId: string; isHead: boolean; accept: boolean; comment: string }[];
  decisionComment?: string;
  decidedByTutorId?: string;
};

const APPLICATIONS: AppSpec[] = [
  {
    id: "app-fiona", name: "Fiona Applicant", email: "fiona@example.edu", preferredContact: "Email me, or call 555-0142 on weekends", status: "INTERVIEW", daysAgo: 7,
    intents: [
      { subjectId: "course-math", taken: true, grade: "A" },
      { subjectId: "course-physics", taken: true, grade: "A", hasApScore: true, apScore: "5" },
      { subjectId: "course-biology", selfStudied: true, selfStudyNote: "Completed an online MIT OCW course; regional science-fair finalist." },
    ],
    panel: [
      { tutorId: "tutor-alice", isHead: true, accept: true, comment: "Strong, well-structured demo." },
      { tutorId: "tutor-bob", isHead: false, accept: true, comment: "Clear explanations; good rapport." },
    ],
  },
  {
    id: "app-george", name: "George Adler", email: "george@example.edu", preferredContact: "Text 555-0150", status: "ACCEPTED", daysAgo: 20,
    intents: [{ subjectId: "course-apcs", taken: true, grade: "A", hasApScore: true, apScore: "5" }, { subjectId: "course-compsci", taken: true, grade: "A" }],
    panel: [
      { tutorId: "tutor-gina", isHead: true, accept: true, comment: "Excellent CS fundamentals." },
      { tutorId: "tutor-harold", isHead: false, accept: true, comment: "Patient and clear." },
    ],
    decisionComment: "Unanimous accept — great fit for the CS subjects.", decidedByTutorId: "tutor-gina",
  },
  {
    id: "app-hana", name: "Hana Suzuki", email: "hana@example.edu", preferredContact: "Email", status: "REJECTED", daysAgo: 18,
    intents: [{ subjectId: "course-english", taken: true, grade: "B" }],
    panel: [
      { tutorId: "tutor-iris", isHead: true, accept: false, comment: "Subject depth needs work; encouraged to reapply." },
      { tutorId: "tutor-jason", isHead: false, accept: true, comment: "Good communication, borderline." },
    ],
    decisionComment: "Tie broken by head — ask to reapply next cycle after more prep.", decidedByTutorId: "tutor-iris",
  },
  { id: "app-ian", name: "Ian Brooks", email: "ian@example.edu", preferredContact: "Call after 6pm", status: "PENDING", daysAgo: 3, intents: [{ subjectId: "course-apcalc", taken: true, grade: "A", hasApScore: true, apScore: "5" }, { subjectId: "course-precalc", taken: true, grade: "A" }] },
  { id: "app-julia", name: "Julia Mensah", email: "julia@example.edu", preferredContact: "Text 555-0161", status: "PENDING", daysAgo: 1, intents: [{ subjectId: "course-spanish", taken: true, grade: "A" }, { subjectId: "course-worldhistory", selfStudied: true, selfStudyNote: "Heritage speaker; led a history club." }] },
];

// Active term (26-27 Q1) start — fixed before all back-dated demo data so the Reports page's
// per-period calendar window includes this quarter's records.
const ACTIVE_TERM_CREATED_AT = new Date("2026-05-01T00:00:00Z");

// Historical terms (25-26 Q1–Q4) with realistic start dates + two session-dates each, so the
// Reports page has data for 25-26 S1 (Q1+Q2) and S2 (Q3+Q4). Dates stay before ACTIVE_TERM_CREATED_AT.
const HISTORY_SCHOOL_YEAR = "25-26";
const HISTORY_TERMS = [
  { id: "term-2025-q1", quarter: "Q1" as const, name: "25-26 Q1", createdAt: new Date("2025-08-20T00:00:00Z"), dates: ["2025-09-11", "2025-10-09"] },
  { id: "term-2025-q2", quarter: "Q2" as const, name: "25-26 Q2", createdAt: new Date("2025-11-03T00:00:00Z"), dates: ["2025-11-20", "2025-12-11"] },
  { id: "term-2025-q3", quarter: "Q3" as const, name: "25-26 Q3", createdAt: new Date("2026-01-12T00:00:00Z"), dates: ["2026-02-05", "2026-02-26"] },
  { id: "term-2025-q4", quarter: "Q4" as const, name: "25-26 Q4", createdAt: new Date("2026-03-16T00:00:00Z"), dates: ["2026-03-26", "2026-04-09"] },
];
// Last year's tutee cohort — now INACTIVE (cycled out at the year refresh). The past-year data
// (sessions, discipline, removals) hangs off these so it never distorts the current roster's
// standing. `createdAt` is spread across 25-26 Q1/Q2 so they also show as that period's signups.
const PAST_TUTEES = [
  { id: "ptutee-25-01", name: "Adam Frost", grade: "12", createdAt: "2025-09-02" },
  { id: "ptutee-25-02", name: "Bea Lowe", grade: "11", createdAt: "2025-09-03" },
  { id: "ptutee-25-03", name: "Cal Reyes", grade: "10", createdAt: "2025-09-05" },
  { id: "ptutee-25-04", name: "Devi Rao", grade: "12", createdAt: "2025-09-06" },
  { id: "ptutee-25-05", name: "Esme Walsh", grade: "9", createdAt: "2025-11-08" },
  { id: "ptutee-25-06", name: "Finn Doyle", grade: "11", createdAt: "2025-11-09" },
  { id: "ptutee-25-07", name: "Gwen Ito", grade: "10", createdAt: "2025-11-12" },
  { id: "ptutee-25-08", name: "Hugo Mraz", grade: "12", createdAt: "2025-11-14" },
];
// Current pairings replayed each historical quarter (for tutor + subject + time).
const HIST_PAIRING_IDS = [
  "pairing-alice-math", "pairing-bob-physics", "pairing-carol-english",
  "pairing-david-chem", "pairing-gina-apcalc", "pairing-jason-apcs",
];

/**
 * Seed a realistic past year (25-26 Q1–Q4) so the Reports page shows full history: attendance with
 * varied outcomes, discipline (auto + tutor cards, a punishment removal), hour adjustments (extra +
 * punishment), tutor meetings with absences, a voluntary tutee opt-out, a tutor opt-out→reentry
 * cycle, and recruitment. Hangs off a dedicated INACTIVE past-tutee cohort so it never touches the
 * current roster's standing. Idempotent (fixed ids). MUST run after tutors/pairings exist.
 */
async function seedHistory() {
  // Past-year tutees (now INACTIVE; createdAt makes them signups in their period too).
  for (const pt of PAST_TUTEES) {
    const data = {
      englishName: pt.name, gradeLevel: pt.grade, status: "INACTIVE" as const,
      email: `${pt.id}@example.edu`, createdAt: new Date(`${pt.createdAt}T09:00:00Z`),
    };
    await db.tutee.upsert({ where: { id: pt.id }, update: data, create: { id: pt.id, ...data } });
  }

  const slots = HIST_PAIRING_IDS.map((id) => PAIRINGS.find((p) => p.id === id)!);
  const rosterFor = (i: number) => [
    PAST_TUTEES[(2 * i) % PAST_TUTEES.length]!.id,
    PAST_TUTEES[(2 * i + 1) % PAST_TUTEES.length]!.id,
  ];

  for (let qi = 0; qi < HISTORY_TERMS.length; qi++) {
    const h = HISTORY_TERMS[qi]!;
    const pk = `${HISTORY_SCHOOL_YEAR} ${h.quarter}`;
    const adjMonth = monthKey(new Date(`${h.dates[0]!}T00:00:00Z`));

    // Sessions: each slot, each date. Mostly present, one excused + one tutor-absent per quarter.
    for (let si = 0; si < slots.length; si++) {
      const p = slots[si]!;
      const roster = rosterFor(si);
      for (let di = 0; di < h.dates.length; di++) {
        const date = new Date(`${h.dates[di]!}T${p.start}:00Z`);
        const tutorAbsent = si === (qi + 3) % slots.length && di === 1;
        const tutorStatus = tutorAbsent ? ("TUTOR_ABSENT" as const) : ("PRESENT" as const);
        const excuseFirst = si === qi % slots.length && di === 0;
        const tutees = roster.map((tid, ti) => ({
          tuteeId: tid,
          status: !tutorAbsent && excuseFirst && ti === 0
            ? ("EXCUSED_ABSENT" as const)
            : ("PRESENT" as const),
          reason: !tutorAbsent && excuseFirst && ti === 0 ? "Family event (notified)." : null,
        }));
        const computed = computeSessionHours({
          tutorStatus,
          tuteeStatuses: tutees.map((t) => t.status),
          startMin: hm(p.start),
          endMin: hm(p.end),
          date,
        });
        const sid = `hist-${h.quarter}-${di}-${p.id}`;
        const sdata = {
          date, tutorStatus, tutorAbsentReason: tutorAbsent ? "Was unwell; rescheduled." : null,
          startMin: hm(p.start), endMin: hm(p.end),
          ratingPreparedness: 5, ratingParticipation: 4, ratingUnderstanding: 4, ratingBehavior: 4, ratingProgress: 4,
          comments: `${h.name} — ${p.subject}.`,
          month: computed.month, schoolYear: HISTORY_SCHOOL_YEAR, quarter: h.quarter,
          durationMin: computed.durationMin, shFactor: computed.shFactor, shCount: computed.shCount,
          pairingId: p.id, tutorId: p.tutorId,
        };
        await db.session.upsert({ where: { id: sid }, update: sdata, create: { id: sid, ...sdata } });
        for (const ts of tutees) {
          await db.sessionTutee.upsert({
            where: { sessionId_tuteeId: { sessionId: sid, tuteeId: ts.tuteeId } },
            update: { status: ts.status, absenceReason: ts.reason },
            create: { sessionId: sid, tuteeId: ts.tuteeId, status: ts.status, absenceReason: ts.reason },
          });
        }
      }
    }

    // Hour adjustments: one EXTRA + one PUNISHMENT per quarter (stamped to the period).
    const adjs = [
      { id: `hist-adj-extra-${h.quarter}`, tutorId: slots[0]!.tutorId, type: "EXTRA" as const, amount: 0.5, reason: `${h.name} extra exam-prep workshop.` },
      { id: `hist-adj-pun-${h.quarter}`, tutorId: slots[qi % slots.length]!.tutorId, type: "PUNISHMENT" as const, amount: 0.125, reason: "Unexcused weekly-meeting absence." },
    ];
    for (const a of adjs) {
      const adata = { month: adjMonth, schoolYear: HISTORY_SCHOOL_YEAR, quarter: h.quarter, type: a.type, amount: a.amount, reason: a.reason, tutorId: a.tutorId };
      await db.serviceHourAdjustment.upsert({ where: { id: a.id }, update: adata, create: { id: a.id, ...adata } });
    }

    // Tutor meeting (linked by term) with one excused + one unexcused absence.
    const mId = `hist-meeting-${h.quarter}`;
    const mDate = new Date(`${h.dates[0]!}T12:00:00Z`);
    await db.tutorMeeting.upsert({ where: { id: mId }, update: { title: `${h.name} tutor meeting`, date: mDate, termId: h.id }, create: { id: mId, title: `${h.name} tutor meeting`, date: mDate, termId: h.id } });
    const mRows = [
      { tutorId: "tutor-alice", status: "PRESENT" as const, reason: null as string | null },
      { tutorId: "tutor-bob", status: "PRESENT" as const, reason: null as string | null },
      { tutorId: "tutor-carol", status: "EXCUSED_ABSENT" as const, reason: "Away for the meeting." as string | null },
      { tutorId: "tutor-gina", status: "UNEXCUSED_ABSENT" as const, reason: null as string | null },
    ];
    for (const mr of mRows) {
      const adata = { status: mr.status, reason: mr.reason, excusedAt: mr.status === "EXCUSED_ABSENT" ? mDate : null };
      await db.meetingAttendance.upsert({ where: { meetingId_tutorId: { meetingId: mId, tutorId: mr.tutorId } }, update: adata, create: { meetingId: mId, tutorId: mr.tutorId, ...adata } });
    }
  }

  // --- Discipline story: Devi Rao hits 2 red cards across Q1–Q2 → punishment removal (Q2) ------
  const devi = "ptutee-25-04";
  const reds = [
    { id: "hist-card-devi-r1", date: "2025-10-09" },
    { id: "hist-card-devi-r2", date: "2025-11-20" },
  ];
  for (const c of reds) {
    const at = new Date(`${c.date}T15:30:00Z`);
    const cdata = { tuteeId: devi, color: "RED" as const, source: "AUTO" as const, reason: "Unexcused absence (auto-issued).", reviewStatus: "VALID" as const, issuedByTutorId: "tutor-gina", reviewedById: null as string | null, reviewedAt: null as Date | null, createdAt: at };
    await db.disciplinaryCard.upsert({ where: { id: c.id }, update: cdata, create: { id: c.id, ...cdata } });
  }
  const deviRm = { tuteeId: devi, kind: "PUNISHMENT" as const, state: "APPROVED" as const, reason: "Reached the removal threshold (2 red cards).", removedPeriodKey: "25-26 Q2", createdAt: new Date("2025-11-20T15:35:00Z"), resolvedAt: new Date("2025-11-20T15:35:00Z"), resolvedByName: "auto" };
  await db.tuteeRemovalRequest.upsert({ where: { id: "hist-rm-devi" }, update: deviRm, create: { id: "hist-rm-devi", ...deviRm } });

  // A couple tutor-issued yellow cards, reviewed (one valid, one invalidated on appeal).
  const yellows = [
    { id: "hist-card-y1", tuteeId: "ptutee-25-06", date: "2025-09-25", status: "VALID" as const, issuedByTutorId: "tutor-carol", reason: "Repeatedly late to sessions." },
    { id: "hist-card-y2", tuteeId: "ptutee-25-02", date: "2026-02-12", status: "INVALID" as const, issuedByTutorId: "tutor-alice", reason: "Marked late — tutee had notified; appealed." },
  ];
  for (const c of yellows) {
    const at = new Date(`${c.date}T16:00:00Z`);
    const cdata = { tuteeId: c.tuteeId, color: "YELLOW" as const, source: "TUTOR" as const, reason: c.reason, reviewStatus: c.status, issuedByTutorId: c.issuedByTutorId, reviewedById: "user-admin", reviewedAt: at, createdAt: at };
    await db.disciplinaryCard.upsert({ where: { id: c.id }, update: cdata, create: { id: c.id, ...cdata } });
  }

  // --- Voluntary opt-out: Esme Walsh left mid-year (relayed by her tutor, approved in Q3) -------
  const esmeRm = { tuteeId: "ptutee-25-05", kind: "VOLUNTARY" as const, state: "APPROVED" as const, requestedByTutorId: "tutor-carol", reason: "Moved away; stopped attending.", removedPeriodKey: "25-26 Q3", createdAt: new Date("2026-02-05T10:00:00Z"), resolvedAt: new Date("2026-02-12T10:00:00Z"), resolvedByName: "auto" };
  await db.tuteeRemovalRequest.upsert({ where: { id: "hist-rm-esme" }, update: esmeRm, create: { id: "hist-rm-esme", ...esmeRm } });

  // --- Tutor opt-out (approved Q3) then reentry (approved Q4): Harold took a term off ----------
  const haroldOut = { tutorId: "tutor-harold", kind: "OPT_OUT" as const, state: "APPROVED" as const, reason: "Heavy course load that quarter.", eligibleAt: new Date("2026-02-12T00:00:00Z"), createdAt: new Date("2026-02-05T00:00:00Z"), resolvedAt: new Date("2026-02-13T00:00:00Z"), resolvedByName: "Admin A" };
  await db.tutorStatusRequest.upsert({ where: { id: "hist-tsr-harold-out" }, update: haroldOut, create: { id: "hist-tsr-harold-out", ...haroldOut } });
  const haroldBack = { tutorId: "tutor-harold", kind: "REENTRY" as const, state: "APPROVED" as const, reason: "Ready to return.", eligibleAt: null as Date | null, createdAt: new Date("2026-03-26T00:00:00Z"), resolvedAt: new Date("2026-03-27T00:00:00Z"), resolvedByName: "Admin A" };
  await db.tutorStatusRequest.upsert({ where: { id: "hist-tsr-harold-back" }, update: haroldBack, create: { id: "hist-tsr-harold-back", ...haroldBack } });

  // --- Recruitment: two applications decided during the year ----------------------------------
  const apps = [
    { id: "hist-app-1", name: "Mira Vance", email: "mira.v@example.edu", contact: "Email", status: "ACCEPTED" as const, created: "2025-09-15", decided: "2025-09-29", subjectId: "course-apcalc", by: "tutor-gina", note: "Strong fundamentals — accepted." },
    { id: "hist-app-2", name: "Theo Park", email: "theo.p@example.edu", contact: "Text 555-0133", status: "REJECTED" as const, created: "2025-11-12", decided: "2025-11-26", subjectId: "course-english", by: "tutor-carol", note: "Encouraged to reapply after more prep." },
  ];
  for (const a of apps) {
    await db.tutorApplication.upsert({
      where: { id: a.id },
      update: { name: a.name, email: a.email, preferredContact: a.contact, status: a.status, decisionComment: a.note, decidedByTutorId: a.by, decidedAt: new Date(`${a.decided}T12:00:00Z`) },
      create: {
        id: a.id, name: a.name, email: a.email, preferredContact: a.contact, status: a.status,
        createdAt: new Date(`${a.created}T12:00:00Z`), decisionComment: a.note, decidedByTutorId: a.by, decidedAt: new Date(`${a.decided}T12:00:00Z`),
        subjectIntents: { create: [{ subjectId: a.subjectId, taken: true, grade: "A" }] },
      },
    });
  }
}

// ---------------------------------------------------------------------------

async function main() {
  // --- Term ------------------------------------------------------------------
  // Deployment init: the program starts at 26-27 Q1. Deactivate any other term first so there is
  // exactly one active Term (getActivePeriod picks the most recent active one), then activate ours.
  // `createdAt` is fixed before all the back-dated demo data below (sessions/cards/etc. up to ~35
  // days ago) so the Reports page — which derives each period's calendar window from term.createdAt
  // — includes this quarter's data rather than excluding it.
  await db.term.updateMany({ where: { id: { not: "term-2026-q1" } }, data: { active: false } });
  const term = await db.term.upsert({
    where: { id: "term-2026-q1" },
    update: { name: "26-27 Q1", schoolYear: "26-27", quarter: "Q1", active: true, createdAt: ACTIVE_TERM_CREATED_AT },
    create: { id: "term-2026-q1", name: "26-27 Q1", schoolYear: "26-27", quarter: "Q1", active: true, createdAt: ACTIVE_TERM_CREATED_AT },
  });
  // Historical terms (25-26 Q1–Q4) — inactive, fixed start dates. Their period-stamped data
  // (sessions, cards, requests…) is seeded later, once the tutors/tutees/pairings it references
  // exist (see seedHistory()).
  for (const h of HISTORY_TERMS) {
    const tdata = { name: h.name, schoolYear: HISTORY_SCHOOL_YEAR, quarter: h.quarter, active: false, createdAt: h.createdAt };
    await db.term.upsert({ where: { id: h.id }, update: tdata, create: { id: h.id, ...tdata } });
  }

  // --- Built-in languages ----------------------------------------------------
  // Keep the Language table in sync with the bundled locales (src/i18n/config.ts) — the single
  // source of truth. listLanguages() merges built-ins even without rows, but seeding them makes
  // the DB consistent and gives the picker a deterministic order. Translator-added languages
  // (non-built-in) are left untouched.
  for (let i = 0; i < LOCALES.length; i++) {
    const code = LOCALES[i]!;
    const data = { label: LOCALE_LABELS[code], sortOrder: i, builtIn: true };
    await db.language.upsert({ where: { code }, update: data, create: { code, ...data } });
  }

  // --- Rooms + blackout periods ----------------------------------------------
  for (const room of ROOMS) {
    await db.room.upsert({ where: { id: room.id }, update: { name: room.name }, create: room });
  }
  for (const b of ROOM_BLOCKS) {
    const data = { roomId: b.roomId, dayOfWeek: b.dayOfWeek, startMin: hm(b.start), endMin: hm(b.end), reason: b.reason };
    await db.roomUnavailability.upsert({ where: { id: b.id }, update: data, create: { id: b.id, ...data } });
  }

  // --- Tutors ----------------------------------------------------------------
  for (const t of TUTORS) {
    const data = { firstName: t.firstName, lastName: t.lastName, englishName: t.englishName, alternativeNames: t.altNames, username: t.username, email: t.email, status: t.status, gradeLevel: t.gradeLevel };
    await db.tutor.upsert({ where: { id: t.id }, update: data, create: { id: t.id, ...data } });
  }

  // --- Course levels + courses -----------------------------------------------
  for (const level of LEVELS) {
    await db.subjectLevel.upsert({ where: { id: level.id }, update: { name: level.name, rank: level.rank, apScored: level.apScored }, create: level });
  }
  for (const course of COURSES) {
    await db.subject.upsert({ where: { id: course.id }, update: { name: course.name, levelId: course.levelId }, create: course });
  }

  // --- Time slots ------------------------------------------------------------
  for (const s of TIME_SLOTS) {
    const data = { label: s.label, dayOfWeek: s.dayOfWeek, startMin: hm(s.start), endMin: hm(s.end) };
    await db.timeSlot.upsert({ where: { id: s.id }, update: data, create: { id: s.id, ...data } });
  }

  // --- Tutees (active) -------------------------------------------------------
  for (const tutee of TUTEES) {
    const data = { englishName: tutee.englishName, gradeLevel: tutee.gradeLevel, status: "ACTIVE" as const, firstChoiceId: tutee.firstChoiceId };
    await db.tutee.upsert({ where: { id: tutee.id }, update: data, create: { id: tutee.id, ...data } });
  }

  // --- Removed/opted-out tutees (INACTIVE, no pairings) ----------------------
  for (const tutee of REMOVED_TUTEES) {
    const data = {
      englishName: tutee.englishName, gradeLevel: tutee.gradeLevel, email: tutee.email,
      phone: tutee.phone, status: "INACTIVE" as const,
    };
    await db.tutee.upsert({ where: { id: tutee.id }, update: data, create: { id: tutee.id, ...data } });
  }

  // --- Pending public signups (with availability), earliest-first ------------
  for (const p of PENDING_SIGNUPS) {
    const data = {
      englishName: p.englishName, gradeLevel: p.gradeLevel, email: p.email, preferredContact: p.preferredContact,
      status: "PENDING" as const, firstChoiceId: p.firstChoiceId, secondChoiceId: p.secondChoiceId ?? null,
      signedRulebook: true, signatureName: p.englishName, signedAt: daysAgo(p.daysAgo), createdAt: daysAgo(p.daysAgo),
    };
    await db.tutee.upsert({ where: { id: p.id }, update: data, create: { id: p.id, ...data } });
    for (const slotId of p.slotIds) {
      await db.tuteeAvailability.upsert({ where: { tuteeId_slotId: { tuteeId: p.id, slotId } }, update: {}, create: { tuteeId: p.id, slotId } });
    }
  }

  // --- Tutor availability ----------------------------------------------------
  const tutorAvailability = [
    { tutorId: "tutor-alice", slotId: "slot-mon-a" }, { tutorId: "tutor-alice", slotId: "slot-wed-a" },
    { tutorId: "tutor-bob", slotId: "slot-wed-a" }, { tutorId: "tutor-carol", slotId: "slot-fri-a" },
    { tutorId: "tutor-david", slotId: "slot-tue-a" }, { tutorId: "tutor-gina", slotId: "slot-thu-b" },
    { tutorId: "tutor-harold", slotId: "slot-mon-b" }, { tutorId: "tutor-iris", slotId: "slot-tue-b" },
    { tutorId: "tutor-jason", slotId: "slot-wed-b" }, { tutorId: "tutor-karen", slotId: "slot-thu-b" },
    { tutorId: "tutor-leo", slotId: "slot-fri-b" }, { tutorId: "tutor-mona", slotId: "slot-mon-a" },
  ];
  for (const a of tutorAvailability) {
    await db.tutorAvailability.upsert({ where: { tutorId_slotId: { tutorId: a.tutorId, slotId: a.slotId } }, update: {}, create: a });
  }

  // --- Pairings (with rostered tutees) ---------------------------------------
  for (const p of PAIRINGS) {
    const data = { subject: p.subject, dayOfWeek: p.day, startMin: hm(p.start), endMin: hm(p.end), tutorId: p.tutorId, termId: term.id, roomId: p.roomId, timeSlotId: p.slotId };
    await db.pairing.upsert({ where: { id: p.id }, update: data, create: { id: p.id, ...data } });
    for (const tuteeId of p.tuteeIds) {
      await db.pairingTutee.upsert({ where: { pairingId_tuteeId: { pairingId: p.id, tuteeId } }, update: {}, create: { pairingId: p.id, tuteeId } });
    }
  }

  // --- Dev login users (every tutor + admin) ---------------------------------
  const passwordHash = hashPassword(DEV_PASSWORD);
  const users = [
    // Every account carries a username (the admin has no tutor, so it's a derived handle).
    // The bootstrap admin gets a two-word name ("Admin A") so it splits cleanly into first/last.
    { id: "user-admin", name: "Admin A", email: "admin@example.edu", role: "HEAD" as Role, tutorId: null as string | null, username: "admin" },
    ...TUTORS.map((t) => ({ id: `user-${t.id.replace("tutor-", "")}`, name: t.englishName, email: t.email, role: t.role, tutorId: t.id as string | null, username: t.username })),
  ];
  for (const u of users) {
    const data = { name: u.name, role: u.role, tutorId: u.tutorId, username: u.username, passwordHash, emailVerifiedAt: new Date() };
    await db.user.upsert({ where: { email: u.email }, update: data, create: { id: u.id, email: u.email, ...data } });
  }

  // --- Attendance sessions (service hours computed server-side) --------------
  for (const s of SESSIONS) {
    const date = daysAgo(s.daysAgo);
    const computed = computeSessionHours({
      tutorStatus: s.tutorStatus,
      tuteeStatuses: s.tutees.map((t) => t.status),
      startMin: hm(s.start),
      endMin: hm(s.end),
      date,
    });
    const r = s.ratings ?? null;
    const data = {
      date, tutorStatus: s.tutorStatus, tutorAbsentReason: s.tutorAbsentReason ?? null,
      startMin: hm(s.start), endMin: hm(s.end),
      ratingPreparedness: r, ratingParticipation: r, ratingUnderstanding: r, ratingBehavior: r, ratingProgress: r,
      comments: s.comments ?? null,
      month: computed.month, schoolYear: term.schoolYear, quarter: term.quarter,
      durationMin: computed.durationMin, shFactor: computed.shFactor, shCount: computed.shCount,
      pairingId: s.pairingId, tutorId: s.tutorId,
    };
    await db.session.upsert({ where: { id: s.id }, update: data, create: { id: s.id, ...data } });
    for (const t of s.tutees) {
      await db.sessionTutee.upsert({
        where: { sessionId_tuteeId: { sessionId: s.id, tuteeId: t.tuteeId } },
        update: { status: t.status, absenceReason: t.reason ?? null },
        create: { sessionId: s.id, tuteeId: t.tuteeId, status: t.status, absenceReason: t.reason ?? null },
      });
    }
  }

  // --- Realistic past year (25-26 Q1–Q4): sessions, discipline, requests, recruitment --------
  await seedHistory();

  // --- Disciplinary cards ----------------------------------------------------
  for (const c of CARDS) {
    const data = {
      tuteeId: c.tuteeId, color: c.color, source: c.source, reason: c.reason, reviewStatus: c.reviewStatus,
      issuedByTutorId: c.issuedByTutorId ?? null,
      sessionId: c.sessionId ?? null,
      reviewedById: c.reviewed ? (c.reviewedById ?? null) : null,
      reviewedAt: c.reviewed ? daysAgo(2) : null,
    };
    await db.disciplinaryCard.upsert({ where: { id: c.id }, update: data, create: { id: c.id, ...data } });
  }

  // --- Service-hour adjustments (extra credit + punishments) -----------------
  const month = monthKey(new Date());
  const adjustments = [
    { id: "adj-alice-extra", tutorId: "tutor-alice", type: "EXTRA" as const, amount: 1.0, reason: "Interviewed a tutor applicant." },
    { id: "adj-bob-pun", tutorId: "tutor-bob", type: "PUNISHMENT" as const, amount: 1.0, reason: "Unexcused session absence." },
    { id: "adj-carol-extra", tutorId: "tutor-carol", type: "EXTRA" as const, amount: 0.5, reason: "Ran an extra exam-prep workshop." },
    { id: "adj-karen-pun", tutorId: "tutor-karen", type: "PUNISHMENT" as const, amount: 0.25, reason: "Late attendance submission." },
  ];
  for (const a of adjustments) {
    const data = { month, schoolYear: term.schoolYear, quarter: term.quarter, type: a.type, amount: a.amount, reason: a.reason, tutorId: a.tutorId };
    await db.serviceHourAdjustment.upsert({ where: { id: a.id }, update: data, create: { id: a.id, ...data } });
  }

  // --- Crew patrols ----------------------------------------------------------
  // A custom room patrol order (the order the crew walks), two crew members (tutors can also be
  // crew), one recorded patrol, and one attendance-discrepancy flag the crew raised.
  const PATROL_ORDER = ["room-a101", "room-a102", "room-a103", "room-b201", "room-b202", "room-library", "room-lab1"];
  for (let i = 0; i < PATROL_ORDER.length; i++) {
    await db.room.update({ where: { id: PATROL_ORDER[i]! }, data: { patrolOrder: i } });
  }
  // Iris and Leo are tutors who also serve on the crew (ACTIVE crew status).
  for (const email of ["iris@example.edu", "leo@example.edu"]) {
    await db.user.update({ where: { email }, data: { crewStatus: "ACTIVE" } }).catch(() => undefined);
  }
  // A crew-only login (role CREW, no Tutor) — created via a crew registration code in real use.
  await db.user.upsert({
    where: { email: "crew@example.edu" },
    update: { crewStatus: "ACTIVE", role: "CREW", gradeLevel: 11, name: "Cora Bennett" },
    create: {
      id: "user-crew-cora",
      email: "crew@example.edu",
      username: "cbennett29",
      name: "Cora Bennett",
      role: "CREW",
      gradeLevel: 11,
      crewStatus: "ACTIVE",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });
  // A pending crew application (public form) + a pending crew opt-out request + a crew code.
  await db.crewApplication.upsert({
    where: { id: "crewapp-1" },
    update: {},
    create: {
      id: "crewapp-1",
      name: "Dorian West",
      email: "dorian@example.edu",
      gradeLevel: 10,
      preferredContact: "dorian@example.edu",
      message: "I'd like to help validate attendance.",
      createdAt: daysAgo(2),
    },
  });
  const coraUser = await db.user.findFirst({ where: { email: "crew@example.edu" }, select: { id: true } });
  if (coraUser) {
    await db.crewStatusRequest.upsert({
      where: { id: "crewreq-1" },
      update: {},
      create: {
        id: "crewreq-1",
        userId: coraUser.id,
        kind: "OPT_OUT",
        reason: "Schedule got too busy this quarter.",
        eligibleAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        createdAt: daysAgo(2),
      },
    });
  }
  await db.registrationCode.upsert({
    where: { id: "regcode-crew" },
    update: { kind: "CREW" },
    create: {
      id: "regcode-crew",
      code: generateRegistrationCode(),
      kind: "CREW",
      email: "newcrew@example.edu",
      label: "Crew recruit (crew)",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  const irisUser = await db.user.findFirst({ where: { tutorId: "tutor-iris" }, select: { id: true } });
  if (irisUser) {
    const patrolData = { crewUserId: irisUser.id, termId: term.id, hours: 0.5, note: "Afternoon sweep — A-wing quiet." };
    await db.patrol.upsert({ where: { id: "patrol-demo-1" }, update: patrolData, create: { id: "patrol-demo-1", ...patrolData, createdAt: daysAgo(1) } });
    const obs: { id: string; roomId: string; headcount: "ZERO" | "ONE" | "TWO" | "THREE" | "FOUR_PLUS" }[] = [
      { id: "patrolobs-1", roomId: "room-a101", headcount: "TWO" },
      { id: "patrolobs-2", roomId: "room-b201", headcount: "THREE" },
      { id: "patrolobs-3", roomId: "room-library", headcount: "FOUR_PLUS" },
    ];
    for (const o of obs) {
      const data = { patrolId: "patrol-demo-1", roomId: o.roomId, headcount: o.headcount, observedAt: daysAgo(1) };
      await db.patrolObservation.upsert({ where: { id: o.id }, update: data, create: { id: o.id, ...data } });
    }
  }
  // Record the room used on a couple of sessions, and flag one under-count for admin review:
  // Alice's Math session reported 3 students present, but the crew counted only 2 in A101.
  await db.session.update({ where: { id: "sess-alice-1" }, data: { actualRoomId: "room-a101", online: false } }).catch(() => undefined);
  await db.session.update({ where: { id: "sess-bob-1" }, data: { actualRoomId: "room-b201", online: false } }).catch(() => undefined);
  await db.session.update({ where: { id: "sess-jason-1" }, data: { online: true, actualRoomId: null } }).catch(() => undefined);
  const flagData = { sessionId: "sess-alice-1", tutorId: "tutor-alice", expected: 3, observed: 2, state: "PENDING" as const };
  await db.sessionFlag.upsert({ where: { id: "flag-alice-1" }, update: flagData, create: { id: "flag-alice-1", ...flagData, createdAt: daysAgo(1) } });

  // --- Observer (read-only VIEWER) accounts: a public self-registration + a suspended one with
  // a pending reinstatement appeal, to exercise the suspend/appeal lifecycle on /admin/users. ---
  await db.user.upsert({
    where: { email: "parent@example.edu" },
    update: { role: "VIEWER", affiliation: "Parent of Emma", name: "Pat Rivera" },
    create: { id: "user-observer-1", email: "parent@example.edu", username: "privera", name: "Pat Rivera", role: "VIEWER", affiliation: "Parent of Emma", passwordHash, emailVerifiedAt: new Date() },
  });
  const suspendedObserver = await db.user.upsert({
    where: { email: "observer2@example.edu" },
    update: { role: "VIEWER", affiliation: "Community member", name: "Sam Okafor", suspendedAt: new Date(), suspendedReason: "Flagged for review." },
    create: { id: "user-observer-2", email: "observer2@example.edu", username: "sokafor", name: "Sam Okafor", role: "VIEWER", affiliation: "Community member", suspendedAt: new Date(), suspendedReason: "Flagged for review.", passwordHash, emailVerifiedAt: new Date() },
  });
  await db.accountAppeal.upsert({
    where: { id: "appeal-1" },
    update: {},
    create: { id: "appeal-1", userId: suspendedObserver.id, message: "I'm a parent following my child's progress — please restore access." },
  });

  // --- Tutor applications + interview workflow -------------------------------
  for (const app of APPLICATIONS) {
    await db.tutorApplication.upsert({
      where: { id: app.id },
      update: {
        name: app.name, email: app.email, preferredContact: app.preferredContact, status: app.status,
        decisionComment: app.decisionComment ?? null, decidedByTutorId: app.decidedByTutorId ?? null,
        decidedAt: app.decisionComment ? daysAgo(app.daysAgo - 1) : null,
      },
      create: {
        id: app.id, name: app.name, email: app.email, preferredContact: app.preferredContact, status: app.status,
        createdAt: daysAgo(app.daysAgo),
        decisionComment: app.decisionComment ?? null, decidedByTutorId: app.decidedByTutorId ?? null,
        decidedAt: app.decisionComment ? daysAgo(app.daysAgo - 1) : null,
        subjectIntents: {
          create: app.intents.map((i) => ({
            subjectId: i.subjectId, taken: i.taken ?? false, grade: i.grade ?? null,
            hasApScore: i.hasApScore ?? false, apScore: i.apScore ?? null,
            selfStudied: i.selfStudied ?? false, selfStudyNote: i.selfStudyNote ?? null,
          })),
        },
      },
    });
    for (const m of app.panel ?? []) {
      await db.interviewAssignment.upsert({
        where: { applicationId_tutorId: { applicationId: app.id, tutorId: m.tutorId } },
        update: { isHead: m.isHead },
        create: { applicationId: app.id, tutorId: m.tutorId, isHead: m.isHead },
      });
      await db.interviewVote.upsert({
        where: { applicationId_tutorId: { applicationId: app.id, tutorId: m.tutorId } },
        update: { accept: m.accept, comment: m.comment },
        create: { applicationId: app.id, tutorId: m.tutorId, accept: m.accept, comment: m.comment },
      });
    }
  }

  // --- Announcements ---------------------------------------------------------
  const announcements = [
    { id: "ann-welcome", title: "Welcome back — Q3 pairings are live", body: "Please confirm your session times with your tutees this week and submit attendance within 24h of each session.", pinned: true, active: true },
    { id: "ann-meeting", title: "Tutor meeting Monday at lunch", body: "Weekly tutor meeting in the Library during lunch. Excuse yourself at least 1 hour ahead if you can't make it.", pinned: false, active: true },
    { id: "ann-old", title: "Q2 wrap-up (archived)", body: "Thanks for a great Q2! This notice is archived.", pinned: false, active: false },
  ];
  for (const a of announcements) {
    const data = { title: a.title, body: a.body, pinned: a.pinned, active: a.active, createdById: "user-admin" };
    await db.announcement.upsert({ where: { id: a.id }, update: data, create: { id: a.id, ...data } });
  }

  // --- Tutor meetings + attendance -------------------------------------------
  // Excused entries carry a tutor-submitted reason + `excusedAt` so the meeting page's amber
  // "self-excused" panel renders (a tutor self-excuses from their dashboard up to 30m before).
  const meetings = [
    {
      id: "meeting-1", title: "Weekly tutor meeting", daysAgo: 1,
      present: ["tutor-alice", "tutor-bob", "tutor-carol", "tutor-gina"],
      excused: [{ tutorId: "tutor-david", reason: "Doctor's appointment — notified in advance." }],
      unexcused: ["tutor-harold"],
    },
    {
      id: "meeting-2", title: "Mid-term reshuffle briefing", daysAgo: 8,
      present: ["tutor-alice", "tutor-carol", "tutor-iris", "tutor-jason", "tutor-leo"],
      excused: [{ tutorId: "tutor-bob", reason: "Class field trip clashed with the meeting." }],
      unexcused: [],
    },
  ];
  for (const m of meetings) {
    const meetingDate = daysAgo(m.daysAgo);
    await db.tutorMeeting.upsert({
      where: { id: m.id },
      update: { title: m.title, date: meetingDate, termId: term.id },
      create: { id: m.id, title: m.title, date: meetingDate, termId: term.id },
    });
    const rows = [
      ...m.present.map((tutorId) => ({ tutorId, status: "PRESENT" as const, reason: null as string | null, excusedAt: null as Date | null })),
      ...m.excused.map((e) => ({ tutorId: e.tutorId, status: "EXCUSED_ABSENT" as const, reason: e.reason, excusedAt: daysAgo(m.daysAgo + 1) })),
      ...m.unexcused.map((tutorId) => ({ tutorId, status: "UNEXCUSED_ABSENT" as const, reason: null as string | null, excusedAt: null as Date | null })),
    ];
    for (const a of rows) {
      const data = { status: a.status, reason: a.reason, excusedAt: a.excusedAt };
      await db.meetingAttendance.upsert({
        where: { meetingId_tutorId: { meetingId: m.id, tutorId: a.tutorId } },
        update: data,
        create: { meetingId: m.id, tutorId: a.tutorId, ...data },
      });
    }
  }

  // --- Policy documents (editable in /admin/policies) ------------------------
  // One row per (slug, locale). The English source ships from ./policies; translated copies live
  // as markdown files under ./policies/<slug>.<locale>.md (each starts with a "# <title>" heading
  // we use as the row title). Missing translations just fall back to "en" at render time. Admins
  // can still edit/add languages in /admin/policies afterwards.
  const POLICY_VERSIONS: Record<string, string> = {
    "tutor-policy": "v.2025.10.13M",
    "tutee-policy": "v.2025.04.25M",
  };
  const POLICY_TITLES: Record<string, string> = {
    "tutor-policy": "Peer Tutoring Tutor Policy",
    "tutee-policy": "Peer Tutoring Tutee Policy",
  };
  // Derived from the bundled locales (minus the "en" source) so it can't drift out of sync.
  const POLICY_LOCALES = LOCALES.filter((c) => c !== "en");
  const policiesDir = join(dirname(fileURLToPath(import.meta.url)), "policies");

  const policies: { slug: string; locale: string; title: string; version: string; body: string }[] = [
    { slug: "tutor-policy", locale: "en", title: POLICY_TITLES["tutor-policy"]!, version: POLICY_VERSIONS["tutor-policy"]!, body: TUTOR_POLICY },
    { slug: "tutee-policy", locale: "en", title: POLICY_TITLES["tutee-policy"]!, version: POLICY_VERSIONS["tutee-policy"]!, body: TUTEE_POLICY },
  ];
  for (const slug of ["tutor-policy", "tutee-policy"]) {
    for (const locale of POLICY_LOCALES) {
      const file = join(policiesDir, `${slug}.${locale}.md`);
      if (!existsSync(file)) continue;
      const body = readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
      // Title = first "# heading" line, else fall back to the English title.
      const heading = body.split("\n").find((l) => l.startsWith("# "));
      const title = heading ? heading.slice(2).trim() : POLICY_TITLES[slug]!;
      policies.push({ slug, locale, title, version: POLICY_VERSIONS[slug]!, body });
    }
  }
  for (const p of policies) {
    await db.policyDocument.upsert({
      where: { slug_locale: { slug: p.slug, locale: p.locale } },
      update: { title: p.title, version: p.version, body: p.body },
      create: p,
    });
  }

  // --- Notifications ---------------------------------------------------------
  const notifications = [
    { id: "notif-alice-1", userId: "user-alice", title: "📣 Welcome back — Q3 pairings are live", body: "Confirm your session times this week.", link: "/dashboard" },
    { id: "notif-alice-2", userId: "user-alice", title: "You're on an interview panel", body: "Applicant: Fiona Applicant", link: "/dashboard" },
    { id: "notif-bob-1", userId: "user-bob", title: "📣 Tutor meeting Monday at lunch", body: "Library, during lunch.", link: "/dashboard" },
    { id: "notif-carol-1", userId: "user-carol", title: "New tutee signups awaiting review", body: "6 pending signups to assign.", link: "/admin/tutees" },
  ];
  for (const n of notifications) {
    await db.notification.upsert({
      where: { id: n.id },
      update: {},
      create: { id: n.id, userId: n.userId, title: n.title, body: n.body, link: n.link },
    });
  }

  // --- Tutor membership requests (opt-out / reentry) -------------------------
  for (const r of TUTOR_STATUS_REQUESTS) {
    const eligibleAt =
      r.cooldownDaysFromNow != null ? new Date(Date.now() + r.cooldownDaysFromNow * 86_400_000) : null;
    const data = { tutorId: r.tutorId, kind: r.kind, state: "PENDING" as const, reason: r.reason, eligibleAt };
    await db.tutorStatusRequest.upsert({ where: { id: r.id }, update: data, create: { id: r.id, ...data } });
  }

  // --- Tutee opt-outs & removals ---------------------------------------------
  const periodKey = `${term.schoolYear} ${term.quarter}`;
  for (const r of TUTEE_REMOVALS) {
    const finalized = r.state === "APPROVED";
    const data = {
      tuteeId: r.tuteeId, kind: r.kind, state: r.state, pairingId: r.pairingId,
      requestedByTutorId: r.tutorId, reason: r.reason,
      eligibleAt: r.eligibleInDays != null ? new Date(Date.now() + r.eligibleInDays * 86_400_000) : null,
      removedPeriodKey: finalized ? periodKey : null,
      resolvedAt: finalized && r.resolvedDaysAgo != null ? daysAgo(r.resolvedDaysAgo) : null,
      resolvedByName: finalized ? "auto" : null,
    };
    await db.tuteeRemovalRequest.upsert({ where: { id: r.id }, update: data, create: { id: r.id, ...data } });
  }

  // --- Registration codes (active / used / expired) --------------------------
  for (const c of REGISTRATION_CODES) {
    const data = {
      code: c.code, email: c.email, label: c.label, applicationId: c.applicationId,
      issuedById: "user-admin", issuedByName: "Admin A",
      expiresAt: new Date(Date.now() + c.expiresInDays * 86_400_000),
      usedAt: c.usedDaysAgo != null ? daysAgo(c.usedDaysAgo) : null,
    };
    await db.registrationCode.upsert({ where: { id: c.id }, update: data, create: { id: c.id, ...data } });
  }

  console.log(
    `Seeded: 1 term, ${ROOMS.length} rooms, ${LEVELS.length} levels, ${COURSES.length} courses, ` +
      `${TIME_SLOTS.length} time slots, ${TUTORS.length} tutors (active + pending/opted-out/graduated/archived), ` +
      `${TUTEES.length} active tutees + ${PENDING_SIGNUPS.length} pending signups + ${REMOVED_TUTEES.length} removed, ` +
      `${PAIRINGS.length} pairings, ${SESSIONS.length} sessions, ${CARDS.length} cards, ` +
      `${APPLICATIONS.length} applications, ${meetings.length} meetings, ` +
      `${TUTOR_STATUS_REQUESTS.length} tutor requests, ${TUTEE_REMOVALS.length} tutee opt-outs/removals, ` +
      `${REGISTRATION_CODES.length} registration codes, ${users.length} login users ` +
      `(password "${DEV_PASSWORD}"); history for 25-26 Q1–Q4 (S1 + S2) + active 26-27 Q1.`,
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
