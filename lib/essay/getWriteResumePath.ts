// /essay/write 系の resume 判定 helper（Phase 2 STEP O 新規）。
//
// 役割:
//   write フロー（target → theme → body → review）の resume 判定。
//   structure フローと違って mini / sparring を持たない。
//
// step 判定優先順位:
//   1. reviews.length > 0    → 'reviewed'
//   2. target が全部空        → 'target'
//   3. theme.text が空        → 'theme'
//   4. それ以外               → 'body'
//
// structure entry との重複表示を避ける設計（isWriteInProgress 内コメント参照）:
//   - mini OR sparring が埋まっている workspace は structure 経路と見做して除外
//   - target / theme だけ埋まっているが body が空のものも除外（structure 開始の可能性）
//   - body に content がある純 write workspace のみリスト表示

import type { EssayWorkspace } from '@/types/essay';

export type WriteStep = 'target' | 'theme' | 'body' | 'reviewed';

export function getWriteResumeStep(workspace: EssayWorkspace): WriteStep {
  if (workspace.reviews.length > 0) return 'reviewed';

  const t = workspace.target;
  const hasTarget =
    t.university.trim() !== '' ||
    t.faculty.trim() !== '' ||
    t.department.trim() !== '';
  if (!hasTarget) return 'target';

  if (workspace.theme.text.trim() === '') return 'theme';

  return 'body';
}

export function getWriteResumePath(workspace: EssayWorkspace): string {
  const step = getWriteResumeStep(workspace);
  if (step === 'reviewed') return `/essay/result/${workspace.id}`;
  return `/essay/write/${workspace.id}/${step}`;
}

const STEP_LABELS: Record<WriteStep, string> = {
  target: '志望校設定',
  theme: 'テーマ確認',
  body: '本文入力',
  reviewed: '添削済み',
};

export function getWriteStepLabel(step: WriteStep): string {
  return STEP_LABELS[step];
}

// resume step から「何ステップ完了したか」を導く（Phase 2 STEP P 新規）。
// write は target / theme / body の 3 ステップ（structure と独立カウント）。
const WRITE_STEP_COMPLETED_COUNT: Record<WriteStep, number> = {
  target: 0,
  theme: 1,
  body: 2,
  reviewed: 3,
};

export const WRITE_TOTAL_STEPS = 3;

export function getWriteProgress(workspace: EssayWorkspace): {
  completed: number;
  total: number;
} {
  const step = getWriteResumeStep(workspace);
  return {
    completed: WRITE_STEP_COMPLETED_COUNT[step],
    total: WRITE_TOTAL_STEPS,
  };
}

// /essay/write entry の「途中の小論文」一覧フィルタ判定。
//
// 判定条件:
//   - reviews.length === 0
//   - mini が全部空（mini が埋まっていれば structure 経路）
//   - sparring === null（sparring セッションがあれば structure 経路）
//   - body に content あり（body が空なら target/theme だけの不確定状態）
//
// この絞り込みで、structure entry と write entry の表示が
// 構造的に排他になる（同 workspace が両方に出ない）。
export function isWriteInProgress(workspace: EssayWorkspace): boolean {
  if (workspace.reviews.length > 0) return false;

  const m = workspace.mini;
  const hasMini =
    m.conclusion.trim() !== '' ||
    m.reasonOne.trim() !== '' ||
    m.reasonTwo.trim() !== '';
  if (hasMini) return false;
  if (workspace.sparring !== null) return false;

  return workspace.body.trim() !== '';
}
