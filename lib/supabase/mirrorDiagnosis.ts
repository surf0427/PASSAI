/**
 * Best-effort diagnosis mirror — Phase1 boundary helper.
 *
 * Third feature mirror (after `studentProfile` and `basicInfo`). The cleanest
 * mirror surface in the Phase1 rollout matrix:
 *   - **No user free text** in the payload. `answers` is a `number[]` of
 *     option indices; `resultType` is a fixed enum; `resultTitle` and
 *     `resultDescription` are app-supplied static strings keyed by
 *     `resultType` (the in-page `RESULT_TYPES` dictionary). The user contributes
 *     only the answer indices.
 *   - **No PII to strip.** Unlike `mirrorBasicInfo` (where `name` is removed
 *     before INSERT), the diagnosis payload mirrors verbatim. This is the
 *     "no-PII mirror" precedent the boundary needed at N=3.
 *   - **No AI dependency.** `calcResultType` is deterministic local logic;
 *     no AI route consumes the result. `lib/aiInputHash.ts` does not reference
 *     diagnosis state.
 *
 * Loaded lazily at runtime via `import()` from
 * `lib/diagnosisStorage.ts:saveDiagnosisResult()` after a successful canonical
 * localStorage write. The dynamic import keeps the browser-only Supabase
 * client out of server route bundles — this file statically imports
 * `./browserClient` (a `"use client"` module), so it must remain reachable
 * only via that lazy chunk.
 *
 * Phase1 contract enforced by this file:
 *   - Best-effort. Never throws. Always resolves to a `MirrorResult`.
 *   - Routes through the existing browser client boundary; no direct
 *     `createClient` usage and no `@supabase/*` import.
 *   - No reads / no select. The function only attempts a single upsert.
 *   - No localStorage access. The caller passes the canonical payload as-is.
 *   - No payload stripping, no normalisation, no PII filter layer.
 *   - No auth UX, no session checks, no user-visible error path.
 *
 * PROVISIONAL TABLE IDENTIFIER:
 *   `MIRROR_TABLE` below points at `diagnosis_mirrors`. The table DDL is
 *   defined by docs/supabase/diagnosis_mirror_schema_preview.md and will be
 *   added to `supabase/schema.sql` in a follow-up STEP. Until then, upsert
 *   resolves with PostgREST `{ error }` and is reported as
 *   `failure / network_error` in `mirror_events`; canonical UX is unaffected.
 *
 * sourceHash strategy:
 *   `source_hash = sha256(JSON.stringify({ answers, resultType }) + SCHEMA_VERSION)`
 *
 *   Derived at write time via the shared `./mirrorSourceHash::sha256Hex`
 *   (no canonical-type change). The hash includes:
 *     - `answers` — the only user-derived content
 *     - `resultType` — defensive: if `calcResultType` logic drifts without
 *       a `SCHEMA_VERSION` bump, identical answers would still produce a
 *       new row, making the drift observable in `mirror_events`
 *   The hash excludes:
 *     - `createdAt` — including it would defeat idempotent retake
 *     - `resultTitle` / `resultDescription` — app-authored strings; copy
 *       edits would otherwise force a SCHEMA_VERSION bump
 *
 * SCHEMA_VERSION bump triggers (documented contract):
 *   - `QUESTIONS` array changes (length or option order at any index)
 *   - `DiagnosisType` enum extends (e.g. 5th type added)
 *   - `calcResultType` logic changes
 *   `RESULT_TYPES` title / description copy edits do NOT trigger a bump.
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

const MIRROR_FEATURE = "diagnosis";

// PROVISIONAL — see header.
const MIRROR_TABLE = "diagnosis_mirrors";

// Pin the current diagnosis canonical shape version. Bump on any change to
// `QUESTIONS` array, `DiagnosisType` enum, or `calcResultType` logic.
const SCHEMA_VERSION = "1";

/**
 * Narrow envelope accepted by `mirrorDiagnosisToSupabase`.
 *
 * The caller (`lib/diagnosisStorage.ts:saveDiagnosisResult`) passes the
 * canonical `DiagnosisResult` payload as-is. The boundary derives
 * `source_hash` at write time; callers MUST NOT pre-derive — keeping the
 * hash mirror-local avoids polluting `DiagnosisResult` with a
 * Phase1-specific field that would ripple to the 1 consumer
 * (`app/home/DiagnosisTypeCard.tsx`).
 */
export type MirrorDiagnosisInput = {
  payload: Record<string, unknown>;
};

export async function mirrorDiagnosisToSupabase(
  input: MirrorDiagnosisInput,
): Promise<MirrorResult> {
  const startedAt = performance.now();
  const meta = { schemaVersion: SCHEMA_VERSION, startedAt };
  incrementMirrorMetric("attempted");

  // Skip-taxonomy convergence: kill-switch → skip-reason mapping is shared
  // with the other feature mirrors via `shouldSkipMirror`. Window check
  // stays inline to preserve the canonical skip-reason priority
  // (window > killSwitch).
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
    // Hash input deliberately narrows to `{ answers, resultType }`. See
    // header for what is and is not in the hash and why.
    const hashInput =
      JSON.stringify({
        answers: input.payload.answers,
        resultType: input.payload.resultType,
      }) + SCHEMA_VERSION;
    const sourceHash = await sha256Hex(hashInput);

    const { error } = await client.from(MIRROR_TABLE).upsert(
      {
        source_hash: sourceHash,
        schema_version: SCHEMA_VERSION,
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
