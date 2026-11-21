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
3. Capture the actual visible state for **every numbered step**, including opened
   tabs, dialogs, filled forms and result states. Each frame has the stable ID
   `<guide-slug>-step-<one-based-number>`. A feature overview cannot stand in for
   a later action. Name the relevant control in `focus` and add reviewed bilingual
   in-image callouts while keeping the original pixels unchanged.
   If a long form or scrolled panel needs more context, add full frames named
   `<guide-slug>-step-<number>-view-2`, then `-view-3`, without gaps. The catalogue
   collects English receipts into `supplementaryScreenshots`; each additional
   view must repeat the same exact step binding and have its own state, labels,
   review and source. Step-level callout overrides apply only to the primary frame.
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
   Leave SMTP unset for ordinary captures. For email-dependent workflows, use an
   authenticated, STARTTLS-enabled loopback-only mail sink with no outbound relay.
   Scope its sender credentials and test CA to the capture process; never disable
   certificate validation or use production mail settings. Record actual local
   delivery separately from screenshots. Never include passwords, mailbox codes,
   invitation keys, capability links or real records.
3. Start the actual server, for example
   `npm run dev -- --hostname 127.0.0.1 --port 3017`. Use the in-app browser
   for manual capture, or a task-owned browser tab when that surface is unavailable.
   This set uses the in-app browser and a scoped Edge fallback, controlled through
   the documented CUA browser API. Record the actual method and viewport, choose English or Chinese,
   and sign in to the appropriate synthetic account. Earlier overview images use
   1440 × 1000; newer step frames record their own desktop or phone dimensions.
   Capture an English frame for each step; Chinese frames may supplement it.
   The Chinese edition explicitly identifies an English fallback when necessary.
4. Use [coverage.json](../guides/help/coverage.json) to find the target guide,
   its screenshot IDs and route. Follow the steps to the relevant tab/dialog.
   Wait for the state the step teaches. Reject unintended loading, denial, errors
   and blank frames. For a troubleshooting capture, verify the actual failure
   and its recovery in the owned demo. Record any controlled transport fault
   alongside the corresponding real save and read results.
   For a native date or time field, confirm the value persisted before capturing
   a filled form. If direct fill leaves it blank, enter the value through the
   field's keyboard controls and check the resulting date or review summary.
   Inspect the exact saved JPEG before accepting it. Use a full viewport frame,
   or an actual `fullPage` browser screenshot for the entire document. Record
   `captureMode` as `viewport` or `full-page`; full-page height may exceed the
   visible browser viewport. Capture mobile states of
   changed Help pages at 390 × 844 as verification evidence.
   Prefer the plain viewport camera without a clip for a viewport frame. A clip
   can make the capture provider temporarily reflow scrollbars. Measure visible
   target rectangles before and after capture, check the same scroll origin and
   viewport, map them through any uniform bitmap scaling, and inspect the exact
   saved pixels. Stable DOM readings alone do not prove camera alignment.
5. Save accepted images as `docs/guides/help/assets/<id>.<en|zh>.jpg` and record
   `id`, `file`, `route`, `locale`, `role`, UTC `capturedAt`, bitmap `viewport`,
   CSS `browserViewport`, `captureMode` and SHA-256 in
   [captures.json](../guides/help/captures.json). Use explicit
   permission combinations such as `HEAD_TRANSLATOR` when the screen requires
   them. Replace any private capability in the recorded route with `[private-link]`.
   Publish only a canonical page path, approved Student/Localization `view` value,
   positive Help screenshot gallery `view` number and known static anchor. API
   routes are never valid provenance labels, including private calendar feeds.
   Remove private query parameters entirely, including
   their keys; a redacted token query is still rejected. Report capabilities use
   exactly `/reports/service-hours/[private-link]`. Encoded keys/paths, unknown
   queries and credential fragments are rejected before metadata reaches the
   website, APIs, GitHub exports or offline report, including during authoring.
6. Bound step frames must retain their full context, with **no presentation crop**.
   Recreate a safe synthetic state before capture if secrets are visible, rather
   than altering pixels. Historical overview crops may remain as supplemental
   evidence but cannot satisfy step coverage. The checker compares JPEG headers
   with bitmap dimensions and permits taller full-page frames.
7. Add bilingual `state`, per-image `sourceRevision` and `sourceLabel`. Preserve
   older frames' original revisions in a mixed capture set. Record `stepBinding`
   with the exact guide slug, one-based step, both title strings and
   `directionsSha256(step.body)` from
   [the shared validator](../../scripts/help-capture-validation.ts): SHA-256 of
   `JSON.stringify({en: body.en, zh: body.zh})`. Reordering a step or changing its
   title/directions invalidates its binding until reviewed again.
8. Add `callouts` with bilingual `label` and normalized `bounds`: `x`, `y`, `width`
   and `height` as fractions of the full bitmap. Measure actual visible targets;
   do not guess from an action name. Convert DOM document coordinates to bitmap
   coordinates before normalizing; full-page frames require scroll offsets and
   the full document height. Optional `labelPosition` places a label in a reviewed
   safe area. Matching target numbers and leaders identify displaced labels.
   `boundsByLocale` follows the image locale; label text follows the guide locale.
   Step-level callouts override the receipt, so an empty override cannot satisfy
   the in-image label requirement.
   On a form, identify the relevant fields or choices and the actual save/submit
   control, usually with two to four focused labels. A single box around the
   entire form supplies context but does not explain the action. A single clear
   outline can suit a read-only evidence table or result message.
   Pixel measurements on the exact saved bitmap are also valid: record the raw
   image hash, measured rectangles and review method. Preserve the original
   before/after DOM-geometry receipt; do not rewrite it to pretend later
   pixel-reviewed targets were measured in the live page.
   For source frames narrower than 600 pixels, all renderers show target outlines
   and matching number badges without text pills or leaders, preserving visible
   controls. The readable bilingual numbered legend remains below every image.
9. Record `review: {acceptedAt, method}` after inspecting the saved frame and its
   targets; the review timestamp must follow capture. Preview both language
   overlays before acceptance. Keep labels, numbers and leaders clear of every
   visible control and text line, including unannotated neighbors. Check the
   complete label box rather than assuming a short phrase fits a narrow gutter.
   Give text-only outlines enough outward padding to preserve their edge glyphs.
   Keep raw JPEGs immutable.
   Website/PDF overlays and generated lossless WebP training images explicitly
   add annotations
   without replacing or rewriting the original evidence.
10. Update the common baseline and regenerate the font subset when its corpus gains
    characters. After reviewing the
    affected guides and images, record current owning-source fingerprints:

```sh
npx tsx scripts/check-help-captures.ts --record-sources --review-note="Refreshed and reviewed the affected real dev-server captures"
npm run help:export
npm run help:check
```

`--record-sources` records a review; it does not capture or update images. Never
use it merely to silence a stale-image failure. When a source change has no
visible or behavioral effect on a guide, the reviewer may retain that image and
record the reason in `--review-note`. Recheck the binding, route, permissions,
results and language before that judgment. Fingerprint recording happens only
after complete step coverage, bitmap/provenance, callout and font checks pass.

For a first-use walkthrough, such as issuing the first school report, prepare a
separate owned synthetic database and seed only through its prerequisites.
Verify the actual starting state before opening the workflow. If the preview
reuses a local port, record the listener's ownership and open a fresh browser
tab for that phase. Give each image a phase-specific `sourceLabel` and describe
the visible draft, pending or saved result in its caption. Keep private links and
credentials out of the saved frames and published receipts.

During capture work, `npx tsx scripts/check-help-captures.ts --allow-pending-step-captures`
reports incomplete coverage while fully validating supplied step frames. Other
checks still apply, so font/source drift may still fail this authoring command.
It is not a release gate and cannot be combined with `--record-sources`. Default
`npm run help:check` and CI require every numbered step; do not add the authoring
flag to either command.

## Freshness and delivery checks

`help:check` verifies generated Markdown/WebP recipes, immutable capture hashes,
JPEG dimensions, filenames, exact step/title/directions bindings, full-frame mode,
per-image source/state, recorded review, in-image labels and source fingerprints.
Every declared supplemental view receives those same checks; IDs must be ordered
and contiguous within their step. Native vertical scrollbars may account for up
to 20 CSS pixels omitted from a viewport bitmap. Uniform bitmap scaling permits
pixel rounding, without a percentage-based allowance for a wider crop.
CI's documentation
gate runs it. This detects declared source changes and accidental file drift;
text-source hashes normalize CRLF/LF so Windows and Linux compare the same content.
It cannot inspect an operator's live deployment or prove every future UI change
is declared in `sources`. Feature authors must update the coverage inventory.

Article text is filtered on the server before it reaches client-side search.
Direct article and screenshot requests check current account capabilities;
restricted images live outside `public/`. PDF handlers check staff authority
and the requested edition before rendering. Both routes send private/no-store
headers and a generic retryable response when assets are unavailable. PDFs
contain the reviewed screenshots and locally embedded fonts; no browser or
external font fetch runs during download.
The PDF layout measures each first screenshot with its step directions and the
complete caption. It keeps them together when they fit on one page and identifies
continued views by step number. When reviewing rendered editions, inspect page
breaks around supplemental images and check that each numbered legend is complete.
All website, GitHub and PDF walkthroughs render every declared view. The full-size
viewer selects a view only from its authorized guide step, for example
`/help/<slug>/screenshots/2?view=2`, and keeps the unchanged raw image separate.
Generated `annotations.json` binds each derivative to its guide, step, view,
screenshot ID, original hash and annotation recipe/hash. Version 2 records also
bind the WebP encoding options, production PNG recipe/byte hash and the equal
decoded PNG/WebP RGBA pixel hashes. Export first composites the unchanged raw JPEG
and shared SVG into the production PNG, then encodes WebP with `lossless: true`,
`nearLossless: false` and `exact: true`. Every newly encoded image must have exactly
equal decoded sRGB/ensure-alpha RGBA buffers before it is accepted. Processing is
serial with Sharp concurrency 1, caching disabled for encoding/verification and
a 16-million-pixel limit. Reused images must match their encoded byte hash,
current format recipe and decoded PNG pixel proof; checks do not require native
PNG re-encoding to produce identical bytes across platforms. Old PNG-only
manifests fail freshness checks and require `npm run help:export`; original JPEGs
and existing PNG proofs are preserved. A previous PNG visual review transfers
only when the WebP's decoded pixels are proven identical, not because encoded
file bytes or filenames match. The website, PDF and local PNG preview renderers
keep their existing formats.

The Docker context excludes only `docs/guides/help/assets/annotated/`: these WebPs
and retained PNG proofs serve the GitHub Markdown copy. Website and PDF rendering
use the reviewed raw JPEGs plus shared vector annotations, so raw captures, their manifest and the PDF
font remain build/runtime inputs. CI checks generated Markdown and WebP recipes
from the full checkout before building the image. Changing this context exclusion
requires deployment checks and the existing image-storage comparison; it does
not alter the separate public-QR tracing behavior.

Both PDF editions embed an OFL-licensed Noto Sans SC subset. When new Chinese
characters are added, refresh its subset from the pinned upstream source and
verify glyph coverage and rendered pages. See its
[font instructions](../../public/fonts/help/README.md).
Generation and checking share the decoded runtime corpus from
[`help-font-corpus.ts`](../../scripts/help-font-corpus.ts): both article languages,
audience titles, complete capture metadata/callouts, annotation notices and fixed
PDF labels. Escaped Unicode in JSON still contributes its actual glyphs.

Bounded regression checks need no database or browser:

```sh
npx vitest run src/lib/help/capture-validation.test.ts --maxWorkers=1
npx vitest run src/lib/help/capture-route.test.ts --maxWorkers=1
npx vitest run src/app/help/step-screenshot-gallery.test.tsx src/app/help/screenshots-page.test.tsx --maxWorkers=1
python scripts/test_help_font.py
```

[Contributor index](README.md) · [Catalogue](../guides/help/README.md)
