# Technical reference

These documents describe implemented behavior, code ownership, contracts and
compatibility boundaries. They do not approve proposed designs. Contributor
principles and future design work belong in [contributing](../contributing/README.md);
user tasks and operational procedures belong in [guides](../guides/README.md).

| Subject                                                            | Reference                                                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Architecture, authorization, transactions and feature contracts    | [Technical report](technical-report.md#architecture)                                                                   |
| Shared UI responsibilities and extension boundaries                | [Shared patterns](technical-report.md#shared-ui-patterns) and [ownership](technical-report.md#ui-extension-boundaries) |
| Name-policy fields, display, legacy data and identity boundaries   | [Name fields](name-fields.md)                                                                                          |
| Notification triggers, recipients, bilingual copy and destinations | [Notification inventory](notification-events.md)                                                                       |
| Public signup rate limits, recovery and trusted proxy boundary     | [Signup protection](signup-protection.md)                                                                              |
| Optional CAPTCHA integration and rollout requirements              | [CAPTCHA](captcha.md)                                                                                                  |

Inspect current source and tests before changing a contract. Historical reports
are available through [Git history](../contributing/documentation.md#historical-evidence-and-continuation-notes)
and do not establish behavior at the current revision.

[Documentation home](../README.md).
