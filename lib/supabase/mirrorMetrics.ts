/**
 * In-memory mirror counters — dev-oriented, boundary-local.
 *
 * Four integer counters, incremented as mirror helpers finalise each
 * attempt. The counters do not persist, do not network, do not touch
 * localStorage, and emit nothing outside this module. Reading them requires
 * an explicit call to `getMirrorMetricsSnapshot()`, so a production build
 * without a debug surface never exposes the counts.
 *
 * Invariant maintained by callers (mirror helpers):
 *   `attempted === success + skipped + failed`
 *
 * Phase1 contract:
 *   - No external SDK.
 *   - No PII / no payload data stored.
 *   - No throw paths (integer increments only).
 *   - No coupling to specific features — keys are taxonomy-level only.
 */

export type MirrorMetricKey = "attempted" | "success" | "skipped" | "failed";

type MirrorCounters = Record<MirrorMetricKey, number>;

const counters: MirrorCounters = {
  attempted: 0,
  success: 0,
  skipped: 0,
  failed: 0,
};

export function incrementMirrorMetric(key: MirrorMetricKey): void {
  counters[key] += 1;
}

export function getMirrorMetricsSnapshot(): MirrorCounters {
  return { ...counters };
}

export function resetMirrorMetrics(): void {
  counters.attempted = 0;
  counters.success = 0;
  counters.skipped = 0;
  counters.failed = 0;
}
