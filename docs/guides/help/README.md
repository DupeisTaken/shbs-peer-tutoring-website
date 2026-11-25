# Help Center catalogue

Open `/help` on the running website (via the top-bar **Help Center** button on
any page or the landing-page footer) for searchable, bilingual walkthroughs and
offline PDF handbooks. `/p/faq` redirects there. Signing in adds the collections
available to the current account and shows your signed-in workspace header. Each
guide has prerequisites, numbered directions, a result to check, an explanation
and brief troubleshooting.

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

Everyone can download PDF handbooks directly from **Help Center** (`/help#handbooks`)
for every collection their current session or account is authorized to read
(visitors can download the public **Get started** handbook). Staff can also open
**Management → Administration → PDF handbooks** at `/admin/help` to distribute
participant training editions without having those memberships themselves; the
Admin and Head editions still require their corresponding authority. Downloads
render on demand using the website's **Geist** typography (with an embedded Noto
Sans SC subset for Chinese text), stamp the download date and time into both the
PDF and filename, and are served with `private, no-store` headers.

## CI-baked screenshots (clean Git repository)

Screenshot JPEGs and derived annotated WebPs are **not committed to Git**.
Instead, [Bake Help Screenshots & PDF Handbooks](../../../.github/workflows/help-assets.yml)
builds and captures clean cropped EN/ZH screenshots against a fresh seeded demo
database and publishes `help-assets-baked.tar.gz` plus all 20 PDF handbooks to
the rolling `help-assets-latest` GitHub Release. Container builds in
[Build and publish image](../../../.github/workflows/docker-build.yml)
automatically verify and unpack that release before `docker build` so deployed
sites serve illustrated Help pages and PDFs while Git stays free of binary blobs.

To pull the latest CI-baked screenshots into a local checkout, run `npm run help:unpack`.
See the [maintenance and capture procedure](../../contributing/help-catalogue.md)
for local capture commands (`npm run help:capture`), image budgets, manifests
([`captures.json`](captures.json), [`coverage.json`](coverage.json),
[`source-fingerprints.json`](source-fingerprints.json)), and how to regenerate
these generated Markdown copies after editing `src/lib/help/`.

[User guide](../user-guide.md) · [Guide index](../README.md)
