"use client";

/**
 * STEP-AUTH-02 / AUTH DEBUG FIX 01: profiles テーブルアクセス境界。
 *
 * - 所有者契約: 行 identity は常に `id = auth.uid()`。display_user_id は表示用。
 * - 失敗ハンドリング:
 *     - ensureProfile / loadProfile は失敗を握り潰さず discriminated result を返す。
 *     - saveDisplayUserId は元々 result 型なのでそのまま。
 *     - すべての失敗パスで devWarn を呼び、Console から根本原因を観測可能にする。
 */

import { devWarn } from "@/lib/devLog";
import { getBrowserSupabaseClient } from "./browserClient";
import { DEFAULT_PLAN, type Profile } from "@/types/profile";

const TABLE = "profiles";

type ProfileRow = {
  id: string;
  display_user_id: string | null;
  plan: string;
  created_at: string;
  updated_at: string;
};

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayUserId: row.display_user_id,
    plan: row.plan,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PROFILE_COLUMNS = "id, display_user_id, plan, created_at, updated_at";

export type LoadProfileResult =
  | { kind: "ok"; profile: Profile }
  | { kind: "not-found" }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

export type EnsureProfileResult =
  | { kind: "ok"; profile: Profile }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

/**
 * 自分の profile 行を SELECT する。
 */
export async function loadProfile(userId: string): Promise<LoadProfileResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return { kind: "no-env" };

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(PROFILE_COLUMNS)
      .eq("id", userId)
      .maybeSingle<ProfileRow>();
    if (error) {
      devWarn("[profile] loadProfile error", error);
      return { kind: "error", message: error.message ?? "load failed" };
    }
    if (!data) return { kind: "not-found" };
    return { kind: "ok", profile: toProfile(data) };
  } catch (err) {
    devWarn("[profile] loadProfile threw", err);
    const message = err instanceof Error ? err.message : "load threw";
    return { kind: "error", message };
  }
}

/**
 * profile 行が無ければ作成（idempotent）。
 * - id = userId
 * - plan = 'free'
 * - display_user_id = null
 */
export async function ensureProfile(
  userId: string,
): Promise<EnsureProfileResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return { kind: "no-env" };

  const initial = await loadProfile(userId);
  if (initial.kind === "ok") return { kind: "ok", profile: initial.profile };
  if (initial.kind === "no-env") return { kind: "no-env" };
  if (initial.kind === "error") {
    // SELECT が落ちている時点で INSERT も同じ理由で落ちる確率が高いが、
    // 一度だけ INSERT を試す（policy 設定が SELECT は不可 / INSERT は可など
    // 非対称になっている場合の最後のチャンス）。
    devWarn("[profile] ensureProfile load failed, trying insert anyway", initial.message);
  }

  try {
    const { error } = await supabase
      .from(TABLE)
      .insert({ id: userId, plan: DEFAULT_PLAN, display_user_id: null });
    if (error) {
      devWarn("[profile] ensureProfile insert error", error);
      // 並列タブで先に insert が通っているケースを救うため再 load。
      const reload = await loadProfile(userId);
      if (reload.kind === "ok") return { kind: "ok", profile: reload.profile };
      return {
        kind: "error",
        message: error.message ?? "profile insert failed",
      };
    }
  } catch (err) {
    devWarn("[profile] ensureProfile insert threw", err);
    const reload = await loadProfile(userId);
    if (reload.kind === "ok") return { kind: "ok", profile: reload.profile };
    const message = err instanceof Error ? err.message : "profile insert threw";
    return { kind: "error", message };
  }

  const after = await loadProfile(userId);
  if (after.kind === "ok") return { kind: "ok", profile: after.profile };
  if (after.kind === "no-env") return { kind: "no-env" };
  if (after.kind === "not-found") {
    return {
      kind: "error",
      message: "profile insert succeeded but row not visible (RLS?)",
    };
  }
  return { kind: "error", message: after.message };
}

/**
 * display_user_id が **他のユーザー** に取られていないかを確認する。
 * - 自分自身は重複扱いしない。
 * - 失敗時は false (fail-open)。最終防衛は UNIQUE 制約。
 */
export async function isDisplayUserIdTaken(input: {
  displayUserId: string;
  currentUserId: string;
}): Promise<boolean> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return false;

  try {
    const { count, error } = await supabase
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("display_user_id", input.displayUserId)
      .neq("id", input.currentUserId);
    if (error) {
      devWarn("[profile] isDisplayUserIdTaken error", error);
      return false;
    }
    return (count ?? 0) > 0;
  } catch (err) {
    devWarn("[profile] isDisplayUserIdTaken threw", err);
    return false;
  }
}

export type SaveDisplayUserIdResult =
  | { kind: "ok"; profile: Profile }
  | { kind: "duplicate" }
  | { kind: "error"; message: string };

/**
 * display_user_id を UPDATE する。
 * - バリデーションは呼び出し側責務。
 * - unique_violation (23505) を `duplicate` に翻訳。
 */
export async function saveDisplayUserId(input: {
  userId: string;
  displayUserId: string;
}): Promise<SaveDisplayUserIdResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) {
    return { kind: "error", message: "ストレージに接続できません。" };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .update({ display_user_id: input.displayUserId })
      .eq("id", input.userId)
      .select(PROFILE_COLUMNS)
      .maybeSingle<ProfileRow>();

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return { kind: "duplicate" };
      }
      devWarn("[profile] saveDisplayUserId error", error);
      return { kind: "error", message: error.message };
    }
    if (!data) {
      return { kind: "error", message: "プロフィールが見つかりませんでした。" };
    }
    return { kind: "ok", profile: toProfile(data) };
  } catch (err) {
    devWarn("[profile] saveDisplayUserId threw", err);
    const message = err instanceof Error ? err.message : "保存に失敗しました。";
    return { kind: "error", message };
  }
}
