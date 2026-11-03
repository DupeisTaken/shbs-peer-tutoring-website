# Reviewed scheduling comparison inputs

PR #568 uses `pr-568-baseline.txt` and `pr-568.json` for the standalone identity comparison. The baseline is the reviewed original-plus-roster-order control `223a1b213a7a5167187b057d08a349d30f0087ad`. Its parent is the frozen original `c113b8efbbfe0c350dc8c0d09aec92c48777d9c6`. The manifest binds 112 historical migrations and eight reviewed additions to the exact candidate schema and dependency lockfile. Hashes use Git blob bytes.

The separate `pr-569` pair belongs to scheduling. Unrelated pull requests use their own default base unless a scoped pair or explicit manual selection applies. The standalone identity profile covers its harness projections. Combined PR #570 supplies the full identity and recovery v3 projections and native-original contract. Independent identity database and browser tests exercise authorization and ownership.
