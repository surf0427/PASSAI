/**
 * Best-effort mirror observability event sink — Phase1 boundary helper.
 *
 * Wired via a single fire-and-forget call from
 * `mirrorStudentProfile.ts:finalize()` to validate the path end-to-end
 * before broader rollout to other features.
 *
 * Phase1 contract enforced by this file:
 *   - INSERT only. No reads. No UPDATE. No DELETE.
 *   - Best-effort. Never throws. Failures are absorbed silently — the sink
 *     observing its own observability is not a Phase1 concern.
 *   - No retries, no batching, no sampling.
 *   - Independent kill-switch:
 *       `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED`
 *     toggles the sink without touching mirror behavior. Default-enabled
 *     when unset.
 *   - No PII, no payload, no `source_hash` accepted by this surface.
 *   - Routes through the existing browser-client boundary; no
 *     `@supabase/*` import here.
 *
 * Event shape mirrors `docs/supabase/observability_sink.md §3` and the
 * `mirror_events` table defined in `supabase/schema.sql §5`. The accepted
 * `mirrorStatus` vocabulary is the canonical 4-value taxonomy
 * (`mirror_observability.md §7`); callers translating from `MirrorResult`
 * (3-value internal vocabulary) own the mapping — see
 * `observability_sink.md §6.5` for the planned translation contract.
 */

import { getBrowserSupabaseClient } from "./browserClient";
import { isSupabaseEnvAvailable } from "./env";
import type {
  MirrorFailureReason,
  MirrorSkipReason,
} from "./mirrorTypes";

const SINK_TABLE = "mirror_events";

const SINK_DISABLED_VALUES: ReadonlySet<string> = new Set([
  "true",
  "1",
  "yes",
]);

let cachedSinkEnabled: boolean | undefined;

function readSinkDisabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED;
  if (typeof raw !== "string") return false;
  return SINK_DISABLED_VALUES.has(raw.trim().toLowerCase());
}

function isSinkEnabled(): boolean {
  if (cachedSinkEnabled === undefined) cachedSinkEnabled = !readSinkDisabled();
  return cachedSinkEnabled;
}

// `schemaVersion` / `clientVersion` / `durationMs` are required on the event
// shape so a regression that forgets to thread one through `mirrorFinalize`
// is a TypeScript error rather than a silent NULL column in `mirror_events`.
// The DB columns remain nullable on purpose (`supabase/schema.sql §5`) so a
// future event source that legitimately cannot supply one still writes.
export type MirrorEvent = {
  feature: string;
  mirrorStatus: "success" | "failure" | "skipped" | "disabled";
  failureReason?: MirrorFailureReason;
  skipReason?: MirrorSkipReason;
  durationMs: number;
  environment: "development" | "preview" | "production";
  schemaVersion: string;
  clientVersion: string;
};

export async function emitMirrorEvent(event: MirrorEvent): Promise<void> {
  // Pre-flight gates. Every short-circuit must be silent and synchronous so
  // the sink never adds latency or surfaces a failure to the caller.
  if (typeof window === "undefined") return;
  if (!isSinkEnabled()) return;
  if (!isSupabaseEnvAvailable()) return;

  const client = getBrowserSupabaseClient();
  if (!client) return;

  try {
    const { error } = await client.from(SINK_TABLE).insert({
      feature: event.feature,
      mirror_status: event.mirrorStatus,
      failure_reason: event.failureReason ?? null,
      skip_reason: event.skipReason ?? null,
      duration_ms: event.durationMs ?? null,
      environment: event.environment,
      schema_version: event.schemaVersion ?? null,
      client_version: event.clientVersion ?? null,
    });
    // PostgREST resolves with `{ error }` on RLS / schema rejection rather
    // than throwing. Discard it explicitly so this surface stays best-effort.
    void error;
  } catch {
    // Network / unexpected runtime throws hit here. Swallow on the same
    // principle: the sink observing its own observability is not Phase1.
  }
}
