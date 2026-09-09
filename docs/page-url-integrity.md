# Page URL integrity

[Documentation](README.md) · [Content editor guide](user-guide.md#administrators) · [Slug allocator](../src/server/home/slugs.ts)

Custom pages and landing sections in page mode share `/p/<slug>`. Their database tables each enforce uniqueness separately, so checking both tables before a write was insufficient when two editors saved concurrently. A page could conceal a section using the same URL, or a same-table collision could fail the save.

The page-create, page-update and section-update mutations now hold one shared namespace lock through slug selection and the database write. Section creation starts in inline mode without a URL; converting it to page mode uses the same allocator. Coordinator approval replays use the enclosing decision transaction, retaining the lock until approval commits. Text-only translation edits do not allocate or change URLs.

The existing `-2`, `-3` collision suffixes are preserved. Generated slugs, including those suffixes, fit within the same 60-character validation used by the editor. Title truncation removes a trailing hyphen so a generated URL remains editable. Unpublished content continues to reserve its URL.

No published URLs are renamed by a migration. Operators can inspect any preexisting cross-table collision with this read-only query, then explicitly rename the intended document in the editor:

```sql
SELECT p.id AS "pageId", s.id AS "sectionId", p.slug
FROM "CustomPage" p JOIN "LandingSection" s ON s.slug = p.slug;
```

[Integration tests](../src/server/api/routers/home-slugs.test.ts) cover concurrent creation, cross-table allocation and renaming, long titles, unpublished reservations and repeated self-renames. A future route-registry table could enforce the same invariant for database imports and additional page types; current supported application writers share the transaction lock.
