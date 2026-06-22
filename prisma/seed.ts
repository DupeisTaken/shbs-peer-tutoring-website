/**
 * Seed script for local/dev databases — a rich, idempotent dataset that demonstrates the
 * full system (courses/levels, tutors, tutee + tutor requests, pairings, attendance with
 * computed service hours, discipline cards, adjustments, interview workflow, announcements,
 * meetings, notifications).
 *
 * Idempotent: fixed ids + upserts, so it can be run repeatedly. Run with `npm run db:seed`.
 */
import { PrismaClient } from "../generated/prisma";
import { hashPassword } from "../src/server/auth/password";
import {
  computeSessionHours,
  monthKey,
  type SessionTutorStatus,
  type TuteeAttendanceStatus,
} from "../src/lib/service-hours";
import { graduationYear } from "../src/lib/period";
import { TUTEE_POLICY, TUTOR_POLICY } from "./policies";

/** School year the seed's active term belongs to (used to derive class-of years). */
const SEED_SCHOOL_YEAR = "25-26";

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

type Role = "ADMIN" | "COORDINATOR" | "TUTOR";

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
  { id: "tutor-alice", firstName: "Alice", lastName: "Chen", altNames: "陈爱丽", email: "alice@example.edu", active: true, role: "TUTOR" as Role },
  { id: "tutor-bob", firstName: "Bob", lastName: "Liu", altNames: "刘波", email: "bob@example.edu", active: true, role: "TUTOR" as Role },
  { id: "tutor-carol", firstName: "Carol", lastName: "Wang", altNames: null, email: "carol@example.edu", active: true, role: "COORDINATOR" as Role },
  { id: "tutor-david", firstName: "David", lastName: "Zhao", altNames: "赵大卫", email: "david@example.edu", active: true, role: "TUTOR" as Role },
  { id: "tutor-gina", firstName: "Gina", lastName: "Hill", altNames: null, email: "gina@example.edu", active: true, role: "TUTOR" as Role },
  { id: "tutor-harold", firstName: "Harold", lastName: "Adams", altNames: null, email: "harold@example.edu", active: true, role: "TUTOR" as Role },
  { id: "tutor-iris", firstName: "Iris", lastName: "Patel", altNames: null, email: "iris@example.edu", active: true, role: "TUTOR" as Role },
  { id: "tutor-jason", firstName: "Jason", lastName: "Kim", altNames: "金在勋", email: "jason@example.edu", active: true, role: "TUTOR" as Role },
  { id: "tutor-karen", firstName: "Karen", lastName: "Diaz", altNames: null, email: "karen@example.edu", active: true, role: "TUTOR" as Role },
  { id: "tutor-leo", firstName: "Leo", lastName: "Murphy", altNames: null, email: "leo@example.edu", active: true, role: "TUTOR" as Role },
  { id: "tutor-mona", firstName: "Mona", lastName: "Rossi", altNames: null, email: "mona@example.edu", active: true, role: "TUTOR" as Role },
  { id: "tutor-nora", firstName: "Nora", lastName: "Park", altNames: "박노라", email: "nora@example.edu", active: true, role: "TUTOR" as Role },
  // Inactive tutors — signing in shows the pending-approval gate.
  { id: "tutor-evan", firstName: "Evan", lastName: "Tutor", altNames: null, email: "evan@example.edu", active: false, role: "TUTOR" as Role },
  { id: "tutor-oscar", firstName: "Oscar", lastName: "Brown", altNames: null, email: "oscar@example.edu", active: false, role: "TUTOR" as Role },
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
  { id: "card-noah-r1", tuteeId: "tutee-noah", color: "RED", source: "TUTOR", reason: "Disruptive behaviour during session.", reviewStatus: "VALID", issuedByTutorId: "tutor-gina", reviewedById: "user-admin", reviewed: true },
  { id: "card-noah-r2", tuteeId: "tutee-noah", color: "RED", source: "AUTO", reason: "Unexcused absence (auto-issued).", reviewStatus: "VALID", reviewed: false },
  { id: "card-umar-inv", tuteeId: "tutee-umar", color: "YELLOW", source: "TUTOR", reason: "Late — but tutee had notified; flagged invalid.", reviewStatus: "INVALID", issuedByTutorId: "tutor-karen", reviewedById: "user-admin", reviewed: true },
  { id: "card-eli-auto", tuteeId: "tutee-eli", color: "RED", source: "AUTO", reason: "Unexcused absence (auto-issued).", reviewStatus: "VALID", sessionId: "sess-nora-2", reviewed: false },
  { id: "card-cory-y1", tuteeId: "tutee-cory", color: "YELLOW", source: "TUTOR", reason: "Forgot materials.", reviewStatus: "PENDING", issuedByTutorId: "tutor-mona", reviewed: false },
  { id: "card-bella-y1", tuteeId: "tutee-bella", color: "YELLOW", source: "TUTOR", reason: "Late submission of practice set.", reviewStatus: "VALID", issuedByTutorId: "tutor-nora", reviewedById: "user-admin", reviewed: true },
  { id: "card-gabe-y1", tuteeId: "tutee-gabe", color: "YELLOW", source: "TUTOR", reason: "Phone use during session.", reviewStatus: "VALID", issuedByTutorId: "tutor-nora", reviewedById: "user-admin", reviewed: true },
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

// ---------------------------------------------------------------------------

async function main() {
  // --- Term ------------------------------------------------------------------
  const term = await db.term.upsert({
    where: { id: "term-2025-q3" },
    update: { name: "25-26 Q3", schoolYear: "25-26", quarter: "Q3", active: true },
    create: { id: "term-2025-q3", name: "25-26 Q3", schoolYear: "25-26", quarter: "Q3", active: true },
  });

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
    const data = { firstName: t.firstName, lastName: t.lastName, englishName: t.englishName, alternativeNames: t.altNames, username: t.username, email: t.email, active: t.active, gradeLevel: t.gradeLevel };
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
    { id: "user-admin", name: "Admin", email: "admin@example.edu", role: "ADMIN" as Role, tutorId: null as string | null },
    ...TUTORS.map((t) => ({ id: `user-${t.id.replace("tutor-", "")}`, name: t.englishName, email: t.email, role: t.role, tutorId: t.id as string | null })),
  ];
  for (const u of users) {
    const data = { name: u.name, role: u.role, tutorId: u.tutorId, passwordHash, emailVerifiedAt: new Date() };
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
  const meetings = [
    { id: "meeting-1", title: "Weekly tutor meeting", daysAgo: 1, present: ["tutor-alice", "tutor-bob", "tutor-carol", "tutor-gina"], excused: ["tutor-david"], unexcused: ["tutor-harold"] },
    { id: "meeting-2", title: "Mid-term reshuffle briefing", daysAgo: 8, present: ["tutor-alice", "tutor-carol", "tutor-iris", "tutor-jason", "tutor-leo"], excused: ["tutor-bob"], unexcused: [] },
  ];
  for (const m of meetings) {
    await db.tutorMeeting.upsert({
      where: { id: m.id },
      update: { title: m.title, date: daysAgo(m.daysAgo), termId: term.id },
      create: { id: m.id, title: m.title, date: daysAgo(m.daysAgo), termId: term.id },
    });
    const rows = [
      ...m.present.map((tutorId) => ({ tutorId, status: "PRESENT" as const })),
      ...m.excused.map((tutorId) => ({ tutorId, status: "EXCUSED_ABSENT" as const })),
      ...m.unexcused.map((tutorId) => ({ tutorId, status: "UNEXCUSED_ABSENT" as const })),
    ];
    for (const a of rows) {
      await db.meetingAttendance.upsert({
        where: { meetingId_tutorId: { meetingId: m.id, tutorId: a.tutorId } },
        update: { status: a.status },
        create: { meetingId: m.id, tutorId: a.tutorId, status: a.status },
      });
    }
  }

  // --- Policy documents (editable in /admin/policies) ------------------------
  // One row per (slug, locale). The seed only ships the English source; admins author the
  // 中文 versions in /admin/policies (the signup forms fall back to "en" until they do).
  const policies = [
    { slug: "tutor-policy", locale: "en", title: "Peer Tutoring Tutor Policy", version: "v.2025.10.13M", body: TUTOR_POLICY },
    { slug: "tutee-policy", locale: "en", title: "Peer Tutoring Tutee Policy", version: "v.2025.04.25M", body: TUTEE_POLICY },
  ];
  for (const p of policies) {
    await db.policyDocument.upsert({
      where: { slug_locale: { slug: p.slug, locale: p.locale } },
      update: { title: p.title, version: p.version },
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

  console.log(
    `Seeded: 1 term, ${ROOMS.length} rooms, ${LEVELS.length} levels, ${COURSES.length} courses, ` +
      `${TIME_SLOTS.length} time slots, ${TUTORS.length} tutors, ` +
      `${TUTEES.length} active tutees + ${PENDING_SIGNUPS.length} pending signups, ` +
      `${PAIRINGS.length} pairings, ${SESSIONS.length} sessions, ${CARDS.length} cards, ` +
      `${APPLICATIONS.length} applications, ${meetings.length} meetings, ${users.length} login users ` +
      `(password "${DEV_PASSWORD}").`,
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
