# Name fields and display wording

Implemented behavior for [issue #205](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/205), with preferred-name defaults updated for [issue #261](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/261).

## Field labels

| Field                    | Help text                                                                        | Validation                                                         |
| ------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| First Name               | Your given name, written with Latin letters.                                     | Latin letters, including accents; spaces, apostrophes and hyphens. |
| Last Name                | Your family name, written with Latin letters.                                    | Same character rule when supplied.                                 |
| Preferred Name           | The name you would like us to use instead of your first name. Use Latin letters. | Same character rule when supplied.                                 |
| Name in Another Language | Your name in another language or writing system, such as 张小明.                 | Unicode text; no Latin-only restriction.                           |

Use **Name in Another Language** instead of **Alternate Name in another Language**. “Alternate” adds length without explaining what to enter. “Another language or writing system” in the help text covers both a translated name and the same name written in another script.

Keep **First Name** and **Last Name** as the familiar labels the user requested. Their help text explains given and family names without assuming that every culture writes them in that order. Use **Preferred Name** for the name someone wants to be called; keep username suggestions separate.

Use **Latin letters**, rather than **English name**, **English letters** or **A–Z only**. Accented names such as José, Zoë and Chloé are valid. State the rule in help text; “Force Latin” describes an implementation setting rather than a useful instruction to a person completing the form.

Requirements remain separate from labels. In **Program Settings → Account Settings**, Head can set each of the four fields to **Required**, **Optional** or **Hidden** independently for Student, Tutor, Crew, Viewer, Coordinator, Admin and Head. Admin requests Head review; Coordinator can inspect this configuration. Unconfigured programs retain First Name required and the other fields optional. All four fields may be optional or hidden.

New signup uses the intake type being registered. An existing shared profile uses the account's current role, even when the account also has tutoring, tutee or crew membership. Profile edits enforce the current configuration on the server. Fields remain unavailable while the policy loads; cached fields and drafts stay mounted on a failed refresh, but editing and saving wait for read recovery.

Hidden fields are omitted from participant signup and self-profile forms and do not contribute to active labels. Existing values are preserved. Authorized management profile editors still show those fields and their saved values; staff may explicitly correct them. Required/Optional markers remain translated and separate from field names; hidden participant fields have no marker.

## Program settings

Section: **Account Settings → Names and Grades**

Introduction: **Choose how participant names appear across the program.**

| Setting                        | Help text                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| Use preferred names            | Use a preferred name in place of the first name when one is provided. Keep the last name. |
| Show names in another language | Show the additional name alongside the main name when one is provided.                    |

Supporting text: **These settings change how names are shown. They do not remove saved names.**

**Use preferred names** defaults on for new or unconfigured programs; **Show names in
another language** defaults off. Upgrades enable untouched preferred-name defaults
and preserve audited administrator choices, including off. Head applies changes
in this section; Admin can request Head review, and Coordinators can inspect settings.

“Use” makes the replacement behavior explicit. “Show” describes an additional name. Avoid a generic “Display Preferred Name” toggle whose effect on the first and last names is unclear.

### Display examples

Example: First Name **Xiaoming**, Last Name **Zhang**, Preferred Name **David**, Name in Another Language **张小明**.

| Use preferred names | Show names in another language | Main name      | Appended name |
| ------------------- | ------------------------------ | -------------- | ------------- |
| Off                 | Off                            | Xiaoming Zhang | —             |
| On                  | Off                            | David Zhang    | —             |
| Off                 | On                             | Xiaoming Zhang | 张小明        |
| On                  | On                             | David Zhang    | 张小明        |

If Preferred Name is blank, use First Name. If Last Name is blank, show only the chosen given/preferred name. An empty additional name adds no separator. Keep the entered values when either setting is switched off.

A Hidden field is excluded before applying these display preferences. If no remaining field contributes a name, an account uses its reserved username. A nameless unlinked roster or pending intake uses a translated **Name not provided** presentation fallback; that wording is never stored as an original name. Policy changes reserve any needed account handles within the reviewed transaction, in pages of 100 rows, before refreshing live labels. Role changes also allocate a needed handle before applying the destination role. Ordinary reads do not allocate handles.

Keeping the last name makes participants easier to distinguish in rosters. Its tradeoff is that a preferred name entered as a complete name could repeat the family name; the field help and display preview make its intended use visible.

## Errors and layout

When every name field is Hidden, the self-profile shows a read-only explanation instead of an empty editor with Save/Cancel. Other profile, academic and account actions remain available under their own permissions. Public intake omits Latin-name guidance when no Latin name field is visible. A loading or failed policy read never substitutes default requirements; retained drafts remain blocked until current requirements are available.

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

An unchanged unsplit legacy identity retains the original default First Name compatibility exception. It cannot satisfy a newly Required Last Name, Preferred Name or Name in Another Language: those fields must be supplied on subsequent profile edits. An unsplit legacy name cannot safely be divided into visible and hidden components, so hiding any Latin component excludes the unsplit label from active display.

An intake accepted before a configuration change is grandfathered through account redemption. Redemption preserves its stored source identity, including fields that became Hidden, rather than adopting posted replacement names. New intake submission and later profile edits enforce the current policy. Immutable application, history, signature and audit evidence retains its original values.

An existing component called `PreferredLatinName` only supplies a spelling suggestion for username generation. It is not the new Preferred Name field and must not become its storage mechanism.

Current labels are materialized for consistent active display across profiles and rosters. Historical submissions, signatures, raw evidence exports and audit snapshots are not refreshed. The settings preview uses synthetic example names. Account binding, relinking and detachment refresh both affected roster labels under their resulting role policies.

Account writers reserve the shared username namespace before locking an account and its linked roster rows. This boundary also covers nested profile writes, so a reviewed name-policy refresh cannot hold the namespace while waiting on a profile transaction that tries to acquire it in the reverse order. It serializes those account writes for database correctness; reads remain unchanged.
