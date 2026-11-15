# Maintain the visual help catalogue

The maintained article records live in
[`src/lib/help`](../../src/lib/help). Participant and management records share
one [schema](../../src/lib/help/types.ts). The website, GitHub editions and
downloadable PDF handbooks consume those same records. Keep task-specific
directions, prerequisites, outcomes and troubleshooting together. Each article's
`sources` and `covers` fields make functional coverage reviewable.

## Add or update a guide

1. Inspect the actual source and current UI, including the existing role and
   approval checks. The catalogue must describe those checks without changing them.
2. Update both English and Chinese records. Use the website's participant names
   and exact visible controls. Prefer a verb-led task title. Link related guides
   by slug; unavailable related guides are filtered on the server.
   Set `category` when the task differs from its audience's default grouping,
   such as a coordinator's publishing or program-configuration task. Set
   `requiresPrivateLink` for email-only workflows so readers use their own link.
3. Put the screenshot on the step it explains, and name the relevant control in
   `focus`. An overview image is useful for finding the screen; use a focused
   dialog or scrolled capture when the next task needs controls below that view.
4. Refresh affected captures using the procedure below, then run
   `npm run help:export` and `npm run help:check`. Complete the normal
   [required checks](verification.md#required-checks) for behavior changes.

## Retrieve screenshots from a real dev server

Use the [resource-safety and demo setup](local-development.md#worktree-and-resource-safety).
Never attach the capture server to production or a destructive test database.
Keep one server/browser session at a time; do not build against its `.next` output.

1. Fetch `origin` and record the full source SHA. If matching a deployment,
   obtain the operator's deployed image revision or deployment attestation.
   A GitHub `main` commit or successful image publish alone does not establish
   what is live. If the user chooses latest main, say exactly that in the receipt.
2. In the owned worktree, install the lockfile, apply committed migrations to a
   fresh local `shbs_*_demo` database and run the synthetic demo seed. Use the
   [listed demo accounts](local-development.md#demo-accounts-and-workflows).
   Leave SMTP unset so captures cannot email real recipients. Never include
   passwords, mailbox codes, invitation keys, capability links or real records.
3. Start the actual server, for example
   `npm run dev -- --hostname 127.0.0.1 --port 3017`. Use the in-app browser
   for manual capture. Set a documented viewport (this set uses 1440 × 1000),
   choose English or Chinese, and sign in to the appropriate synthetic account.
4. Use [coverage.json](../guides/help/coverage.json) to find the target guide,
   its screenshot IDs and route. Follow the steps to the relevant tab/dialog.
   Wait for the real query result; reject loading, denied, error or blank images.
   Inspect the exact saved JPEG before accepting it. Capture mobile states of
   changed Help pages at 390 × 844 as verification evidence.
5. Save accepted images as `docs/guides/help/assets/<id>.<en|zh>.jpg` and record
   `id`, `file`, `route`, `locale`, `role`, UTC `capturedAt`, `viewport` and
   SHA-256 in [captures.json](../guides/help/captures.json). Use explicit
   permission combinations such as `HEAD_TRANSLATOR` when the screen requires
   them. Replace any private capability in the recorded route with `[private-link]`.
6. A crop may improve legibility. Retain the full original under ignored
   `outputs/`, record its hash and original viewport, and add the crop rectangle
   to the receipt. Record the resulting JPEG dimensions and hash too. Do not
   alter displayed text or manufacture a screen. Do not commit an original
   containing credentials; crop the sensitive area out of the accepted asset.
   `viewport` stores the accepted bitmap dimensions used for layout;
   `browserViewport` stores the original CSS viewport when a crop is used.
7. Update the common capture baseline and description. After reviewing the
   affected guides and images, record current owning-source fingerprints:

```sh
npx tsx scripts/check-help-captures.ts --record-sources --review-note="Refreshed and reviewed the affected real dev-server captures"
npm run help:export
npm run help:check
```

`--record-sources` records a review; it does not capture or update images. Never
use it merely to silence a stale-image failure. When a source change has no
visible or behavioral effect on a guide, the reviewer may retain that image and
record the reason in `--review-note`. Check the displayed route, permissions,
expected results and language before making that judgment.

## Freshness and delivery checks

`help:check` verifies generated Markdown, capture hashes, filenames, provenance,
visual coverage and reviewed owning-source fingerprints. CI's documentation
gate runs it. This detects declared source changes and accidental file drift;
text-source hashes normalize CRLF/LF so Windows and Linux compare the same content.
it cannot inspect an operator's live deployment or prove every future UI change
is declared in `sources`. Feature authors must update the coverage inventory.

Article text is filtered on the server before it reaches client-side search.
Direct article and screenshot requests check current account capabilities;
restricted images live outside `public/`. PDF handlers check staff authority
and the requested edition before rendering. Both routes send private/no-store
headers and a generic retryable response when assets are unavailable. PDFs
contain the reviewed screenshots and locally embedded fonts; no browser or
external font fetch runs during download.

Both PDF editions embed an OFL-licensed Noto Sans SC subset. When new Chinese
characters are added, refresh its subset from the pinned upstream source and
verify glyph coverage and rendered pages. See its
[font instructions](../../public/fonts/help/README.md).

[Contributor index](README.md) · [Catalogue](../guides/help/README.md)
