/**
 * Shared mirror observability finalisation.
 *
 * Hosts the observability primitives that every feature mirror must agree on
 * byte-for-byte:
 *   - `deriveEnvironment()` — the value that lands in `mirror_events.environment`.
 *     Two different mirrors emitting different `environment` values in the same
 *     browser session would make rollout-stage queries incoherent.
 *   - `readClientVersion()` — same property for `mirror_events.client_version`.
 *     Returns `"unknown"` when `NEXT_PUBLIC_APP_COMMIT` is unset so the column
 *     is never NULL; this preserves stale-client identifiability without
 *     forcing the env var as a deploy prerequisite.
 *   - `buildMirrorEvent(feature, result, schemaVersion, durationMs)` —
 *     `MirrorResult → MirrorEvent` mapping. The 4-value observability
 *     vocabulary (`success` / `failure` / `skipped` / `disabled`) is owned
 *     here so individual feature mirrors cannot drift the bucket logic.
 *     `schemaVersion` is forwarded from the per-feature constant (or input)
 *     so `mirror_events.schema_version` is populated for every row; partial
 *     deploy / stale tab identification depends on this.
 *   - `finalize(feature, result, meta)` — the metric → log → emit contract
 *     every feature mirror invokes as its single exit point. Order is the
 *     contract. `meta.startedAt` (a `performance.now()` reading captured at
 *     mirror entry) is converted here to `durationMs` so the per-feature
 *     code does not own timing taxonomy.
 *
 * Phase1 contract:
 *   - No Supabase reads.
 *   - No retries / batching / sampling.
 *   - `emitMirrorEvent` is contract-bound to never throw or reject; `finalize`
 *     stays synchronous and `void`-fires the emit so the caller-visible
 *     mirror Promise is unaffected by sink latency.
 *   - No feature knowledge here — every feature-specific concern (table name,
 *     payload shape, skip ladder, PII stripping, error mapping) stays in the
 *     per-feature mirror file.
 *
 * This module was extracted at N=2 (when `mirrorBasicInfo` joined
 * `mirrorStudentProfile`) per the seam map in the boundary-readiness audit.
 */

import { emitMirrorEvent, type MirrorEvent } from "./mirrorEventSink";
import { logMirrorResult } from "./mirrorLogger";
import { incrementMirrorMetric } from "./mirrorMetrics";
import type { MirrorResult } from "./mirrorTypes";

export function deriveEnvironment(): MirrorEvent["environment"] {
  // Runs inside the browser bundle only (mirror callers short-circuit when
  // `typeof window === "undefined"`). Next.js inlines `NEXT_PUBLIC_*` and
  // `NODE_ENV` into client code; an unprefixed `VERCEL_ENV` read would
  // always be `undefined` here, so it is intentionally omitted.
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercelEnv === "preview") return "preview";
  if (vercelEnv === "production") return "production";
  if (process.env.NODE_ENV === "production") return "production";
  return "development";
}

// Sentinel used when `NEXT_PUBLIC_APP_COMMIT` is unset. Distinguishes
// "intentionally undeclared" from "field forgotten" in `mirror_events.client_version`,
// so stale-client queries never collapse to all-NULL rows.
const UNKNOWN_CLIENT_VERSION = "unknown";

export function readClientVersion(): string {
  const v = process.env.NEXT_PUBLIC_APP_COMMIT;
  return typeof v === "string" && v.length > 0 ? v : UNKNOWN_CLIENT_VERSION;
}

export type MirrorFinalizeMeta = {
  schemaVersion: string;
  /** `performance.now()` captured at mirror entry. */
  startedAt: number;
};

function elapsedMs(startedAt: number): number {
  const diff = performance.now() - startedAt;
  // Negative clock drift / `Math.round` returning -0 are both clamped to 0
  // so `mirror_events.duration_ms` is a non-negative integer monotonically.
  return diff > 0 ? Math.round(diff) : 0;
}

export function buildMirrorEvent(
  feature: string,
  result: MirrorResult,
  schemaVersion: string,
  durationMs: number,
): MirrorEvent {
  const base = {
    feature,
    environment: deriveEnvironment(),
    clientVersion: readClientVersion(),
    schemaVersion,
    durationMs,
  };
  if (result.status === "success") {
    return { ...base, mirrorStatus: "success" };
  }
  if (result.status === "failed") {
    return { ...base, mirrorStatus: "failure", failureReason: result.reason };
  }
  // `mirror_disabled` is the only skip reason that maps to the distinct
  // 4-value "disabled" observability bucket (mirror_observability.md §7).
  if (result.reason === "mirror_disabled") {
    return { ...base, mirrorStatus: "disabled" };
  }
  return { ...base, mirrorStatus: "skipped", skipReason: result.reason };
}

export function finalize(
  feature: string,
  result: MirrorResult,
  meta: MirrorFinalizeMeta,
): MirrorResult {
  const durationMs = elapsedMs(meta.startedAt);
  // result.status is "success" | "skipped" | "failed" — all valid metric keys.
  incrementMirrorMetric(result.status);
  logMirrorResult(feature, result);
  // Fire-and-forget. emitMirrorEvent is contract-bound to never throw or
  // reject; the `void` keeps finalize synchronous and the caller-visible
  // mirror Promise unchanged.
  void emitMirrorEvent(
    buildMirrorEvent(feature, result, meta.schemaVersion, durationMs),
  );
  return result;
}
