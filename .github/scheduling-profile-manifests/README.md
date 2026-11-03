# Reviewed scheduling comparison inputs

`baseline.txt` selects immutable baseline
`c113b8efbbfe0c350dc8c0d09aec92c48777d9c6`. `current.json` binds its schema,
dependency lockfile and all 112 historical SQL migrations to the combined
scheduling, identity and recovery schema at
`1301ae4a4951994bcab43c7a5f24edf9bd9d6f22`.

The first eight reviewed additions implement maintenance metadata, directory partition,
private-history correction, participation transfer, typed identity journaling,
identity scheduling invalidation, exact notification provenance, and the narrowed
student metadata guard. Ten further additions implement scoped compensation,
prospective checkpoints, delivery effects and shared causal roots, workflow drafts,
notification provenance, immutable cancellation, continuation composition,
monotonic history authority and exact late transport acceptance. Historical SQL
and dependency bytes remain unchanged.
Hashes use immutable Git blob bytes, matching Linux CI rather than Windows newline
conversion. The comparison helper at `1beb7ea6` accepted the complete
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
