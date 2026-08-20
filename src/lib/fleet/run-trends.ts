// Hourly run buckets, shared by the inbox sparklines and the activity volume
// strip so both read the same history the same way. Pure and testable.

import type { RunSummary } from "./db/runs-repo";

export type RunBucket = {
  /** Runs that started in this hour. */
  total: number;
  succeeded: number;
  failed: number;
  /** Runs sitting on a human. */
  paused: number;
};

/** Oldest bucket first, ending with the hour containing `now`. */
export function bucketRunsByHour(
  runs: RunSummary[],
  hours = 24,
  now: number = Date.now(),
): RunBucket[] {
  const buckets: RunBucket[] = Array.from({ length: hours }, () => ({
    total: 0,
    succeeded: 0,
    failed: 0,
    paused: 0,
  }));
  for (const run of runs) {
    const started = new Date(run.startedAt).getTime();
    if (Number.isNaN(started)) continue;
    const hoursAgo = Math.floor((now - started) / 3_600_000);
    if (hoursAgo < 0 || hoursAgo >= hours) continue;
    const bucket = buckets[hours - 1 - hoursAgo];
    bucket.total++;
    if (run.status === "succeeded") bucket.succeeded++;
    if (run.status === "failed") bucket.failed++;
    if (run.status === "paused") bucket.paused++;
  }
  return buckets;
}

/** Rolling success rate per bucket (0–100), carrying the previous value through
 * quiet hours so the sparkline reads as a trend rather than dropping to zero. */
export function successTrend(buckets: RunBucket[]): number[] {
  let last = 100;
  return buckets.map((b) => {
    const finished = b.succeeded + b.failed;
    if (finished > 0) last = Math.round((b.succeeded / finished) * 100);
    return last;
  });
}
