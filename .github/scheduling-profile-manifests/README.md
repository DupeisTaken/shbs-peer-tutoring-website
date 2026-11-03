# Reviewed scheduling comparison inputs

PR #568 uses `pr-568.json` to bind 112 historical migrations and ten reviewed additions to the exact candidate schema and dependency lockfile. Hashes use Git blob bytes. The new ordered group-room journal migration is part of the shared schema for both source controls.

`pr-568-baseline.txt` selects the original-plus-roster-order control `223a1b213a7a5167187b057d08a349d30f0087ad`. Only catalog workloads select `pr-568-catalog-baseline.txt`, which names `c3947f096a1cf1eb33c02948d0385d46d6838d77`. Both pin files contain exactly one full SHA followed by LF. The catalog control descends from the roster control. The frozen original is `c113b8efbbfe0c350dc8c0d09aec92c48777d9c6`.

The separate PR #569 files belong to scheduling and identify its two additions. Unrelated pull requests use their own default base unless a scoped pair or explicit manual selection applies. The standalone identity profile covers its own projections. Combined PR #570 supplies the full identity and recovery v3 projections and native-original contract. Independent identity database and browser checks exercise authorization and ownership.
