# Reviewed scheduling comparison inputs

Each pull request selects an immutable source control and a reviewed migration manifest. PR #569 binds 112 historical migrations plus two scheduling additions. PR #568 has ten additions with identity, and PR #570 has twenty with identity and recovery. Unrelated pull requests use their own base unless a scoped manifest or explicit manual selection applies.

PR #604 uses the immediate pre-feature main commit
`fd93b1d0b45d9ea196c39c0f2791c1371f6eaeb6` as its scoped control. Its manifest
pins the complete existing migration chain and the retained legacy signup decline
schema/migration. That addition creates decision evidence, journals its changes and
extends the closed-roster trigger with an exact-source decline fence. Existing
scheduling scenarios compare the baseline application under this candidate schema;
the new decline workflow has separate candidate regression evidence and makes no
baseline parity or speedup claim. The comparison policy remains unchanged.

PR #606 uses its integrated pre-feature main commit
`64d55753608e064205fc5788e08687fe99dc5c9a` as both scheduling controls.
This advances the earlier `dfe9be18` pin for upstream account-menu wording,
neutral Edited-badge styling and documentation updates. Scheduling sources,
harness, schema and dependency bytes are unchanged between those baselines.
Its manifest binds all 133 historical migrations and the four tutoring-policy
additions (`20261108010000`, `20261108011000`, `20261108012000`,
`20261108013000`), both complete schema hashes and the unchanged dependency lock.
Those additions introduce explicit legacy-safe notice/pause effects, independent
participant suppression, safe recovery evidence, semantic policy history and its
integrity guards, plus the exact-offer notice lookup index. SQL namespace and
trigger behavior are part of the pinned bytes.

The shared-schema control runs unchanged baseline application sources under this
exact candidate schema. The fixture generator, workload populations, capture
projections and parity/latency criteria are unchanged. The ordinary scheduling
fixtures do not activate tutoring pauses; pause/affirmative-exception behavior has
separate candidate regression evidence. This manifest authorizes only the input
overlay, not a parity result or baseline support for new policy behavior. The
native-schema control remains required, and any additional domain evidence or
procedure-result difference remains subject to the existing comparison rules.
Missing or changed bytes, an unlisted migration or a changed dependency lock still
fail closed. No general or other-PR baseline selection is changed.

PR #639 uses its pre-change main commit
`dfe9be18a0a6efb68aa6b956252002bdee24f184` as its scoped control. Its manifest
pins both schema versions, the unchanged dependency lock, all 133 historical
migrations and the single `20261108010000_imported_record_provenance` addition.
That migration adds server-owned archive provenance and its recovery journal
trigger; it does not reclassify existing records. The baseline application runs
under the candidate schema for the existing scheduling scenarios, with the
separate native-schema cold control retained. New archive-import, reporting and
admission behavior has separate candidate regression coverage and establishes no
baseline support, semantic parity or speedup claim for those new paths. This
PR-scoped selection changes no comparison or harness guard.

The primary control is `223a1b213a7a5167187b057d08a349d30f0087ad`, the original `c113b8efbbfe0c350dc8c0d09aec92c48777d9c6` with newly captured proposal rosters sorted. The catalog-only control is its child `c3947f096a1cf1eb33c02948d0385d46d6838d77`. It adds the ordered room-release helper and its caller. Both catalog arms use the reviewed shared-schema migration that orders sibling invalidations. The original failed measurements remain separately identified.

Each `pr-N-baseline.txt` and `pr-N-catalog-baseline.txt` contains a full SHA followed by LF. Combined PR #570 compares shared captures with the complete identity and recovery projections. Its original-schema cold control captures only the fixed historical projection. Controlled contention diagnostics retain both complete ordered histories. Uncontrolled rounds preserve their independent observed fence order and raw audit chronology.

The first eight reviewed additions implement maintenance metadata, directory partition,
private-history correction, participation transfer, typed identity journaling,
identity scheduling invalidation, exact notification provenance, and the narrowed
student metadata guard. Ten further additions implement scoped compensation,
prospective checkpoints, delivery effects and shared causal roots, workflow drafts,
notification provenance, immutable cancellation, continuation composition,
monotonic history authority and exact late transport acceptance. Historical SQL
and dependency bytes remain unchanged. A nineteenth migration (`20261103060000`)
updates the room booking and blackout guards so only real same-term successors
release a retained source booking. It changes neither the Prisma schema nor the
first eighteen additions.
The twentieth migration (`20261103031000`) keeps the sibling version increments and orders their journal writes.
Hashes use immutable Git blob bytes, matching Linux CI rather than Windows newline
conversion. The comparison helper checks the complete
manifest against those immutable Git blob exports, including the historical
`0_init` migration. This validates the measurement inputs, not workload parity.

This manifest authorizes a controlled measurement setup; it does not establish
feature correctness or passing latency results. The baseline application runs under
the candidate schema, with a separately labelled native-schema cold control. New
identity/recovery-only scenarios require separate candidate evidence. Added domain
evidence remains a real difference when the baseline cannot produce it; it must
not be omitted or relabelled as matching to obtain a passing comparison. The harness must retain
all semantic comparisons and disclose cross-partition variation.

Update these inputs only after reviewing every additional migration and schema
change. Missing, changed or unlisted inputs fail comparison. Manual workflow inputs
take precedence; a baseline override requires an explicit selected manifest.

PR #665 uses its immutable P1 predecessor `1da951512196e4e37ac04f9b55bdb68e1eae977e` as its scoped scheduling control. The reviewed manifest pins all 138 historical SQL migrations unchanged, both full schema versions, the unchanged dependency lock and exactly the historical-invitation operation-closure and translation-intent receipt additions (140 total). These ledgers provide terminal operation evidence and positive operator retention controls; translation application controls remain a later review group. Existing scheduling scenarios run unchanged baseline application sources under the exact candidate schema, with the separately labelled native-schema control retained. This authorizes only the reviewed input overlay: it establishes no baseline support, workload parity or timing result for the new invitation/translation paths. Missing, changed or unlisted SQL, schema or lock bytes fail closed; no other PR selection or harness policy changes.

PR #668 uses its immutable P3 predecessor `6e63fe6cb9f32742ac2138dfc5123dd0b78bd8ca` as its scoped scheduling control. Both sides retain all 140 SQL migrations byte-for-byte, with no added migration and an unchanged dependency lock. The only schema-byte delta is the reviewed excusedAt ownership comment; this manifest pins the complete before/after Git schema blobs rather than ignoring that difference. The reviewed shared-schema input mode and separate native-schema control remain required by the existing helper. This input selection establishes no behavioral parity, feature correctness or timing result. Missing or changed historical SQL, an unlisted addition or a changed lock fails closed; no other PR selection or comparison guard changes.
