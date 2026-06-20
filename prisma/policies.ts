/**
 * Initial content for the editable policy documents (seeded into PolicyDocument).
 * Migrated verbatim from the published handbooks; after seeding, admins edit these in
 * /admin/policies and the DB copy is the source of truth.
 */

export const TUTOR_POLICY = `# Peer Tutoring Tutor Policy

**Date Published:** October 13, 2025

This document is aimed to establish clear expectations, responsibilities, and procedures for tutors participating in the Peer Tutoring Program, ensuring consistency, accountability, and effective support for tutees.

---

### I. Tutor Responsibilities

Tutors are required to fulfill the following weekly tasks:

**1. Course Materials Preparation**
- Request course materials from tutees in advance to tailor session content.

**2. Session Preparation**
- Review materials and develop structured lesson plans aligned with tutee needs.

**3. Session Reminders**
- Send reminders to tutees at least 24 hours prior to scheduled sessions.

**4. Session Execution**
- Conduct sessions punctually and professionally, adhering to the agreed-upon schedule.

**5. Attendance Documentation**
- Submit accurate attendance surveys within 24 hours of each session. Falsification of records is strictly prohibited.

---

### II. Attendance Policy

**1. Notification Requirements**
- Tutors and tutees must notify each other **at least 24 hours in advance** if unable to attend a session.

**2. Rescheduling Priority**
- Tutors shall prioritize rescheduling missed sessions over canceling them.

**3. Tardiness and Absences**
- Tutees arriving more than **15 minutes late without prior notice** will be marked as **unexcused absent**.

**4. Survey Compliance**
- Tutors must submit attendance surveys truthfully and promptly after each session.

---

### III. Service Hours Accrual

**1. Earning Hours**
- Tutors earn service hours equal to the **session duration** multiplied by **(1 + number of tutees)**. This includes:
  - **Preparation time**: Equivalent to the session duration (e.g., 1 hour of prep for a 1-hour session).
  - **Session time per tutee**: Service hours equal to the session duration for each attending tutee.
- Tutors also earn service hours by interviewing new tutors, earning the same amount of hours as the interview session duration.

**2. Calculation Methodology**
- **Formula**: \`Total service hours per session = Session duration × (1 + number of tutees)\`
- **Examples**:
  - A 1-hour session with 2 tutees: \`1 hour × (1 + 2) = 3 service hours\`
  - A 1-hour session with 1 tutee: \`1 hour × (1 + 1) = 2 service hours\`
- **Rounding Policy**: Total hours are rounded to the **nearest half-hour**.

**3. Compensation for Absences**
- **Unexcused tutee absences** entitle tutors to service hours equal to: \`Scheduled session duration × (1 + number of attended tutees)\`

---

### IV. Policy Enforcement and Penalties

**1. Absence Limit**
- Tutors may not exceed **3 total absences per semester**, regardless of excusal status.

**2. Weekly Tutor Meetings**
- Weekly meetings will be held, often on Mondays during lunch break.
- Tutors should excuse for absence at least **1 hour** prior to the meeting if unable to attend.

**3. Deductions for Non-Compliance**
- Each absence beyond the 3-session limit will result in a deduction of **0.25 service hours**.
- Each unexcused absence from a tutor will result in a deduction of **1 service hour**.
- Each unexcused absence of weekly meeting will result in a deduction of **0.125 service hours**.

---

### V. Tutee Disciplinary Guidelines

**1. Yellow Card Violations** — assign via the attendance survey for: late arrival (15+ min, no notice); no response after 24 hours; failure to complete assigned work. **3 yellow cards = 1 red card.**

**2. Red Card Violations** — assign for: an unexcused absence; disrespectful behavior. **2 red cards = removal** from the program, pending final review.

**3. Reporting** — assign cards via the attendance survey, with reasons in the comments.

**4. Appeals** — tutees may appeal within **5 school days**.

**5. Comment Requirement** — every card needs a brief written justification.

---

### VI. Automatic Cards Issuance

- **Late arrival (15+ min, no notice)** → 1 red card.
- **Unexcused absence** → 1 red card.
- **Every 3 excused absences** → 1 red card.

The team monitors attendance records and enforces consequences; tutors just complete the survey accurately.

---

### VII. Tutor Recruitments

- All applicants are interviewed by a minimum of **two current student tutors**, including at least one Peer Tutoring Team member and at least one tutor of the subject area.
- A subject topic is assigned **24 hours prior**; the applicant presents it in a **15–20 minute** demonstration.
- The panel **votes**; a **simple majority** admits. Ties are broken by the Peer Tutoring Team representative.

---

### VIII. Communication Protocols

- Promptly contact the team with challenges (recurring absences, content difficulties).
- Report tutee violations via the survey's comment section.
- Mandatory meetings are **Mondays during lunch**; notify the team of absences **at least 1 hour in advance**.

---

By participating in the Peer Tutoring Program, tutors agree to adhere to all terms outlined in this policy.

**The Peer Tutoring Team** · **Version:** v.2025.10.13M
`;

export const TUTEE_POLICY = `# Peer Tutoring Tutee Policy

**Date Published:** April 24, 2025

This document is aimed to establish clear expectations for tutees to participate in the program, ensuring respect towards the tutors' effort and time dedicated for sessions.

---

### I. Tutee Responsibilities

**1. Pre-Session Preparation**
- Submit course materials to your tutor **preferably at least 48 hours** before sessions.
- Review session topics or pre-work to maximize productivity.

**2. Session Participation**
- Actively engage during sessions.
- Respect tutors' time by adhering to the session agenda.

**3. Post-Session Compliance**
- Complete assigned homework/tasks by agreed deadlines.
- Submit session feedback surveys within **24 hours post-session**.

---

### II. Attendance Policy

**1. Notification** — notify your tutor **in advance** if unable to attend. Late responses (24h+) incur **1 yellow card**.

**2. Tardiness** — arrivals **15+ minutes late** without notice are **unexcused absent** → 1 red card.

**3. Rescheduling** — reschedule in advance; prioritize rescheduling over missing.

**4. Attendance Penalties**
- **Every 3 excused absences** → **1 red card**.
- **Unexcused absences** → **1 red card**.

---

### III. Disciplinary Measures (Card System)

**Yellow Cards** — **3 yellow = 1 red**. Violations: late arrivals; unresponsive after 24h; incomplete work.

**Red Cards** — **2 red = removal**. Violations: unexcused absence; every 3 excused absences; disrespectful conduct.

---

### IV. Pairing and Allocations of Pairs

- The team **reshuffles pairs twice per semester** (start of semester; after midterms).
- An orientation presentation is held during a P&B session each reshuffle.
- **All tutees must fill out the current Tutee Signup Form**, regardless of previous participation.
- Allocation is based on tutor availability, first-come first-served, prioritizing first-choice subjects.
- Once matched, tutees **confirm the regular session time** with their tutor as soon as possible.

---

By enrolling in the program, tutees agree to comply with this policy.

**The Peer Tutoring Team** · **Version:** v.2025.04.25M
`;
