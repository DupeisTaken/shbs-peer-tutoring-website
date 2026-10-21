# Name fields and display wording

Current name-policy, display and compatibility behavior. For contributor wording and layout rules, see [name field conventions](../contributing/design.md#name-field-wording-and-layout); for staff configuration, see the [program guide](../guides/program-configuration.md).

## Field labels

| Field                    | Help text                                                                        | Validation                                                         |
| ------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| First Name               | Your given name, written with Latin letters.                                     | Latin letters, including accents; spaces, apostrophes and hyphens. |
| Last Name                | Your family name, written with Latin letters.                                    | Same character rule when supplied.                                 |
| Preferred Name           | The name you would like us to use instead of your first name. Use Latin letters. | Same character rule when supplied.                                 |
| Name in Another Language | Your name in another language or writing system, such as 张小明.                 | Unicode text; no Latin-only restriction.                           |

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

## Data and implementation boundaries

Existing full names and alternative-name values must be preserved. Do not infer given/family-name boundaries from the first space without review, or automatically turn historical alternate names into preferred names. The migration retains original labels in `legacyName`. Existing explicitly split tutor fields seed accounts only when their joined value matches the original label. Other records remain unsplit until edited. Unconfirmed legacy tutor splits cannot override their original label when settings change.

An unchanged unsplit legacy identity retains the original default First Name compatibility exception. It cannot satisfy a newly Required Last Name, Preferred Name or Name in Another Language: those fields must be supplied on subsequent profile edits. An unsplit legacy name cannot safely be divided into visible and hidden components, so hiding any Latin component excludes the unsplit label from active display.

An intake accepted before a configuration change is grandfathered through account redemption. Redemption preserves its stored source identity, including fields that became Hidden, rather than adopting posted replacement names. New intake submission and later profile edits enforce the current policy. Immutable application, history, signature and audit evidence retains its original values.

An existing component called `PreferredLatinName` only supplies a spelling suggestion for username generation. It is not the new Preferred Name field and must not become its storage mechanism.

Current labels are materialized for consistent active display across profiles and rosters. Historical submissions, signatures, raw evidence exports and audit snapshots are not refreshed. The settings preview uses synthetic example names. Account binding, relinking and detachment refresh both affected roster labels under their resulting role policies.

Account writers reserve the shared username namespace before locking an account and its linked roster rows. This boundary also covers nested profile writes, so a reviewed name-policy refresh cannot hold the namespace while waiting on a profile transaction that tries to acquire it in the reverse order. It serializes those account writes for database correctness; reads remain unchanged.
