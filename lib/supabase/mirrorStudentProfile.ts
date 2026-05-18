/**
 * Best-effort StudentProfile mirror — Phase1 boundary helper.
 *
 * Loaded lazily at runtime via `import()` from
 * `lib/studentProfileStorage.ts:saveStudentProfile()` after a successful
 * canonical localStorage write. The dynamic import is what keeps the
 * browser-only Supabase client out of server route bundles — this file
 * statically imports `./browserClient` (a `"use client"` module), so it
 * must remain reachable only via that lazy chunk.
 *
 * Phase1 contract enforced by this file:
 *   - Best-effort. Never throws. Always resolves to a `MirrorResult`.
 *   - Routes through the existing browser client boundary; no direct
 *     `createClient` usage and no `@supabase/*` import.
 *   - No reads / no select. The function only attempts a single write.
 *   - No localStorage access. The caller passes a narrow envelope built from
 *     canonical state *after* a successful localStorage write.
 *   - No PII in returned `message` fields. Only short Postgres / error-class
 *     codes are surfaced (see docs/supabase/mirror_observability.md §6).
 *   - No auth UX, no session checks, no user-visible error path.
 *
 * PROVISIONAL TABLE IDENTIFIER:
 *   `MIRROR_TABLE` below is a placeholder. The real table name will be
 *   chosen when `docs/supabase/schema_boundary_policy.md` commits a schema
 *   STEP. The constant is deliberately isolated to this file — no other
 *   module should import or reference it. When schema lands, update both
 *   the constant and any docs that point at it.
 *
 * Skip / failure mapping used here (subset; see mirror_observability.md):
 *   - `unsupported_environment` — invoked outside a browser context.
 *   - `missing_env`             — Supabase env vars not configured.
 *   - `client_unavailable`      — boundary failed to construct a client.
 *   - `network_error`           — upstream returned a PostgREST error.
 *   - `unknown`                 — any thrown exception during the attempt.
 */

import { getBrowserSupabaseClient } from "./browserClient";
import { isSupabaseEnvAvailable } from "./env";
import { isMirrorRuntimeEnabled } from "./mirrorConfig";
import { finalize } from "./mirrorFinalize";
import { shouldSkipMirror } from "./mirrorGuard";
import { incrementMirrorMetric } from "./mirrorMetrics";
import { mirrorFailed, mirrorSkipped, mirrorSuccess } from "./mirrorResult";
import type { MirrorResult } from "./mirrorTypes";

const MIRROR_FEATURE = "studentProfile";

// PROVISIONAL — see header.
const MIRROR_TABLE = "student_profile_mirrors";

/**
 * Narrow envelope accepted by `mirrorStudentProfileToSupabase`.
 *
 * Deliberately NOT the full StudentProfile shape — the boundary is unaware
 * of feature internals. The caller (a future feature-side helper) assembles
 * this from canonical state.
 *
 * - `sourceHash`: deterministic identifier of the canonical snapshot. Used
 *   here as the conflict key for idempotent re-mirror.
 * - `schemaVersion`: monotonic version of the canonical contract; lets the
 *   sink reject rows produced under an outdated contract without ambiguity.
 * - `payload`: opaque JSON-serialisable snapshot. The boundary does not
 *   inspect its contents. Callers MUST exclude PII / free-text body from
 *   this envelope (mirror_observability.md §6).
 */
export type MirrorStudentProfileInput = {
  sourceHash: string;
  schemaVersion: string;
  payload: Record<string, unknown>;
};

export async function mirrorStudentProfileToSupabase(
  input: MirrorStudentProfileInput,
): Promise<MirrorResult> {
  // Capture before any short-circuit so even the SSR / kill-switch paths
  // contribute a `duration_ms` data point to `mirror_events`. Skip rows are
  // expected to be ~0ms; non-zero values there would themselves be a signal.
  const startedAt = performance.now();
  const meta = { schemaVersion: input.schemaVersion, startedAt };
  incrementMirrorMetric("attempted");

  // Skip-taxonomy convergence (N=2): the kill-switch → skip-reason mapping
  // is shared with `mirrorBasicInfo` via `shouldSkipMirror`. The window
  // check stays inline to preserve the canonical skip-reason priority
  // (window > killSwitch) — `shouldSkipMirror` itself checks killSwitch
  // first, which would flip the reported reason on the (unreachable in
  // practice) case where both conditions hold.
  if (typeof window === "undefined") {
    return finalize(
      MIRROR_FEATURE,
      mirrorSkipped("unsupported_environment"),
      meta,
    );
  }
  const skip = shouldSkipMirror({
    killSwitchActive: !isMirrorRuntimeEnabled(),
  });
  if (skip !== null) {
    return finalize(MIRROR_FEATURE, mirrorSkipped(skip), meta);
  }

  if (!isSupabaseEnvAvailable()) {
    return finalize(MIRROR_FEATURE, mirrorFailed("missing_env"), meta);
  }

  const client = getBrowserSupabaseClient();
  if (!client) {
    return finalize(MIRROR_FEATURE, mirrorFailed("client_unavailable"), meta);
  }

  try {
    const { error } = await client.from(MIRROR_TABLE).upsert(
      {
        source_hash: input.sourceHash,
        schema_version: input.schemaVersion,
        payload: input.payload,
      },
      { onConflict: "source_hash" },
    );

    if (error) {
      return finalize(
        MIRROR_FEATURE,
        mirrorFailed("network_error", error.code),
        meta,
      );
    }

    return finalize(MIRROR_FEATURE, mirrorSuccess(), meta);
  } catch (err) {
    const code = err instanceof Error ? err.name : "unknown";
    return finalize(MIRROR_FEATURE, mirrorFailed("unknown", code), meta);
  }
}
