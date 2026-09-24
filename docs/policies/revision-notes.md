# Policy revision review: 2026.09.24

[Policy sources and publication](README.md)

The four English/Chinese tutor and tutee documents are review drafts for the current website. Tutor sections I–VIII and tutee sections I–IV follow the legacy sequence. Numbered subsections retain practical expectations while placing the website procedures beside the relevant rule. Chinese uses the current website's 辅导伙伴 / 学习伙伴 terminology.

## Legacy source and scope

The source documents are the tutor policy published October 13, 2025 (v.2025.10.13M), and the tutee policy headed April 24, 2025 (footer v.2025.04.25M). Their English and Chinese copies are recoverable from Git at `f30cbc5^:docs/archive/policies-2025/`. The one-day discrepancy in the tutee source is retained here as provenance, not reused as a new effective date. The former handbook-draft files at that revision are redirects, not additional policies.

These drafts describe the repository implementation and preserve compatible program expectations. They do not change application logic, publish a database revision or establish school approval. The separate website privacy notice remains the source for information-handling details.

## Retained structure

| Legacy tutor section | Updated coverage |
| --- | --- |
| I. Tutor Responsibilities | Materials, preparation, reminders, delivery and website attendance |
| II. Attendance Policy | Notice, lateness, rescheduling, room conflicts and participation requests |
| III. Service Hours Accrual | Session credit, implemented rounding, interview and separate crew credit |
| IV. Policy Enforcement and Penalties | Meeting expectations, current deductions and attendance review |
| V. Tutee Disciplinary Guidelines | Requested cards, validation, removal and appeals |
| VI. Automatic Cards Issuance | Actual attendance-triggered rules and corrections |
| VII. Tutor Recruitments | Application, interviews, account setup, qualifications and refresh |
| VIII. Communication Protocols | Announcements, messages, privacy, policy acceptance and account safety |

| Legacy tutee section | Updated coverage |
| --- | --- |
| I. Tutee Responsibilities | Preparation, participation, feedback, communications and account safety |
| II. Attendance Policy | Notice, lateness, rescheduling, accurate records and attendance consequences |
| III. Disciplinary Measures (Card System) | Card validation, thresholds, automatic removal and appeals |
| IV. Pairing and Allocations of Pairs | Recruitment, matching, verification, schedules, withdrawal and renewed consent |

## Rule changes requiring school review

| Topic | Legacy wording | Draft treatment and basis |
| --- | --- | --- |
| Preparation and reminders | Materials preferably 48 hours ahead; reminders/absence notice 24 hours ahead | Retained as human expectations, allowing prompt emergency notice. No automatic website deadline or penalty is claimed. |
| Attendance and feedback submission | Submit surveys within 24 hours of the session | Website attendance within 24 hours; feedback within 24 hours after the recorded session becomes available. The feedback adjustment avoids a deadline expiring before a tutor records the session. |
| Lateness | Conflicting yellow/red descriptions and “more than 15” versus “15+” | Uses 15 minutes or more, normally classified as unexcused absence with factual review of emergencies. No separate timed or duplicate card. The school should confirm this classification before adoption. |
| Excused absence cards | Every three excused absences produce a red card | Removed as an automatic consequence; current attendance automation issues red cards for unexcused absence. See [discipline rules](../../src/lib/discipline.ts). |
| Card removal | Two red cards; tutor policy mentions final review | Two effective red cards automatically deactivate an active tutee and remove current-period assignments. Requested cards first require validation. See [removal implementation](../../src/server/discipline/removal.ts). |
| Appeals | Five school days | Retained with issue-date basis, program calendar, one appeal per card, no suspension of effects during review and conditional restoration. |
| Hour rounding | Nearest half-hour; examples use scheduled duration | Uses recorded duration rounded before the attendance multiplier, with explicit boundary examples matching the [calculator](../../src/lib/service-hours.ts). Combined blocks count time and distinct present students once. |
| Tutor absence penalties | Three total absences, 1-hour session deductions and 0.125-hour meeting deductions | Not carried forward. Current automation allows three unexcused meeting absences per semester, then deducts 0.25 hours per additional absence. Excused absences do not consume that allowance. Other adjustments require recorded authorized decisions. See [meeting reconciliation](../../src/server/meeting-hours.ts). |
| Meetings | Monday lunch | Follow published dates. The one-hour advance excuse requirement remains. |
| Interview panels | At least two tutors | At least three active tutors with accounts, management presence and recorded subject qualification; highest-ranking management chair. All votes required, majority then chair tie-break, coordinator outcome subject to approval. See [panel validation](../../src/server/interviews.ts). |
| Interview format | Topic 24 hours ahead, demonstration 15–20 minutes | Retained as staff-organized expectations, not automatic website constraints. |
| Recruitment and reshuffles | Twice per semester and P&B orientation | Use current recruitment windows, quarter/semester configuration and published orientation arrangements. No automatic fixed calendar is promised. |
| Agreement | Participation implies agreement | Explicit website acceptance, exact evidence and renewed acceptance of published changes. Reading a PDF alone does not create an acceptance record. |

## Added website procedures

Both audiences receive consistent explanations of current permissions, program timezone, private deliveries and disclosed message supervision, feedback visibility, account recovery and verification, and access retained when a renewal prompt is dismissed. The tutee policy explains queue priority, 24-hour confirmation links, the fixed seven-day post-assignment verification deadline, request recall and separate withdrawal routes. The tutor policy also covers combined attendance, review flags, qualification versus willingness, crew permissions and semester refresh.

Validate the drafts against the [user guide](../user-guide.md) and [program reference](../program-reference.md), including enabled modules and school contact arrangements. Only management can decide whether the school adopts these revised program expectations. If the school retains a legacy rule that the website does not enforce, document the staff procedure or implement and test the corresponding behavior before describing it as automatic.

## Printable exports and verification

Run `python scripts/export-policy-pdfs.py` with ReportLab installed to create four A4 PDFs in `output/pdf/`. The exporter reads the four maintained Markdown sources directly; do not edit exported PDFs separately. Windows Arial and Microsoft YaHei fonts are embedded by default; other environments can supply font paths through the script's options. Use `--help` for options. PDFs are generated local artifacts rather than runtime publication inputs.

Run `npm run docs:check` and `npx vitest run src/lib/policy-documents.test.ts src/lib/service-hours.test.ts src/lib/discipline.test.ts src/lib/policy-evidence.test.ts src/server/policy-acceptance.test.ts`. The document tests check source/catalog consistency, section correspondence between languages and the published rounding examples against the real calculator. Render every exported PDF page and review its typography, Chinese glyphs, tables and page breaks before circulation.

School approval must supply a real effective date and contact route, confirm the changed rules above and approve both languages. Then follow [Publish a revision](README.md#publish-a-revision). Existing acceptance records must be preserved. Repository edits and PDF exports do not update live policies.
