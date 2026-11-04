# Reviewed scheduling comparison inputs

Each pull request selects an immutable source control and a reviewed migration manifest. PR #569 binds 112 historical migrations plus two scheduling additions. PR #568 has ten additions with identity, and PR #570 has twenty with identity and recovery. Unrelated pull requests use their own base unless a scoped manifest or explicit manual selection applies.

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
