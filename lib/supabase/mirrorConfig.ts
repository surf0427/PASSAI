/**
 * Mirror runtime configuration — global kill-switch.
 *
 * One env-driven flag, evaluated once and cached. The kill-switch is the
 * *only* config surface exposed from this file; feature-level / per-call
 * gating belongs in `./mirrorGuard.ts`.
 *
 * Env var:
 *   `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED`
 *     - `"true"` / `"1"` / `"yes"` (case-insensitive, trimmed) → switch is ON
 *       → `isMirrorRuntimeEnabled()` returns `false`.
 *     - anything else (including unset / empty / unknown values) → switch is
 *       OFF → `isMirrorRuntimeEnabled()` returns `true`.
 *
 * Default-safe choice: when the env var is absent, mirror is **enabled**, so
 * existing deployments that already wired `NEXT_PUBLIC_SUPABASE_*` keep
 * behaving as before. The kill-switch is opt-in disable, not opt-in enable
 * — operators flip it to silence mirror without code changes.
 *
 * Phase1 contract:
 *   - No feature-specific logic.
 *   - No I/O, no logging, no throws.
 *   - Sole reader of `process.env.NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED` —
 *     keeps env access centralised per docs/supabase/client_boundary.md §7.
 */

const DISABLED_VALUES: ReadonlySet<string> = new Set(["true", "1", "yes"]);

let cachedEnabled: boolean | undefined;

function readKillSwitchActive(): boolean {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED;
  if (typeof raw !== "string") return false;
  return DISABLED_VALUES.has(raw.trim().toLowerCase());
}

export function isMirrorRuntimeEnabled(): boolean {
  if (cachedEnabled === undefined) cachedEnabled = !readKillSwitchActive();
  return cachedEnabled;
}
