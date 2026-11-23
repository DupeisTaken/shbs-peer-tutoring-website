# Maintain the visual help catalogue

The maintained article records live in
[`src/lib/help`](../../src/lib/help). Participant and management records share
one [schema](../../src/lib/help/types.ts). The website, GitHub Markdown editions
and downloadable PDF handbooks consume those same records. Keep task-specific
directions, prerequisites, outcomes and troubleshooting together. Each article's
`sources` and `covers` fields make functional coverage reviewable.

## Add or update a guide

1. Inspect the actual source and current UI, including the existing role and
   approval checks. The catalogue describes those checks without changing them.
2. Update both English and Chinese records using the website's participant names
   and exact visible controls (aligned with [writing UI copy](design.md#writing-ui-copy)).
   Prefer a verb-led task title. Link related guides by slug; unavailable related
   guides are filtered on the server. Set `category` when the task differs from
   its audience's default grouping, and set `requiresPrivateLink` for email-only
   workflows so readers use their own link.
3. Keep every step's screenshot ID (`<guide-slug>-step-<one-based-number>`, plus
   optional `-view-2`, `-view-3` supplements) and bilingual `focus` / `callouts`
   accurate.
4. Regenerate the Markdown exports and verify:

```sh
npm run help:export
npm run help:check
```

Complete the normal [required checks](verification.md#required-checks) for
behavior changes.

## Bake screenshots and PDFs in GitHub Actions (clean Git repo)

Raw screenshot JPEGs (`docs/guides/help/assets/`), derived annotated WebPs
(`docs/guides/help/assets/annotated/`), and `docs/guides/help/annotations.json`
are **gitignored** so the repository stays free of large binary blobs. Only the
text Markdown guides, `coverage.json`, `source-fingerprints.json`, and the
lightweight `captures.json` baseline live in Git.

To produce clean illustrated screenshots and all 20 PDF handbooks, trigger the
on-demand workflow [`.github/workflows/help-assets.yml`](../../.github/workflows/help-assets.yml)
(`workflow_dispatch`, zero automatic PR runner slots). The runner:

1. Boots a fresh Postgres 16 database, runs `npm run db:migrate`, and seeds
   synthetic demo data (`SHBS_DEMO_SEED=1 npm run db:seed`).
2. Builds and starts the production server (`npm run build && npx next start`),
   eliminating Next.js DevTools overlays and dev-only artifacts.
3. Runs [`scripts/capture-help-screenshots.ts`](../../scripts/capture-help-screenshots.ts)
   with headless Playwright Chromium and CSS scrollbar suppression across both
   English (`en`) and Chinese (`zh`) locales.
4. Crops around the active form, card or main region (`--crop-mode=focused`,
   recorded as `captureMode: "cropped"` with explicit `crop` bounds) or captures
   full viewports (`--crop-mode=full-viewport`).
5. Encodes every image through [`src/lib/help/image-budget.ts`](../../src/lib/help/image-budget.ts)
   using controllable size/quality parameters:
   - `HELP_IMAGE_MAX_KB` (default `110`) — soft per-image KB ceiling
   - `HELP_IMAGE_QUALITY` (default `85`) — primary JPEG quality (`50`–`98`)
   - `HELP_IMAGE_MIN_QUALITY` (default `74`) — lowest quality floor when stepping down outliers
   - `HELP_IMAGE_MAX_WIDTH` (default `1280`) — maximum output width in pixels
   - `HELP_IMAGE_CROP_PADDING_PX` (default `28`) — padding around focused element crops
6. Uploads two workflow artifacts:
   - **`help-handbooks-pdf-<run>`** — all 20 rendered Geist-styled PDF handbooks (`shbs-help-<audience>-<locale>.pdf`)
   - **`help-assets-bundle-<run>`** — `help-assets-baked.tar.gz` (`docs/guides/help/captures.json` + `docs/guides/help/assets/*.jpg`) plus its SHA-256 checksum (`help-assets-baked.tar.gz.sha256`).
7. When run on `main` with `publish_release: true` (default), publishes/updates
   the rolling GitHub Release tag **`help-assets-latest`** with the tarball,
   SHA-256 checksum, `captures.json`, and all 20 Geist PDF handbooks.
8. During container image builds (`.github/workflows/docker-build.yml`),
   [`scripts/unpack-help-assets.mjs`](../../scripts/unpack-help-assets.mjs)
   downloads `help-assets-baked.tar.gz` from `help-assets-latest`, verifies its
   SHA-256 checksum, inspects tar entries against an allowlist (rejecting
   symlinks and path traversal), extracts into `docs/guides/help/`, and checks
   every JPEG's SHA-256 before `docker build` runs. If `help-assets-latest` has
   not been published yet, the build falls back cleanly to text-only Help.

### Baking locally against a demo server

Use the [resource-safety and demo setup](local-development.md#worktree-and-resource-safety).
Never point the capture script at production or a destructive test database.
With a seeded local production or dev server running on `http://127.0.0.1:3027`:

```sh
npm run help:capture -- --base-url=http://127.0.0.1:3027
# Optional: also generate local annotated WebPs and all 20 PDFs
npm run help:capture -- --base-url=http://127.0.0.1:3027 --render-pdfs
npm run help:export
```

Pass `--crop-mode=full-viewport` for uncropped desktop frames, `--locales=en`
for English only, or override `HELP_IMAGE_MAX_KB` / `HELP_IMAGE_QUALITY` in the
environment.

## Capture receipts, crops, callouts and privacy

- **Route privacy:** Replace any private capability in recorded routes with
  `[private-link]`. Publish only canonical page paths, approved Student/Localization
  `view` values, positive Help gallery `view` numbers, and known static anchors.
  API routes and private query parameters are rejected by
  [`capture-route.ts`](../../src/lib/help/capture-route.ts).
- **Capture modes:** Step receipts record `viewport`, `browserViewport`, and
  `captureMode` (`"viewport"`, `"full-page"`, or `"cropped"`). Reviewed cropped
  frames must set `captureMode: "cropped"` with valid `crop` bounds inside
  `browserViewport`; accidental unreviewed crops on `"viewport"` or `"full-page"`
  captures are still rejected by [`help-capture-validation.ts`](../../scripts/help-capture-validation.ts).
- **Step bindings:** Each baked frame binds to its guide slug, one-based step,
  bilingual title, and `directionsSha256(step.body)`.
- **Callouts:** Normalized `bounds` (`0`–`1`) identify targets on the frame.
  Website overlays ([`annotated-screenshot.tsx`](../../src/app/help/annotated-screenshot.tsx)),
  PDF vectors ([`pdf.ts`](../../src/server/help/pdf.ts)) and GitHub WebP exports
  ([`annotation-assets.ts`](../../src/app/help/annotation-assets.ts)) share one
  layout solver ([`screenshot-annotations.ts`](../../src/app/help/screenshot-annotations.ts))
  with slate-900 label pills, indigo-600 outlines/badges, and translucent target tints.
  Frames narrower than 600 px omit inline pills and render a numbered legend.

## PDF typography, rendering and runtime delivery

- **Fonts:** [`src/server/help/pdf.ts`](../../src/server/help/pdf.ts) embeds the
  website's **Geist** TrueType stack (`Geist-Regular`, `Geist-Medium`,
  `Geist-SemiBold`, `Geist-Bold`, `GeistMono-Regular` from the installed `geist`
  package, traced in [`next.config.js`](../../next.config.js)) for Latin text,
  headings, routes and numbers, and switches automatically to the OFL-licensed
  `public/fonts/help/noto-sans-sc.otf` subset for Chinese spans. See
  [font instructions](../../public/fonts/help/README.md) when adding new Chinese
  characters.
- **Layout:** Clean Swiss-editorial hierarchy aligned with
  [design conventions](design.md): crisp white canvas, top indigo accent rule,
  hairline-separated metadata and TOC, minimal left-accent bars for **Look for**,
  **What you should see**, and **If something goes wrong**, and rounded-framed
  screenshots (tall full-page frames scale vertically rather than collapsing to
  small thumbnails). When running locally without baked screenshots, `/help/[slug]`
  and PDF downloads render clean text guides gracefully.
- **Access & concurrency:** Article text is filtered on the server before
  client-side search; `/api/help/images/[id]` and `/api/help/pdf/[audience]`
  recheck live account authority on every request, send `private, no-store`
  headers, and bound concurrent PDF renders with a 2-slot in-process guard
  (returning retryable `503` with `Retry-After: 5` under burst load).
- **Docker packaging:** `.dockerignore` excludes only
  `docs/guides/help/assets/annotated/` (GitHub-only WebP derivatives) while
  allowing CI-baked `docs/guides/help/assets/*.jpg`, `captures.json`, and all
  PDF fonts into container builds when unpacked before `docker build`.

## Freshness and regression checks

- `npm run help:check` (run as part of `npm run docs:check` in CI): verifies
  Markdown exports match `src/lib/help`, validates `captures.json` metadata,
  verifies all 5 Geist TTF files exist, verifies `noto-sans-sc.otf` covers every
  character in the bilingual corpus ([`help-font-corpus.ts`](../../scripts/help-font-corpus.ts)),
  and validates every baked JPEG's SHA-256, dimensions, bindings and callouts
  whenever screenshots are present (pass `--require-captures` to enforce
  baked binaries).
- Source-file fingerprint drift is reported as an advisory during `help:check`
  so unrelated PRs are not blocked; run `npm run help:check-sources` to enforce
  zero drift during a Help refresh, and record reviewed fingerprints with:

```sh
npx tsx scripts/check-help-captures.ts --record-sources --review-note="Reviewed affected guides"
```

Bounded regression checks need no database or browser:

```sh
npx vitest run src/lib/help src/app/help src/server/help src/app/api/help --maxWorkers=1
npm run docs:check
npm run test:deployment
npm run test:ci
python -B scripts/test_help_font.py
```

[Contributor index](README.md) · [Catalogue](../guides/help/README.md)
