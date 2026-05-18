/**
 * Best-effort basicInfo mirror — Phase1 boundary helper.
 *
 * Loaded lazily at runtime via `import()` from
 * `lib/basicInfoStorage.ts:saveBasicInfo()` after a successful canonical
 * localStorage write. The dynamic import is what keeps the browser-only
 * Supabase client out of server route bundles — this file statically
 * imports `./browserClient` (a `"use client"` module), so it must remain
 * reachable only via that lazy chunk.
 *
 * Phase1 contract enforced by this file:
 *   - Best-effort. Never throws. Always resolves to a `MirrorResult`.
 *   - Routes through the existing browser client boundary; no direct
 *     `createClient` usage and no `@supabase/*` import.
 *   - No reads / no select. The function only attempts a single upsert.
 *   - No localStorage access. The caller passes the post-prune canonical
 *     payload as-is; this file derives the upsert shape from it.
 *   - **PII**: `name` is stripped before mirror payload assembly and never
 *     leaves the browser. Phase1 is anonymous; the raw user-supplied name
 *     is the canonical artifact's only direct-PII field, and it is the
 *     mirror's responsibility (not the caller's) to remove it so the type
 *     system cannot be weakened by a future refactor.
 *   - No auth UX, no session checks, no user-visible error path.
 *
 * PROVISIONAL TABLE IDENTIFIER:
 *   `MIRROR_TABLE` below is a placeholder pending the schema apply for
 *   `basic_info_mirrors` (see docs/supabase/basic_info_mirror_schema_preview.md).
 *   The constant is deliberately isolated to this file — no other module
 *   should import or reference it. The mirror upsert will silently fail
 *   (PostgREST `{ error }`) and be reported as `failure / network_error`
 *   in `mirror_events` until the table is applied; canonical UX is
 *   unaffected.
 *
 * sourceHash strategy:
 *   Unlike `studentProfile.sourceHash` (which is computed by the canonical
 *   pipeline at `lib/studentProfile.ts`), basicInfo has no sourceHash on its
 *   canonical type. This file derives `source_hash` at write time via
 *   `sha256(JSON.stringify(payloadWithoutName) + SCHEMA_VERSION)`.
 *   Keeping the derivation here avoids polluting `BasicInfo` with a
 *   Phase1-specific field that would ripple into 8 readers and the AI
 *   input hash (`lib/aiInputHash.ts`).
 */

import { getBrowserSupabaseClient } from "./browserClient";
import { isSupabaseEnvAvailable } from "./env";
import { isMirrorRuntimeEnabled } from "./mirrorConfig";
import { finalize } from "./mirrorFinalize";
import { shouldSkipMirror } from "./mirrorGuard";
import { incrementMirrorMetric } from "./mirrorMetrics";
import { mirrorFailed, mirrorSkipped, mirrorSuccess } from "./mirrorResult";
import { sha256Hex } from "./mirrorSourceHash";
import type { MirrorResult } from "./mirrorTypes";

const MIRROR_FEATURE = "basicInfo";

// PROVISIONAL — see header.
const MIRROR_TABLE = "basic_info_mirrors";

// Pin the current basicInfo canonical shape version. Bump explicitly when
// `normalizeBasicInfo` / `pruneSubjectGrades` change the post-prune shape.
const SCHEMA_VERSION = "1";

/**
 * Narrow envelope accepted by `mirrorBasicInfoToSupabase`.
 *
 * The caller (`lib/basicInfoStorage.ts:saveBasicInfo`) passes the
 * already-pruned canonical `BasicInfo` payload as-is. This file strips
 * `name` and derives `source_hash`; callers MUST NOT pre-strip — the
 * post-prune shape must stay identical between localStorage and the
 * pre-strip view the mirror receives, so a future audit can re-derive the
 * canonical-vs-mirror diff from any one snapshot.
 */
export type MirrorBasicInfoInput = {
  payload: Record<string, unknown>;
};

function stripName(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  // Spread, then delete: produces a new object without mutating canonical.
  // `name` removal preserves the rest of the post-prune shape verbatim
  // (subjectGrades presence/absence, '' vs. undefined semantics for
  // overallGpa / department).
  const rest: Record<string, unknown> = { ...payload };
  delete rest.name;
  return rest;
}

export async function mirrorBasicInfoToSupabase(
  input: MirrorBasicInfoInput,
): Promise<MirrorResult> {
  const startedAt = performance.now();
  const meta = { schemaVersion: SCHEMA_VERSION, startedAt };
  incrementMirrorMetric("attempted");

  // Skip-taxonomy convergence: kill-switch → skip-reason mapping is shared
  // with `mirrorStudentProfile` via `shouldSkipMirror`. Window check stays
  // inline to preserve the canonical skip-reason priority (window >
  // killSwitch). See `mirrorStudentProfile.ts` for the matching pattern.
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
    const payloadWithoutName = stripName(input.payload);
    const sourceHash = await sha256Hex(
      JSON.stringify(payloadWithoutName) + SCHEMA_VERSION,
    );

    const { error } = await client.from(MIRROR_TABLE).upsert(
      {
        source_hash: sourceHash,
        schema_version: SCHEMA_VERSION,
        payload: payloadWithoutName,
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
