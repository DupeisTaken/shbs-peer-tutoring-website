# Messaging permissions and supervision

Messages deliver immediately as separate private deliveries, with at most 20 selected
recipients per send. Each recipient sees only their own message and replies; neither
message bodies nor batch recipients appear in notification previews.

The new messaging controls and disclosure are translated in English and Chinese. The other six bundled language catalogs currently use the English messaging copy while preserving their existing translations.

## Participant controls

Open **Messages** from your account menu. HEAD, ADMIN and COORDINATOR enter
`/admin/messages` inside the management shell. Tutees enter
`/student?view=messages`; tutor, crew and viewer accounts retain `/messages`.
All `/messages` notification links resolve using the current account role when opened, including after a role change.

Search by name or username, select checkboxes, and retain selected chips while searching
or paging. Usernames distinguish matching names. Remove a chip to remove a recipient.
The displayed groups describe the effective contact policy. Search is paginated in
50-contact pages, not capped at 50 total contacts. A send rechecks every selection;
if any contact has become ineligible, nothing is delivered. Review selections and retry.
A retry of the same send does not deliver duplicate messages or notifications.

Replies are new sends and follow current permissions. Losing a tutoring assignment or
contact permission does not erase your inbox. A messaging restriction blocks new sends
and incoming contact eligibility but retains historical reading. Account suspension
continues to block messaging access and directs the account to its appeal page.

## Contact permissions

HEAD and ADMIN open **Message supervision → Contact permissions**. Role defaults preserve
the previous access: management can contact all available accounts; other roles can
contact management. Select any union of these groups:

| Group | Exact scope |
| --- | --- |
| Management | HEAD, ADMIN and COORDINATOR accounts |
| Current tutors | Tutors assigned to an explicitly owned student profile in an active-term pairing |
| Past tutors | Recorded assigned tutors for explicitly owned current or historical profiles, excluding current tutors |
| Same scheduled group | Accounts owning tutees in the exact same active-term pairing; a shared quarter or time slot alone does not qualify |
| All available accounts | Any available account except self; use deliberately because it overrides relationship narrowing |

An optional **user override replaces** the role policy. Select no groups to prevent new
sends; remove the override to inherit the role again. Settings show the effective source
and groups. Reasons and before/after group lists enter the management audit log.
Messaging restrictions are separate from role groups and apply regardless of group choice.
Suspended, restricted, deleted and self accounts cannot be selected as new recipients.

## Supervision, privacy and historical rollout

The composer discloses that **HEAD and ADMIN may review new messages and hide content**.
COORDINATOR has its own management inbox but no supervision permission. Supervisors
search by participant name/username or message text and filter visible/hidden content. Use **View conversation** to follow both directions between a particular pair, or **All conversations** to clear that filter.
Opening content requires a reason and appends review evidence. Reviewing never changes
the recipient's read/unread state. Hiding removes content from both participants' API
responses while preserving the original for authorized review. Restoring makes it visible
again. Both actions retain actor, target, reason and timestamp; repeated identical moderation
requests do not duplicate the decision evidence. The review shows the latest 100 events;
older evidence remains stored. Account messaging restrictions and group changes are also
audited. There is no pre-delivery approval queue and no message deletion control.

**Existing messages stay participant-only.** Migration
`20260913020000_supervised_messaging` gives every existing row `supervisable=false` and
keeps this as the database default. An old application instance writing during a rolling
upgrade therefore cannot silently expose messages composed under the old privacy notice.
Only the updated send path, with the new disclosure version, explicitly marks a new
message supervisable. Old clients must refresh before sending a new message. Retries of
already-delivered old messages remain valid and never change their privacy. A new reply
to an old message has the new disclosure and is supervised independently of the old message.
Every supervision listing, text search, filter and review excludes historical private rows,
even if the supervisor knows the message ID. Participants can still read them normally.

Before opening the updated installation, publish reviewed English/Chinese policy wording
from the [policy sources](policies/README.md) using the normal policy workflow. The bundled
sources are drafts; this migration does not overwrite runtime policies or accepted snapshots.
The composer displays the supervision notice independently of policy publication.

## Implementation and validation

[Shared permissions](../src/server/messaging-permissions.ts) resolve stable profile ownership,
role policies and overrides for search, sends and replies. The assignment-evidence table is
backfilled only from surviving pairing memberships and attendance records. Database triggers
capture future membership additions and tutor changes across manual, intake and approval
paths. This evidence survives roster deletion; **unrecorded assignments deleted before this
migration cannot be reconstructed**, and names/emails are never used as substitutes.

[The router](../src/server/api/routers/messaging.ts) validates and deduplicates the entire batch,
then commits messages, receipt and notifications together. A sender lock serializes retries
and quota checks. The payload hash binds the canonical recipient set, body and disclosure to
a client key; changing them with a used key is a conflict. Each delivery has a distinct stored
client key, excluded from participant responses. A short shared table lock prevents assignment,
ownership, role or permission writes from racing validation and commit. There is no external
I/O under the transaction. Limits are 30 send attempts per minute per process and 100 new
recipient deliveries per minute persisted across processes. Exact receipt retries create no
new deliveries, including after permission changes.

Run the focused messaging, route and component regressions, then `npm run check`, the serial
integration suite, `npm run build`, `npm run docs:build` and `npm run docs:check`. Integration
fixtures accept only isolated loopback `shbs_messaging_test` or `shbs_shipping_test` databases.
Verify management and tutee navigation, desktop/mobile composition, keyboard checkbox access,
review/restriction controls and translated copy with synthetic accounts. See
[local setup](../README-LOCAL.md) for bounded resource and evidence conventions.
