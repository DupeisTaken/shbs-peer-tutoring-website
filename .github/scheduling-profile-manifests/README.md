# Reviewed scheduling comparison inputs

`baseline.txt` selects immutable baseline
`c113b8efbbfe0c350dc8c0d09aec92c48777d9c6`. `current.json` binds its schema,
dependency lockfile and all 112 historical SQL migrations to the scheduling and
identity schema at `d56d0344e1ded9d04917cc7507dfe80f88aa4220`.

The eight reviewed additions implement maintenance metadata, directory partition,
private-history correction, participation transfer, typed identity journaling,
identity scheduling invalidation, exact notification provenance, and the narrowed
student metadata guard. Historical SQL and dependency bytes remain unchanged.
Hashes use immutable Git blob bytes, matching Linux CI rather than Windows newline
conversion. Local validation exposed a historical-path compatibility failure in
the comparison helper; the manifest is pending revalidation after that repair.

This manifest authorizes a controlled measurement setup; it does not establish
feature correctness or passing latency results. The baseline application runs under
the candidate schema, with a separately labelled native-schema cold control. New
identity-only scenarios require separate candidate evidence. The harness must retain
all semantic comparisons and disclose cross-partition variation.

Update these inputs only after reviewing every additional migration and schema
change. Missing, changed or unlisted inputs fail comparison. Manual workflow inputs
take precedence; a baseline override requires an explicit selected manifest.
