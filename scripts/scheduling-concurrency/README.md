# Supplementary scheduling concurrency measurements

This suite measures simultaneous operations requested in [#522](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/522). The original seven-workload result remains bound to commit `7a3c4d0e` and [run 41626762202](https://github.com/DupeisTaken/shbs-peer-tutoring-website/actions/runs/41626762202). Its raw distributions are never pooled with these samples.

The workflow gives each worker an isolated PostgreSQL 16 service, two CPUs and 4 GB for each measurement container. It runs the baseline and candidate serially on the same host and Node 22 Alpine image. The five new workloads use the reviewed roster-only source control `223a1b2` on the same reviewed schema as the candidate. The two-reader regression check instead uses the previous scheduling candidate `7a3c4d0e` and requires identical schemas. The isolated measurement ref runs three revisions for each of those five cases. It pairs the same control samples separately with the frozen 7a3c4d0e application and with the proposed repair. Each complete result names its measured revision. The two-reader comparison runs only the frozen application and the proposed repair. Publishing this isolated ref leaves product PR #569 unchanged until the measured tradeoff and safety evidence have been reviewed.

| Workload | Calls and launch schedule |
| --- | --- |
| Cold | A tutor HTTP agenda publishes an empty planning window. Dispatch a tutee HTTP agenda as soon as the tutor obtains the period lock. |
| Sunday | Two real domain agenda calls use the same explicit Sunday clock and empty planning state. The second starts when the first obtains the period lock. |
| Proposal and split | A new whole-group HTTP proposal competes with formalizing an existing split on another live request. The proposal obtains the period lock first. |
| Acceptance | A one-person acceptance competes with an HTTP agenda read for a different tutor. The acceptance obtains the period lock first. |
| Deadline | Two real sweeps use the same persisted response deadline. After each sweep's due-first query returns the same request, both continue. Each selects one request. Exactly one timeout decision and move must persist. |
| Two readers | Repeat the original contention fixture's first concurrent agenda pair immediately after initial materialization. Tutors 10 and 11 start together, with the same seeded rows and real authority checks. |

All timing includes the real caller and server or domain path. The first-period policy lets the first call continue while its peer starts. Its latency does not include a deliberately held database blocker. The deadline rendezvous occurs after the real candidate selection, outside a database transaction. Its measured latency includes coordination time, which each call reports separately. These are controlled launch schedules. They establish behavior and latency under the specified overlapping operations.

Each case has five latency partitions with four measured waves each and one three-wave diagnostic partition. Each process warms up on a discarded fresh fixture. Each measured round retains both call intervals, the observed scheduling evidence, raw returns, terminal status and complete normalized procedure, domain, audit and recovery snapshots. Aggregation requires actual overlap, exact paired semantic outcomes, matching immutable inputs, complete populations and uncensored completion. Its p50/p95 are empirical nearest-rank values for the 20 calls per operation per revision. Diagnostic process CPU and event-loop counters can overlap. Client-observed advisory statement duration includes round-trip and database execution time.

The clock plan may extend the previously verified campaign using its original anchor only while the full supplemental budget still fits its admitted interval. Otherwise it requires a fresh admitted anchor. Outside a safe window it emits a deferred receipt. Check the account queue and remaining interval before rerunning that same workflow event. A deferral has no benchmark result.

For local investigation, set `TZ=UTC` so offset-free UTC recovery timestamps have the same interpretation as the Linux worker. `run.ts --local-smoke` requires the dedicated loopback `shbs_performance_test` database at port 55439 and explicit ownership. It issues a `LOCAL_SMOKE` result that the aggregator rejects. Only the hosted workflow produces eligible latency receipts.

## Reviewing the two-reader change

Review the proposed repair against 7a3c4d0e before changing the product PR.
Inspect both individual readers and the whole wave. Report per-role and pooled
p50/p95, the sum of both request durations in each paired wave, the time until
both return, and how often each improves. Check the query and advisory traces
to establish which request avoided waiting and whether the other reader paid
for it. A lower pooled median on its own is insufficient.

For this synthetic comparison, consider the improvement repeatable if at least
15 of the 20 paired waves reduce total request time and its paired median ratio
is below one. Treat a candidate p95 increase exceeding both 10% and 25 ms in
either pooled request latency or time to both completions as a material tail
cost. These are review thresholds for this small fixture. Report exact results
even when they miss the threshold. Require the full semantic, due-decision,
worker-progress, rollback and retry checks independently. If the candidate
fails this review, retain its measurements and the previously verified runtime.
