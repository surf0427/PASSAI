/**
 * Tiny constructors for `MirrorResult` variants.
 *
 * Purely wrap the unions defined in `./mirrorTypes`. No runtime, no Supabase
 * client, no `process.env`, no logging side effects. Future mirror helpers
 * use these to build their return value so the shape stays consistent.
 *
 * See: ./mirrorTypes.ts, docs/supabase/mirror_observability.md §7 / §8 / §9.
 */

import type {
  MirrorFailed,
  MirrorFailureReason,
  MirrorSkipReason,
  MirrorSkipped,
  MirrorSuccess,
} from "./mirrorTypes";

export function mirrorSuccess(): MirrorSuccess {
  return { status: "success" };
}

export function mirrorSkipped(reason: MirrorSkipReason): MirrorSkipped {
  return { status: "skipped", reason };
}

export function mirrorFailed(
  reason: MirrorFailureReason,
  message?: string,
): MirrorFailed {
  return message === undefined
    ? { status: "failed", reason }
    : { status: "failed", reason, message };
}
