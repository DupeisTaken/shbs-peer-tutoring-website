# Translation review conflicts

[Documentation](README.md) · [Translator guide](user-guide.md#translators) · [Destination checks](../src/server/translation-destination.ts)

Each new translation draft saves a server-generated fingerprint of its destination. Reviewers can publish only while that destination still matches the saved version. Previously, reviewing the draft's timestamp alone allowed an administrator to overwrite text that another editor changed after submission.

The check covers UI strings, fixed landing text, news translations, section translations and page titles. It also detects deleted content and deleted custom languages. A shared transaction lock coordinates direct edits, text removal, parent deletion and approval, so a concurrent save cannot slip between the check and publication. Publication, draft status and audit evidence roll back together if the enclosing approval fails.

When a conflict appears, reject the outdated draft, reload current text and submit a new proposal. The old draft remains as review history. Old drafts without a saved destination version also require this explicit resubmission; no migration invents a baseline or silently rebases an old proposal. Fingerprint metadata is stored in the existing JSON payload and omitted from the ordinary review display.

The check reads only affected content. Unrelated program-period changes do not invalidate a translation. Page titles use a locale map, so changes to that map require a new draft; other translation destinations use their exact locale/key.

Custom-language saves resolve their language on the same transaction connection that holds the write lock. Database lookup failures abort the save instead of redirecting it to English. Unknown or deleted language codes are rejected for writes; reload and choose an existing language. Read-only catalog fallback remains available. This also avoids acquiring a second connection while other translation writes wait for the lock.

[Database regressions](../src/server/translation-destination.test.ts) cover all five targets, concurrent editor/reviewer actions, competing proposals, legacy evidence, deleted locales/parents, hidden metadata and transaction rollback. [Combined approval tests](../src/server/shipping-integration.test.ts) verify that coordinator review still requires only one administrator approval.
