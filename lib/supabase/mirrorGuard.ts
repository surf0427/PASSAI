/**
 * Pure guard helpers for mirror gating.
 *
 * Two responsibilities:
 *   - `isMirrorEnabled(opts)` — is the mirror channel viable at all?
 *     (boundary-level: env present, feature flag on, kill-switch off)
 *   - `shouldSkipMirror(opts)` — should this specific attempt skip, and if
 *     so why? Returns a `MirrorSkipReason` or `null`.
 *
 * Both are **pure**: no `process.env`, no Supabase imports, no localStorage,
 * no feature-specific knowledge, no logging side effects. Callers must pass
 * the relevant context in. This file is the decision shape that future
 * mirror helpers depend on — not a place that reaches out to read state.
 *
 * Skip-reason priority order in `shouldSkipMirror` matches the canonical
 * taxonomy in docs/supabase/mirror_observability.md §9, with more global /
 * cheaper-to-check conditions evaluated first so an attempt short-circuits
 * before touching anything expensive.
 *
 * Phase1 status — **convergence point for the skip taxonomy.**
 * Every feature mirror (`mirrorStudentProfile`, `mirrorBasicInfo`, …) calls
 * `shouldSkipMirror({ killSwitchActive: !isMirrorRuntimeEnabled() })` so the
 * kill-switch → `MirrorSkipReason` mapping stays observable in one place.
 * The `typeof window === "undefined"` check stays inline at each mirror to
 * preserve the canonical skip-reason priority (window > killSwitch) — the
 * priority inside `shouldSkipMirror` is killSwitch-first, which would
 * (unobservably in practice, since mirror callers run in the browser) flip
 * the reported reason if both gates fired simultaneously.
 *
 * Feature-specific gates (`payloadEmpty`, `payloadUnchanged`, etc.) accepted
 * by `MirrorSkipContext` are reserved for **per-mirror local checks**, not a
 * mega-context push — callers pass only the fields they actually evaluate.
 */

import type { MirrorSkipReason } from "./mirrorTypes";

export type MirrorEnabledContext = {
  envAvailable: boolean;
  featureEnabled: boolean;
  killSwitchActive: boolean;
};

export function isMirrorEnabled(ctx: MirrorEnabledContext): boolean {
  return ctx.envAvailable && ctx.featureEnabled && !ctx.killSwitchActive;
}

export type MirrorSkipContext = {
  killSwitchActive?: boolean;
  featureEnabled?: boolean;
  supportedEnvironment?: boolean;
  hasUserContext?: boolean;
  payloadEmpty?: boolean;
  payloadUnchanged?: boolean;
};

export function shouldSkipMirror(ctx: MirrorSkipContext): MirrorSkipReason | null {
  if (ctx.killSwitchActive === true) return "mirror_disabled";
  if (ctx.featureEnabled === false) return "feature_not_enabled";
  if (ctx.supportedEnvironment === false) return "unsupported_environment";
  if (ctx.hasUserContext === false) return "no_user_context";
  if (ctx.payloadEmpty === true) return "empty_payload";
  if (ctx.payloadUnchanged === true) return "unchanged_payload";
  return null;
}
