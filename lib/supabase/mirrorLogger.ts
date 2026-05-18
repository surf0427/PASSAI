/**
 * Mirror logger boundary — dev-only local console aid.
 *
 * Phase1 contract:
 *   - No external observability sink, no analytics SDK, no network calls
 *     from this file. The durable observability sink lives separately at
 *     `./mirrorEventSink.ts` and emits one row into `mirror_events` per
 *     mirror attempt. The two coexist intentionally — this logger is for
 *     local dev verification, the sink is for durable rollout-stage signal.
 *     Neither replaces the other, and this logger is not deprecated.
 *   - In production builds this is a hard no-op so it cannot spam logs, leak
 *     PII, or couple mirror behavior to telemetry that does not exist yet.
 *   - In `NODE_ENV !== "production"`, results are forwarded to `console.debug`
 *     under a single namespaced tag so a developer can verify wiring locally.
 *
 * MUST NOT contain PII. The `feature` argument is a short label only; the
 * `result` is the `MirrorResult` union, whose `message` field is already
 * documented as non-PII at the type level.
 */

import type { MirrorResult } from "./mirrorTypes";

const isDevEnvironment: boolean =
  typeof process !== "undefined" && process.env.NODE_ENV !== "production";

export function logMirrorResult(feature: string, result: MirrorResult): void {
  if (!isDevEnvironment) return;
  console.debug("[supabase.mirror]", feature, result);
}
