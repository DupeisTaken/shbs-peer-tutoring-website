import { relative, sep } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import timings from "./ci-shard-timings.json";

const durationsMs: Readonly<Record<string, number>> = timings.durationsMs;

export class CiShardSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]) {
    const shard = this.ctx.config.shard;
    if (!shard) return files;

    const weighted = files.map((file) => {
      const path = relative(this.ctx.config.root, file.moduleId)
        .split(sep)
        .join("/");
      // The fallback rounds the observed 90th percentile up for new and renamed files.
      const durationMs = durationsMs[path] ?? timings.fallbackMs;
      // Include runner/import time and the sizing model's timing allowance.
      const weight =
        Math.ceil(durationMs * timings.executionMultiplier) +
        timings.perFileOverheadMs;
      return { file, path, weight };
    });
    weighted.sort((a, b) => {
      if (a.weight !== b.weight) return b.weight - a.weight;
      // Use the same tie-break across runner locales and discovery orders.
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });

    const buckets = Array.from({ length: shard.count }, () => ({
      weight: 0,
      files: [] as TestSpecification[],
    }));
    for (const item of weighted) {
      const lightest = buckets.reduce((best, next) =>
        next.weight < best.weight ? next : best,
      );
      lightest.files.push(item.file);
      lightest.weight += item.weight;
    }
    const selected = buckets[shard.index - 1];
    if (!selected)
      throw new Error(`Invalid shard ${shard.index}/${shard.count}`);
    return selected.files;
  }
}
