# Announcement recipients

On **Admin → Announcements**, use **Recipients** before publishing:

- **All current tutors** selects the current roster.
- **Filter tutors** combines grade, tutor status, subjects and current-term active-tutee assignment filters. Multiple choices within a group match any selected choice; different groups must all match. An empty filter group imposes no restriction.
- **Specific tutors only** starts with no recipients. Choose **Include** next to each intended tutor.

**Include** adds an individual regardless of filters. **Exclude** takes precedence over both filters and explicit inclusion. Search only narrows the list of tutors available for these overrides. The count and name preview always shows the full selected audience. A post with zero recipients is blocked.

Subject filtering includes approved teaching qualifications and subjects assigned in the current active term. The active-tutee count includes unique ACTIVE tutees in that term; past terms and inactive tutees do not count. Assignment filtering requires an active term.

The server resolves and freezes tutor identities when a post is published. For coordinator proposals, that happens when an administrator approves publication. The proposed names and identities are included in review evidence; if the resulting audience changes before approval, the reviewer must reject it and request a fresh proposal. Existing announcements remain broadcasts to all tutors. Editing, pinning, reactivating or restoring a new announcement does not recalculate its audience. To change its recipients, publish a new announcement.

Tutors can read and dismiss only active announcements addressed to them (or historical broadcasts). Matching uses their currently linked tutor identity, never a name or email. Authorized management readers retain access for oversight. In-app notifications carry announcement text only to recipients and authorized management readers; no email delivery is added. A tutor without a linked login can read their selected announcements if a login is linked later.

## Implementation and verification

Migration `20260912010000_announcement_recipients` adds a restricted-audience flag and an immutable tutor-ID array. Keeping the snapshot independent of roster foreign keys preserves its membership through tutor deletion and audit restoration. An empty restricted snapshot never falls back to broadcast visibility.

The shared selector drives both preview and server publication. Server read and acknowledgement queries share the same membership predicate. Announcement creation and in-app notification creation use one transaction. Existing coordinator approval classification still applies to creation, editing and deletion.

Run the focused unit, mocked tRPC authorization and interaction tests without modifying a live database:

```sh
npx vitest run src/lib/announcement-recipients.test.ts src/server/announcement-recipients.test.ts src/server/api/routers/announcement-recipients.test.ts 'src/app/(admin)/admin/announcements/recipient-picker.test.tsx' --maxWorkers=1
```

These cover filter composition, overrides, empty recipient rejection, stale selections, missing terms, restricted notification routing, read/acknowledgement scoping, management authorization, audit restoration, and the interactive recipient picker. A separate integration run should apply the migration to an isolated local database and verify the tutor dashboard and admin preview in a browser.
