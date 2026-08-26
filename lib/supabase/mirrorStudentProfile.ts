/**
 * Best-effort StudentProfile mirror — Phase1 boundary helper.
 *
 * Loaded lazily at runtime via `import()` from
 * `lib/studentProfileStorage.ts:saveStudentProfile()` after a successful
 * canonical localStorage write. The dynamic import is what keeps the
 * mirror 経路を server route bundle から切り離す。書き込み自体は
 * POST /api/mirrors 経由で行い、本 file は browser Supabase client を import しない
 * （観測用の mirror_events 書き込みだけが finalize 経由で browser client を使う）。
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
 * WRITE PATH (anon 直接 upsert は廃止):
 *   本 helper は Supabase へ直接書かない。`postMirror` で POST /api/mirrors へ送り、
 *   server-only writer (lib/mirrors/mirrorWriteServer.ts) が service_role で upsert する。
 *   理由: `INSERT ... ON CONFLICT DO UPDATE` は RLS 下で対応する SELECT アクセスを要求し、
 *   そのために置かれていた `"<table> anon select_for_upsert"` (FOR SELECT TO anon USING (true))
 *   が mirror 全行を anon key へ露出させていたため。
 *   書き込み先 table は kind から server 側の固定 map が解決する（client は table 名を送らない）。
 *
 *   ★ `client_unavailable` は本経路では発生しない（browser Supabase client を使わないため）。
 *     mirror_events への観測書き込みだけは従来どおり browser client を使う。
 *
 * Skip / failure mapping used here (subset; see mirror_observability.md):
 *   - `unsupported_environment` — invoked outside a browser context.
 *   - `missing_env`             — Supabase env vars not configured.
 *   - `client_unavailable`      — boundary failed to construct a client.
 *   - `network_error`           — upstream returned a PostgREST error.
 *   - `unknown`                 — any thrown exception during the attempt.
 */

import { isSupabaseEnvAvailable } from "./env";
import { postMirror } from "./mirrorTransport";
import { isMirrorRuntimeEnabled } from "./mirrorConfig";
import { finalize } from "./mirrorFinalize";
import { shouldSkipMirror } from "./mirrorGuard";
import { incrementMirrorMetric } from "./mirrorMetrics";
import { mirrorFailed, mirrorSkipped, mirrorSuccess } from "./mirrorResult";
import type { MirrorResult } from "./mirrorTypes";

const MIRROR_FEATURE = "studentProfile";

// 書き込み先は kind でのみ指定する。table 名の解決は server 側
// (lib/mirrors/mirrorKinds.ts の固定 map) が単独で行う。
const MIRROR_KIND = "studentProfile" as const;

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

  try {
    // 書き込みは server route 経由（anon の直接 upsert は廃止）。
    const result = await postMirror({
      kind: MIRROR_KIND,
      sourceHash: input.sourceHash,
      schemaVersion: input.schemaVersion,
      payload: input.payload,
    });

    if (!result.ok) {
      return finalize(
        MIRROR_FEATURE,
        mirrorFailed("network_error", result.code),
        meta,
      );
    }

    return finalize(MIRROR_FEATURE, mirrorSuccess(), meta);
  } catch (err) {
    const code = err instanceof Error ? err.name : "unknown";
    return finalize(MIRROR_FEATURE, mirrorFailed("unknown", code), meta);
  }
}
