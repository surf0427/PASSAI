/**
 * Best-effort activityData mirror — Phase1 boundary helper.
 *
 * Fourth feature mirror (after `studentProfile`, `basicInfo`, `diagnosis`).
 * First mirror that exercises the **narrative-soft PII** pattern — the
 * payload carries no direct-name field (so `stripName`-style enforcement
 * doesn't apply), but the free-text narrative fields (clubName /
 * activityContent / theme / description / achievement / role / challenge /
 * action / reflection / futureConnection, etc.) carry potentially
 * identifying context. The artifact IS the narrative; there is nothing to
 * strip without destroying the mirror's purpose. Operator sign-off on the
 * Phase1 anonymous-RLS exposure is the gate that lets this mirror exist.
 * See docs/supabase/activity_mirror_schema_preview.md for the PII rationale.
 *
 * Loaded lazily at runtime via `import()` from
 * `hooks/useActivityForm.ts:handleSubmit()` after successful form validation
 * and successful sessionStorage handoff. **Trigger is submit-driven, NEVER
 * autosave-driven** — see STEP-PHASE1M decision. Wiring the mirror to the
 * autosave path would produce 1000-5000 writes per editing session, which
 * would dominate `mirror_events` storage growth and destroy the "row =
 * intent" property the existing 3 mirrors rely on.
 *
 * Phase1 contract enforced by this file:
 *   - Best-effort. Never throws. Always resolves to a `MirrorResult`.
 *   - Routes through the existing browser client boundary; no direct
 *     `createClient` usage and no `@supabase/*` import.
 *   - No reads / no select. The function only attempts a single upsert.
 *   - No localStorage access. The caller passes the post-validate canonical
 *     payload directly.
 *   - No payload stripping, no normalisation, no PII filter layer. The
 *     mirror payload is the verbatim `ActivityData` shape that
 *     `lib/aiInputHash.ts` consumes — divergence here would break the AI
 *     cache hash invariant for downstream features.
 *   - No auth UX, no session checks, no user-visible error path.
 *
 * PROVISIONAL TABLE IDENTIFIER:
 *   `MIRROR_TABLE` below points at `activity_mirrors`. The table DDL is
 *   defined by docs/supabase/activity_mirror_schema_preview.md and will be
 *   added to `supabase/schema.sql` in a follow-up STEP. Until then, upsert
 *   resolves with PostgREST `{ error }` and is reported as
 *   `failure / network_error` in `mirror_events`; canonical UX is
 *   unaffected.
 *
 * sourceHash strategy:
 *   `source_hash = sha256(JSON.stringify(payload) + SCHEMA_VERSION)`
 *
 *   Derived at write time via the shared `./mirrorSourceHash::sha256Hex`.
 *   The hash covers the **entire** post-validate `ActivityData` — unlike
 *   basicInfo (which strips `name` before hashing) and diagnosis (which
 *   hashes only `{ answers, resultType }`). activityData has no fields that
 *   are excluded from canonical identity; any change to any of the 9 arrays
 *   or any nested string is a content change.
 *
 * SCHEMA_VERSION bump triggers (documented contract):
 *   - Adding / removing / renaming any of the 9 top-level `ActivityData`
 *     arrays (`clubActivities`, `volunteerActivities`, …, `hobbyActivities`).
 *   - Adding / removing / renaming any field on `BaseActivity` (shared by 6
 *     of the 9 activity types).
 *   - Adding / removing / renaming any field on any feature-specific
 *     `XxxActivity` type (`ClubActivity.clubName`, `ReadingActivity.genre`,
 *     etc.).
 *   - Changing the `type` discriminator on any activity union variant.
 *   Validator changes (`lib/activityValidator.ts`) do NOT trigger a bump —
 *   validation is presentation-layer, not shape-layer.
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

const MIRROR_FEATURE = "activityData";

// PROVISIONAL — see header.
const MIRROR_TABLE = "activity_mirrors";

// Pin the current activityData canonical shape version. Bump on any change
// to the ActivityData type, the BaseActivity shape, or any feature-specific
// Activity type.
// v1 → v2: 10 番目の top-level array `otherActivities` を ActivityData に追加
// （STEP-ACTIVITY-OTHER-01: 既存カテゴリに収まらない活動を入力するための「その他」追加）。
const SCHEMA_VERSION = "2";

/**
 * Narrow envelope accepted by `mirrorActivityDataToSupabase`.
 *
 * The caller (`hooks/useActivityForm.ts:handleSubmit`) passes the
 * post-validate canonical `ActivityData` as-is. This file derives
 * `source_hash` at write time over the full payload; callers MUST NOT
 * pre-derive — keeping the hash mirror-local avoids polluting `ActivityData`
 * with a Phase1-specific field that would ripple to 6+ consumers
 * (`hooks/useActivityForm.ts`, `app/home/page.tsx`,
 * `app/statement/prepare/page.tsx`, `app/statement/edit/page.tsx`,
 * `app/interview/questions/utils/loadInterviewQuestionInitialData.ts`,
 * `lib/admissionMatchingStorage.ts`) and the AI input hash in
 * `lib/aiInputHash.ts`.
 */
export type MirrorActivityDataInput = {
  payload: Record<string, unknown>;
};

export async function mirrorActivityDataToSupabase(
  input: MirrorActivityDataInput,
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
    const sourceHash = await sha256Hex(
      JSON.stringify(input.payload) + SCHEMA_VERSION,
    );

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
