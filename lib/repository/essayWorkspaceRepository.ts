'use client';

// 小論文 essayWorkspace repository layer（orchestration 層）。
//
// 位置づけ（statementReviewHistoryRepository.ts と同じ 3 層構造の横展開）:
//   UI / essay ページ
//     ↓
//   lib/essayWorkspaceStorage.ts            … LS canonical（key='essayWorkspaces'）
//     ↓
//   lib/repository/essayWorkspaceRepository.ts … 本ファイル。orchestration（いつ / 何件 / 冪等 / flag / debounce）
//     ↓ 委譲
//   lib/supabase/essayWorkspaces.ts         … DB 境界（SQL / snake_case 翻訳 / RLS / best-effort）
//     ↓
//   Supabase（essay_workspaces）
//
// 本層の責務:
//   1. mirrorEssayWorkspaceOnce  … 1 件 mirror の単一 entry point（冪等 upsert へ委譲）。
//   2. backfillEssayWorkspacesOnce … 初回一括 LS → SB 同期（上りのみ・flag で 1 回限り）。
//   3. registerEssayWorkspaceMirror … storage の mirror hook を登録し、全 upsert を
//      debounce して mirror する（dualWrite）。保存状態を essayMirrorStatus に publish。
//
// 設計方針:
//   - localStorage canonical は維持。Supabase は durable mirror（best-effort）。
//   - never throw。委譲先（DB 境界）が best-effort なので本層もそれを受ける。
//   - userId が空 / browser でない場合は no-op。
//   - 上り mirror only（delete / 10 件 cap eviction は DB に伝播しない。restore は別 STEP）。
//
// boundary 安全:
//   委譲先 lib/supabase/essayWorkspaces.ts は "use client"（browserClient 依存）。本ファイルも
//   "use client" を宣言し、server bundle に browser client を引き込まないことを明示する。

import {
  upsertEssayWorkspaceToSupabase,
  type UpsertEssayWorkspaceResult,
} from '@/lib/supabase/essayWorkspaces';
import {
  loadEssayWorkspaces,
  setEssayWorkspaceMirrorHook,
} from '@/lib/essayWorkspaceStorage';
import { setEssayMirrorStatus } from '@/lib/essay/essayMirrorStatus';
import type { EssayWorkspace } from '@/types/essay';
import { backfillDone, markBackfillDone } from './backfillFlag';

/**
 * 1 件の EssayWorkspace を Supabase durable mirror に upsert する単一 entry point。
 *
 * - natural key (user_id, local_workspace_id) の冪等 upsert に委譲する。
 *   EssayWorkspace は可変なので、同一 id の再 mirror は最新の workspace 全体で上書きする。
 * - 上り方向のみ（delete / eviction は伝播しない）。
 * - userId が空なら no-op（no-env 扱い）。委譲先が best-effort（never throw）。
 */
export async function mirrorEssayWorkspaceOnce(args: {
  userId: string;
  workspace: EssayWorkspace;
}): Promise<UpsertEssayWorkspaceResult> {
  if (!args.userId) return { kind: 'no-env' };
  return upsertEssayWorkspaceToSupabase({
    userId: args.userId,
    workspace: args.workspace,
  });
}

// ── backfill（初回一括 LS → SB） ────────────────────────────────────

/**
 * 現在の localStorage の essayWorkspaces を Supabase へ一括同期する（初回 1 回）。
 *
 * 背景:
 *   dualWrite（registerEssayWorkspaceMirror）は登録後の保存のみを mirror するため、
 *   登録前に蓄積された既存 workspace は Supabase に上がらない。その欠落を backfill が埋める
 *   （backfillStatementReviewHistoryOnce と同趣旨）。
 *
 * 設計（statement / selfPRs と同形 — id natural key / 上りのみ / restore なし）:
 *   - userId が無ければ no-op。browser でなければ no-op（SSR で localStorage を読まない）。
 *   - flag（backfillFlag.ts, feature='essayWorkspaces'）で完了済みなら skip。
 *   - localStorage が 0 件なら no-op（flag は立てない。次回も安価に再判定するだけ）。
 *   - 各 workspace を冪等 helper mirrorEssayWorkspaceOnce で upsert。natural key
 *     (user_id, local_workspace_id) の onConflict なので、後続 dualWrite と衝突しない。
 *   - never throw（失敗は devWarn で握り潰す best-effort）。逐次 await でも 1 件の失敗で
 *     全体は落ちない。
 *   - 全件 upsert 後に flag を立てる。flag は最適化であり冪等 upsert なので再実行も無害。
 *
 * 上り mirror only（重要）:
 *   - DB → LS restore はしない。LS の 10 件 cap を DB に反映しない（DB は durable 保持）。
 *   - delete / eviction を DB delete として扱わない。
 */
export async function backfillEssayWorkspacesOnce(args: {
  userId: string;
}): Promise<void> {
  const { userId } = args;
  if (!userId) return;
  if (typeof window === 'undefined') return; // SSR では LS を読まない
  if (backfillDone(userId, 'essayWorkspaces')) return;

  const workspaces = loadEssayWorkspaces();
  if (workspaces.length === 0) return; // 0 件 → no-op（flag は立てない）

  // 1 件でも error なら flag を立てない（次回ログインで再試行させる）。
  // 背景: テーブル未作成 / RLS / 一時的な通信失敗の最中に backfill が走ると、
  //   従来の「結果を見ず markBackfillDone」では flag が立って既存 workspace が
  //   永久に同期されなくなる。全件成功（no-env も同期不要として成功扱い）の
  //   ときだけ flag を立て、error が混じれば次回再試行できるようにする。
  // 注: no-env（Supabase 未設定）は「同期先が無い」状態で error ではない。
  //   この場合に flag を立てておけば、env 設定後の再ログインでは再試行されないが、
  //   その後の編集は dualWrite で個別に上がる。ここでは error のみを再試行条件とする。
  let hadError = false;
  for (const workspace of workspaces) {
    const result = await mirrorEssayWorkspaceOnce({ userId, workspace });
    if (result.kind === 'error') hadError = true;
  }

  if (hadError) return; // error 混在 → flag を立てず次回再試行
  markBackfillDone(userId, 'essayWorkspaces');
}

// ── dualWrite（保存ごとの mirror。debounce + UI status） ─────────────────

// 直近に変更された workspace を id 単位で集約する。debounce window 内の連続 autosave
// （キーストローク等）を 1 回の flush にまとめ、毎打鍵での upsert を避ける。
const pending = new Map<string, EssayWorkspace>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let registeredUserId: string | null = null;
let flushing = false;

const DEBOUNCE_MS = 1500;

function scheduleFlush(): void {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPending();
  }, DEBOUNCE_MS);
}

async function flushPending(): Promise<void> {
  if (flushing) {
    // 実行中に新規変更が来た場合に備え、完了後 pending が残っていれば再 schedule する。
    scheduleFlush();
    return;
  }
  const userId = registeredUserId;
  if (!userId) {
    pending.clear();
    return;
  }
  if (pending.size === 0) return;

  flushing = true;
  setEssayMirrorStatus('saving');

  const batch = [...pending.values()];
  pending.clear();

  let anyError = false;
  let anyOk = false;
  let anyNoEnv = false;
  for (const workspace of batch) {
    const result = await mirrorEssayWorkspaceOnce({ userId, workspace });
    if (result.kind === 'error') anyError = true;
    else if (result.kind === 'ok') anyOk = true;
    else if (result.kind === 'no-env') anyNoEnv = true;
  }

  flushing = false;

  if (anyError) {
    setEssayMirrorStatus('error');
  } else if (anyOk) {
    setEssayMirrorStatus('saved');
  } else if (anyNoEnv) {
    setEssayMirrorStatus('no-env');
  }

  // flush 中に積まれた pending があれば追従する。
  if (pending.size > 0) scheduleFlush();
}

/**
 * storage の mirror hook を登録し、以降の upsertEssayWorkspace を debounce で Supabase に
 * mirror する（dualWrite の配線）。AuthProvider から userId 確定後に 1 回呼ぶ。
 *
 * - 全 essay ページの upsertEssayWorkspace（autosave 含む）を 1 箇所で捕捉するため、各ページに
 *   個別配線せず storage の hook 経由で集約する。hook は debounce され、連続 autosave は
 *   まとめて 1 回 upsert される。
 * - userId が変われば（再ログイン等）登録を張り替える。空 userId なら hook を解除して no-op。
 * - mirror 自体は best-effort（never throw）。失敗は essayMirrorStatus に 'error' を publish し、
 *   UI（EssayMirrorStatusBadge）が最低限の表示を行う。localStorage は canonical なので保存自体は
 *   完了している（端末には保存済み）。
 */
export function registerEssayWorkspaceMirror(userId: string): void {
  if (typeof window === 'undefined') return;

  if (!userId) {
    registeredUserId = null;
    setEssayWorkspaceMirrorHook(null);
    return;
  }

  registeredUserId = userId;
  setEssayWorkspaceMirrorHook((workspace) => {
    pending.set(workspace.id, workspace);
    scheduleFlush();
  });
}
