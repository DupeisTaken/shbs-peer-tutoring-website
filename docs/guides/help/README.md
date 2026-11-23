# Help & How-to catalogue

Open `/help` on the running website for searchable, bilingual walkthroughs.
The Information menu and account menu link to it; `/p/faq` redirects there.
Signing in adds the collections available to the current account. Each guide
has prerequisites, numbered directions, a result to check, an explanation and
brief troubleshooting.

## GitHub training editions

These Markdown copies are generated from the same bilingual content as the
website and PDF handbooks. They include all roles for training; reading a guide
does not grant permission to use its website features. The website enforces
access on articles, image routes and PDF downloads.

| Collection | English | 中文 |
| --- | --- | --- |
| Get started | [English](public.en.md) | [中文](public.zh.md) |
| Your account | [English](account.en.md) | [中文](account.zh.md) |
| Get tutoring | [English](student.en.md) | [中文](student.zh.md) |
| Tutor workspace | [English](tutor.en.md) | [中文](tutor.zh.md) |
| Crew and patrols | [English](crew.en.md) | [中文](crew.zh.md) |
| Observe the program | [English](observer.en.md) | [中文](observer.zh.md) |
| Manage the program | [English](staff.en.md) | [中文](staff.zh.md) |
| Review and administer | [English](admin.en.md) | [中文](admin.zh.md) |
| Head responsibilities | [English](head.en.md) | [中文](head.zh.md) |
| Translate the website | [English](translator.en.md) | [中文](translator.zh.md) |

## PDF handbooks

Staff open **Management → PDF handbooks** at `/admin/help` and choose English
or Chinese for a collection. Downloads render on demand using the website's
**Geist** typography (with an embedded Noto Sans SC subset for Chinese text).
Staff can distribute participant training editions without having those
memberships themselves; the Admin and Head editions require their corresponding
authority. Downloads are private and are not cached publicly.

## CI-baked screenshots (clean Git repository)

Screenshot JPEGs and derived annotated WebPs are **not committed to Git**.
Instead, the on-demand GitHub Actions workflow
[Bake Help Screenshots & PDF Handbooks](../../../.github/workflows/help-assets.yml)
boots a production `next start` build against a fresh seeded Postgres 16 demo
database, captures clean cropped English and Chinese screenshots with zero
DevTools overlays or scrollbars, enforces the controllable per-image size budget
(`HELP_IMAGE_MAX_KB`, `HELP_IMAGE_QUALITY`, `HELP_IMAGE_MAX_WIDTH`), uploads
the rendered artifacts, and (on `main`) updates the rolling GitHub Release tag
`help-assets-latest` with `help-assets-baked.tar.gz`, its SHA-256 checksum, and
all 20 Geist PDF handbooks. Container builds in
[Build and publish image](../../../.github/workflows/docker-build.yml)
automatically verify and unpack `help-assets-latest` before building the runtime
image so `/help` and `/admin/help` serve illustrated screenshots and PDFs in
deployment with zero binary blobs in Git.

To bake screenshots locally against a running demo server, run:

```sh
npm run help:capture -- --base-url=http://127.0.0.1:3027
```

[Capture manifest](captures.json) records the baseline and (when baked in CI or
locally) each image's route, role, locale, crop bounds, dimensions and SHA-256.
[Feature coverage](coverage.json) maps every guide to its named actions and
source files. [Reviewed source fingerprints](source-fingerprints.json) detect
when owning source files change.

Do not edit the generated language files. Follow the
[maintenance and capture procedure](../../contributing/help-catalogue.md) to
update content and regenerate these copies.

[User guide](../user-guide.md) · [Guide index](../README.md)
