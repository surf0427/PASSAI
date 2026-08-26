/**
 * Best-effort basicInfo mirror — Phase1 boundary helper.
 *
 * Loaded lazily at runtime via `import()` from
 * `lib/basicInfoStorage.ts:saveBasicInfo()` after a successful canonical
 * localStorage write. The dynamic import is what keeps the browser-only
 * Supabase client out of server route bundles — this file statically
 * imports the observability sink chain, so it must remain
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
 * sourceHash strategy:
 *   Unlike `studentProfile.sourceHash` (which is computed by the canonical
 *   pipeline at `lib/studentProfile.ts`), basicInfo has no sourceHash on its
 *   canonical type. This file derives `source_hash` at write time via
 *   `sha256(JSON.stringify(payloadWithoutName) + SCHEMA_VERSION)`.
 *   Keeping the derivation here avoids polluting `BasicInfo` with a
 *   Phase1-specific field that would ripple into 8 readers and the AI
 *   input hash (`lib/aiInputHash.ts`).
 */

import { postMirror } from "./mirrorTransport";
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
// 書き込み先は kind でのみ指定する。table 名の解決は server 側
// (lib/mirrors/mirrorKinds.ts の固定 map) が単独で行う。
const MIRROR_KIND = "basicInfo" as const;

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

  try {
    const payloadWithoutName = stripName(input.payload);
    const sourceHash = await sha256Hex(
      JSON.stringify(payloadWithoutName) + SCHEMA_VERSION,
    );

    // 書き込みは server route 経由（anon の直接 upsert は廃止）。
    const result = await postMirror({
      kind: MIRROR_KIND,
      sourceHash,
      schemaVersion: SCHEMA_VERSION,
      payload: payloadWithoutName,
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
