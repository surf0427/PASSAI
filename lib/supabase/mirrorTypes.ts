/**
 * Supabase mirror result contract.
 *
 * Shape that every future best-effort mirror helper (`mirrorXxxToSupabase`,
 * `bestEffortMirrorXxx`) returns to its caller. Types only — there is no
 * runtime, no Supabase client import, and no table/entity knowledge here.
 *
 * Three result states (per task spec):
 *   - `success` — mirror write completed successfully.
 *   - `skipped` — mirror was intentionally not attempted (no-op). Carries a `reason`.
 *   - `failed`  — mirror was attempted and did not succeed. Carries a `reason`.
 *
 * Phase1 invariants this contract enforces structurally:
 *   - Every non-success outcome carries a discriminating `reason`. Callers /
 *     observability sinks can never see "failed without why" or "skipped
 *     without why".
 *   - "Disabled" (kill-switch / feature flag off) is representable as
 *     `skipped` with `reason: 'mirror_disabled'` or `'feature_not_enabled'`.
 *     The observability event taxonomy (mirror_observability.md §7) keeps
 *     `disabled` as a distinct status; the runtime-facing return type
 *     collapses both into "no write happened" — the sink layer will widen it
 *     back when emitting `mirror.attempt` events.
 *   - No throw paths. Mirror helpers must absorb errors and report them via
 *     `failed`. `MirrorResult` is the only thing they expose.
 *
 * Reason enums mirror the canonical taxonomy in
 * `docs/supabase/mirror_observability.md` §8 (failure) and §9 (skip).
 * Any change to these unions must update that doc first (doc-first rule).
 */

/**
 * Reasons a mirror attempt failed. Source: mirror_observability.md §8.
 *
 * - `missing_env`        — Supabase env not configured in the boundary.
 * - `client_unavailable` — boundary client could not be constructed / obtained.
 * - `network_error`      — DNS / TCP / TLS / timeout / fetch failure.
 * - `auth_unavailable`   — required user identity / token unavailable
 *                          (Phase1 generally skips instead; failure used only
 *                          when the helper explicitly required auth).
 * - `validation_error`   — payload failed validation (client- or server-side).
 * - `schema_mismatch`    — Supabase schema disagrees with the mirror payload.
 * - `rate_limited`       — upstream rate-limited the request.
 * - `unknown`            — uncategorised; keep ratio bounded per Phase1 exit
 *                          criteria.
 *
 * If multiple reasons apply, pick the most specific (e.g. `schema_mismatch`
 * over `validation_error`).
 */
export type MirrorFailureReason =
  | "missing_env"
  | "client_unavailable"
  | "network_error"
  | "auth_unavailable"
  | "validation_error"
  | "schema_mismatch"
  | "rate_limited"
  | "unknown";

/**
 * Reasons a mirror attempt was skipped (no-op). Source: mirror_observability.md §9.
 *
 * - `no_user_context`        — no user identity available (common in Phase1).
 * - `empty_payload`          — canonical state has nothing meaningful to mirror.
 * - `unchanged_payload`      — payload matches the last successful mirror
 *                              (idempotent dedup; high ratio is healthy).
 * - `feature_not_enabled`    — per-feature flag is off.
 * - `mirror_disabled`        — global kill-switch is on (per-call view).
 * - `unsupported_environment`— runtime context disallows mirror (e.g. SSR/RSC).
 */
export type MirrorSkipReason =
  | "no_user_context"
  | "empty_payload"
  | "unchanged_payload"
  | "feature_not_enabled"
  | "mirror_disabled"
  | "unsupported_environment";

export type MirrorSuccess = {
  status: "success";
};

export type MirrorSkipped = {
  status: "skipped";
  reason: MirrorSkipReason;
};

export type MirrorFailed = {
  status: "failed";
  reason: MirrorFailureReason;
  /**
   * Optional short diagnostic captured at the boundary (e.g. a normalized
   * error code or class name). MUST NOT contain PII or payload content
   * (mirror_observability.md §6).
   */
  message?: string;
};

export type MirrorResult = MirrorSuccess | MirrorSkipped | MirrorFailed;
