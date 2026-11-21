# Help & how-to catalogue

Open `/help` on the running website for searchable, illustrated walkthroughs.
The Information menu and account menu link to it; `/p/faq` redirects there.
Signing in adds the collections available to the current account. Each guide
has prerequisites, numbered directions, a result to check, an explanation and
brief troubleshooting. Callouts help locate controls or recognize results when
the screen needs visual guidance.
Long forms and separate review/result states have additional full-screen views.
Select a screenshot to enlarge it. Number-only markers have a readable key.
Open Capture details for the original image, date, route and source revision.

## GitHub training editions

These copies are generated from the same bilingual content as the website and
PDF handbooks. They include all roles for training; reading a guide does not
grant permission to use its website features. Screenshots contain synthetic
people and records. The website enforces access on articles and image routes.

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
or Chinese for a collection. A download is generated from the current content
and capture files. Staff can distribute participant training editions without
having those memberships themselves; the Admin and Head editions require their
corresponding authority. Downloads are private and are not cached publicly.

## Screenshot provenance

The [capture manifest](captures.json) names the latest `main` development
baseline selected for the newest captures. Each image records its own source
revision and date. Refresh screens affected by a source change and document
the review before retaining earlier captures. The maintenance procedure
describes that review and the source-fingerprint check.

Images come from the local Next.js dev server at `http://127.0.0.1:3017`
running the Help candidate with isolated synthetic demo data. The recorded
revisions identify the development builds used for capture.

[Capture receipts](captures.json) record each image's route, role, language,
time, full viewport, file hash, exact step binding, labels and review. Bound
step screenshots are never presentation crops. A private school-report capability is
represented by `[private-link]`; its credential is never saved in this manual.
English and Chinese captures are selected where available. A Chinese guide
labels an English image explicitly when that screen has no Chinese capture.

[Feature coverage](coverage.json) maps every guide to its named actions,
source files and screenshots. [Reviewed source fingerprints](source-fingerprints.json)
detect when those source files change and the guides/screenshots need review.

Do not edit the generated language files. Follow the
[maintenance and capture procedure](../../contributing/help-catalogue.md) to
update the content, refresh affected screenshots and regenerate these copies.

[User guide](../user-guide.md) · [Guide index](../README.md)
