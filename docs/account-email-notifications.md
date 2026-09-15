# Account emails and notifications

Issue [#54](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/54) adds
verified secondary addresses and optional email notifications for every account role.

## Program and personal settings

An ADMIN or HEAD enables **Email notifications** on **Admin → Program**. The change
is immediate, independent of the staged optional modules and the email-2FA flag.
The default is off. Production requires a configured email transport.

Once enabled, **Account → Email preferences** offers independent categories:

- **Security**: password, two-factor settings, and associated-email changes (default on).
- **Messages**: a new private-message notice, without the message body (default off).
- **Information updates**: name, alternative names, role, suspension status, and existing
  in-app program notifications (default off).

Only verified primary addresses receive these notices by default. Users may opt to
include all verified secondary addresses. When security notifications are enabled,
a primary-address change also notifies the previous verified primary, even if it is
subsequently removed. Users may turn off each category, including security.

Disabling the program switch preserves personal preferences, prevents editing them,
and cancels queued notices; re-enabling does not send a historical backlog. Category
preferences and recipient ownership are checked again before delivery. A message
already accepted by SMTP cannot be recalled.

Verification emails, password-recovery links, and login/step-up codes are essential
authentication mail and are independent of these optional preferences.

## Associated addresses

Account settings and tutor settings share the same **Associated emails** controls.
Each account has one primary and up to five secondary addresses, including pending
ones. Enter the current password to add an address or resend its code. Verification
codes expire after ten minutes, permit five attempts, and have a one-minute resend
interval. A new code supersedes the previous code for that address. Cancel pending
addresses that are no longer needed.

Any verified associated address can sign in or recover the **same account**.
Recovery requested with a secondary address is delivered to that address; recovery
requested with a username goes to the primary. Login 2FA and password-change step-up
codes continue to go to the primary. Adding an alias does not bypass 2FA.

Enter the current password to promote a verified address or remove a secondary.
Promotion retains the previous verified primary as a secondary and synchronizes
only explicitly linked current tutor/tutee contact records. The primary cannot be
removed until another verified address replaces it. Removal revokes outstanding
recovery and verification grants for that address and clears current login/step-up
challenges. Re-adding the address does not revive those grants.

Account ID, username, role, participation, signed agreements, and historical records
remain unchanged. The existing verified email-replacement API remains supported.

## Implementation and deployment

Apply `20260916010000_account_emails` with `npm run db:migrate`, regenerate Prisma
with `npx prisma generate`, and restart the application before enabling notifications.
Existing primary addresses and reset-token destinations are backfilled. A normalized
address collision aborts migration rather than merging accounts; resolve any such
legacy collision before retrying.

`AccountEmail` is the shared unique namespace for primary and secondary addresses.
A database trigger reserves primary addresses for **every** account creation/update
path, including registration and invitations. Primary addresses are normalized to
trimmed lowercase. Account email operations take the existing account-profile lock
before modifying linked contact rows. Pending aliases cannot authenticate or recover.
Password-reset grants store and validate the exact destination address at redemption.

Database triggers record committed user changes and new in-app notifications in
`EmailDelivery`. This covers self-service settings, staff updates, password resets,
and message fan-out without relying on individual UI handlers. Failed transactions
and unchanged writes produce no notices. Events contain fixed descriptions rather
than passwords, codes, profile values, message contents, or recipient lists.

The Node instrumentation worker polls every 30 seconds, leasing at most ten deliveries
per batch for five minutes. Database row locking prevents ordinary duplicate sends
across application instances. Delivery failure retains the event with exponential
backoff, up to five attempts. Program settings shows the terminal failure count;
operators can inspect delivery status and safe failure summaries in `EmailDelivery`.
The worker sends a stable Message-ID on retries. SMTP cannot guarantee exactly-once
delivery after a process crash between provider acceptance and recording success.
The worker requires the project's long-running Node deployment; short-lived runtimes
need an external scheduler calling the same dispatcher.

## Validation

Use an isolated local `shbs_shipping_test` database and serial workers:

```sh
npm test -- --maxWorkers=1
npm run check
npm run docs:check
```

`src/server/auth/account-emails.test.ts` covers alias verification, ownership races,
recovery, primary switching, notification gating, rollback, and delivery retries.
`src/app/_components/account-emails.test.tsx` checks password-dependent actions,
verification, preferences, and the admin switch. The existing authentication,
profile, messaging, and locale-parity suites remain regression checks. Inspect
desktop/mobile screenshots of account and admin settings before release.
