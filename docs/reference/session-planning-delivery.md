# Session scheduling delivery and calendar subscriptions

[Documentation home](../README.md) · [Technical report](technical-report.md) · [Email operations](../guides/deployment.md#optional-notification-delivery)

## Essential session notices

`SessionNotice` is a dedicated, high-priority PROGRAM queue. Scheduling suggestions,
offers, alternatives, agreements, automatic agreements, split requests, splits,
cancellations and expiries commit their delivery intent with the domain transition.
These service notices ignore optional information-email preferences, optional
unsubscribe and the program's optional-notification switch. They retain PROGRAM
sender configuration, verified account-address ownership and transport safeguards;
they are not SECURITY mail. Recipient lists, peer names, free-text reasons and
private messages never enter the maintained bilingual copy.
Notices identify the lesson with bounded subject labels, original/proposed program-zone
times and a room or online location. These fields are allowlisted independently;
their presence never permits arbitrary profile, free-text or roster payloads.

Dispatched tutor notices link to `/schedule#sessions`; tutee notices continue to
use `/student?view=schedule#sessions`. The validated sign-in continuation retains
that destination, and the portal rechecks the recipient's current access before
showing the dated agenda. A link does not accept an offer or submit attendance.

The persistent Node worker runs an immediate sweep and then every 30 seconds. An
idempotent weekly-plan preparation runs on startup and at most every 15 minutes;
this catches missed Sunday preparation without making timers own published dates. Each
sweep settles deadline/cutoff state before claiming at most ten notices, ordered
by priority. Claims use five-minute leases and `FOR UPDATE SKIP LOCKED`; admission
and completion share the scheduling fence and an attempt UUID. SMTP runs outside
database transactions. Several server instances can claim disjoint batches.

A queued notice does not begin a response window. Only recorded SMTP acceptance
of the current response's essential notice qualifies its 24-hour deadline. The
initial email links to the portal's exact deadline; subscription refresh and
inbox delivery do not establish consent. Unconfigured development console mail
also does not qualify a clock. Missing configuration, failed delivery or lost
verified recipient ownership leaves a visible recovery condition and prevents
automatic agreement through that notice.

`SENT` means SMTP accepted the message, not that the participant received or read
it. Acceptance followed by a server/database failure can cause a retry; SMTP does
not offer exactly-once delivery. A stable Message-ID identifies the retained
receipt across attempts. Old completion attempts cannot settle newer attempts.
An obsolete offer's notice records history and directs the reader to current
portal state instead of soliciting a stale agreement.
The admission transaction is the dispatch cutover: cancellation before admission
prevents an actionable offer from being sent. A cancellation after SMTP admission
cannot reliably recall a message already in flight. Completion still records
actual acceptance, never starts the cancelled offer's response clock, and the
separate cancellation notice communicates the current outcome.

Failures use a fixed private-data-free diagnostic and exponential backoff, with
five automatic attempts. A recipient or active Admin/Head may retry a failed,
blocked or previously attempted receipt after fixing the cause. Recovery may
refresh the same account's verified primary address, but never changes account
ownership. It does not replay the schedule mutation or reset a deadline that
already qualified. A successful retry queues only the retained transport receipt.
Missing PROGRAM configuration or a verified primary mailbox remains visible;
retry does not manufacture delivery success. Active leases and already accepted
receipts cannot be manually reset.

The worker depends on the persistent Node runtime and database. A stopped server
cannot send notices; the next sweep performs catch-up. The planning service owns
short-notice expiration and decision semantics. Subscription polling is never
used to time a response window.

## Private read-only subscriptions

The participant may create or rotate a private subscription URL. The server
stores only a SHA-256 digest of a random 256-bit token; plaintext is returned once.
Losing the URL requires rotation. Rotation revokes all older account URLs, and a
separate revoke action remains available after participant access ends. Neither
status reads nor audit evidence return the token. Treat the complete URL as a
private credential; exclude it from screenshots, analytics and access logs.

`GET /api/session-calendar/[token]` validates the token and live account/participant
ownership on every fetch. It publishes confirmed dated commitments and retained
cancellation tombstones; pending negotiation and unconfirmed extras are excluded.
Fetching cannot change a proposal, publish plans, submit attendance or decide a
response. Suspended, merged, departed and unlinked participant access is denied.
Responses are private and non-cacheable with referrer and indexing protections.

Tutee UIDs use immutable participant-commitment IDs. Their sequence advances when
the effective commitment changes, so moving one student cannot move peers who
kept their original commitment. Tutor UIDs use immutable dated-cohort IDs. Empty
or cancelled cohorts must remain as versioned cancellation evidence; splitting
uses distinct cohort identities. Every effective participant clock/room/cohort
change must advance the participant version, even when the participant ID stays
the same. The feed includes no peer rosters, attendee addresses or subject-level
private details. Times are explicit UTC instants, text is escaped and UTF-8 lines
are folded by octets.

The feed retains 120 days of recent events/cancellation changes. Larger feeds
fail safely instead of silently truncating events. Revoking a URL blocks future
fetches; it cannot remove data already copied by an external calendar. Importing
an `.ics` file creates a snapshot. Subscriptions refresh according to the calendar
client and can lag more than 24 hours, so participants must use the portal and
essential email for current decisions. Direct provider writes and iTIP invitation
delivery are outside this integration.

Standards: [iCalendar RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545)
defines UID, SEQUENCE, cancellation status and serialization; [Microsoft's
subscription guidance](https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web)
describes snapshot imports and delayed subscription updates.

## Verification boundaries

Focused suites cover queued versus accepted delivery, missing SMTP, ownership
loss, stale leases/completions, failed retries, superseded offers, safe copy,
hashed token rotation/revocation, private ownership-scoped reads, stable moved
UIDs, cancellation tombstones, pending-extra exclusion and UTF-8 escaping/folding.
These mocked transport tests do not establish inbox placement or external
calendar-client interoperability. Rehearse supported calendar subscriptions and
captured synthetic emails before deployment; never send real participant mail
from local fixtures.
