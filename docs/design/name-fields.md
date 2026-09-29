# Name fields and display wording

Implemented behavior for [issue #205](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/205).

## Field labels

| Field | Help text | Validation |
| --- | --- | --- |
| First Name | Your given name, written with Latin letters. | Latin letters, including accents; spaces, apostrophes and hyphens. |
| Last Name | Your family name, written with Latin letters. | Same character rule when supplied. |
| Preferred Name | The name you would like us to use instead of your first name. Use Latin letters. | Same character rule when supplied. |
| Name in Another Language | Your name in another language or writing system, such as 张小明. | Unicode text; no Latin-only restriction. |

Use **Name in Another Language** instead of **Alternate Name in another Language**. “Alternate” adds length without explaining what to enter. “Another language or writing system” in the help text covers both a translated name and the same name written in another script.

Keep **First Name** and **Last Name** as the familiar labels the user requested. Their help text explains given and family names without assuming that every culture writes them in that order. Use **Preferred Name** for the name someone wants to be called; keep username suggestions separate.

Use **Latin letters**, rather than **English name**, **English letters** or **A–Z only**. Accented names such as José, Zoë and Chloé are valid. State the rule in help text; “Force Latin” describes an implementation setting rather than a useful instruction to a person completing the form.

Requirements remain separate from labels. Most signup forms follow the existing invitation form: First Name required, Last Name optional, both additional names optional. Other flows must preserve their own required-field rules until intentionally changed.

## Program settings

Section: **Names and Grades**

Introduction: **Choose how participant names appear across the program.**

| Setting | Help text |
| --- | --- |
| Use preferred names | Use a preferred name in place of the first name when one is provided. Keep the last name. |
| Show names in another language | Show the additional name alongside the main name when one is provided. |

Supporting text: **These settings change how names are shown. They do not remove saved names.**

“Use” makes the replacement behavior explicit. “Show” describes an additional name. Avoid a generic “Display Preferred Name” toggle whose effect on the first and last names is unclear.

### Display examples

Example: First Name **Xiaoming**, Last Name **Zhang**, Preferred Name **David**, Name in Another Language **张小明**.

| Use preferred names | Show names in another language | Main name | Appended name |
| --- | --- | --- | --- |
| Off | Off | Xiaoming Zhang | — |
| On | Off | David Zhang | — |
| Off | On | Xiaoming Zhang | 张小明 |
| On | On | David Zhang | 张小明 |

If Preferred Name is blank, use First Name. If Last Name is blank, show only the chosen given/preferred name. An empty additional name adds no separator. Keep the entered values when either setting is switched off.

Keeping the last name makes participants easier to distinguish in rosters. Its tradeoff is that a preferred name entered as a complete name could repeat the family name; the field help and display preview make its intended use visible.

## Errors and layout

- Required first name: **Enter your first name.**
- Invalid Latin field: **Use Latin letters, including accents such as é. Spaces, apostrophes and hyphens are allowed.**
- Keep errors next to the field and connect them with `aria-describedby`.
- Put First Name and Last Name beside each other when space permits; stack them on narrow screens.
- Put Preferred Name and Name in Another Language on separate full-width rows.
- Display Required/Optional beside the label using the existing requirement treatment.
- Keep controls at least 44 px tall on touch layouts. Preserve visible keyboard focus and support long translations.
- Place a live participant-name example below the two display switches.

## Data and implementation boundaries

Existing full names and alternative-name values must be preserved. Do not infer given/family-name boundaries from the first space without review, or automatically turn historical alternate names into preferred names. The migration retains original labels in `legacyName`. Existing explicitly split tutor fields seed accounts only when their joined value matches the original label. Other records remain unsplit until edited. Unconfirmed legacy tutor splits cannot override their original label when settings change.

An existing component called `PreferredLatinName` only supplies a spelling suggestion for username generation. It is not the new Preferred Name field and must not become its storage mechanism.

Current labels are materialized for consistent display across profiles, rosters and exports. Historical submissions, signatures and audit snapshots are not refreshed. The settings preview uses synthetic example names.
