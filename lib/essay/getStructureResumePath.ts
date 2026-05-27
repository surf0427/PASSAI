// /essay/structure 系の resume 判定 helper（Phase 2 STEP K 新規）。
//
// 役割:
//   workspace の状態から「次に進むべき step」「resume URL」「step ラベル」を
//   1 関数で導く。エントリ page（/essay/structure）の一覧 + クリック先決定で使う。
//
// step 判定優先順位（仕様確定済み）:
//   1. reviews.length > 0       → 'reviewed'（完了）
//   2. target が全部空           → 'target'
//   3. theme.text が空           → 'theme'
//   4. mini が全部空             → 'mini'
//   5. sparring === null         → 'sparring'
//   6. body が空                 → 'body'
//   7. それ以外（全部埋まっているが reviews 0） → 'body'（採点待ち）

import type { EssayWorkspace } from '@/types/essay';

export type StructureStep =
  | 'target'
  | 'theme'
  | 'mini'
  | 'sparring'
  | 'body'
  | 'reviewed';

// 次に進むべき step を返す。/essay/structure の resume 用。
export function getStructureResumeStep(workspace: EssayWorkspace): StructureStep {
  if (workspace.reviews.length > 0) return 'reviewed';

  const t = workspace.target;
  const hasTarget =
    t.university.trim() !== '' ||
    t.faculty.trim() !== '' ||
    t.department.trim() !== '';
  if (!hasTarget) return 'target';

  if (workspace.theme.text.trim() === '') return 'theme';

  const m = workspace.mini;
  const hasMini =
    m.conclusion.trim() !== '' ||
    m.reasonOne.trim() !== '' ||
    m.reasonTwo.trim() !== '';
  if (!hasMini) return 'mini';

  if (workspace.sparring === null) return 'sparring';

  // body 空でも全部埋まっていれば 'body'。
  // body 埋まっていても reviews 0 なら採点待ちなので 'body' に止める。
  return 'body';
}

// resume 先の URL。 reviewed 以外は /essay/structure/[wid]/{step} へ、
// reviewed は /essay/result/[wid] へ。
export function getStructureResumePath(workspace: EssayWorkspace): string {
  const step = getStructureResumeStep(workspace);
  if (step === 'reviewed') return `/essay/result/${workspace.id}`;
  return `/essay/structure/${workspace.id}/${step}`;
}

// step → 日本語ラベル。一覧カードの badge 用。
const STEP_LABELS: Record<StructureStep, string> = {
  target: '志望校設定',
  theme: 'テーマ確認',
  mini: 'ミニ思考欄',
  sparring: 'AI壁打ち',
  body: '本文入力',
  reviewed: '添削済み',
};

export function getStructureStepLabel(step: StructureStep): string {
  return STEP_LABELS[step];
}

// resume step から「何ステップ完了したか」を導く（Phase 2 STEP P 新規）。
//   target が次なら 0、theme が次なら 1（target 完了）、…、reviewed なら 5（全完了）。
// 一覧カードの progress dots / "N / 5" 表示に使う。
const STRUCTURE_STEP_COMPLETED_COUNT: Record<StructureStep, number> = {
  target: 0,
  theme: 1,
  mini: 2,
  sparring: 3,
  body: 4,
  reviewed: 5,
};

export const STRUCTURE_TOTAL_STEPS = 5;

export function getStructureProgress(workspace: EssayWorkspace): {
  completed: number;
  total: number;
} {
  const step = getStructureResumeStep(workspace);
  return {
    completed: STRUCTURE_STEP_COMPLETED_COUNT[step],
    total: STRUCTURE_TOTAL_STEPS,
  };
}

// 「途中の小論文」一覧フィルタ判定。
//   - reviews.length > 0           → false（完了済み、別経路で扱う）
//   - structure 系フィールドが全部空 → false（生成直後 / ghost）
//   - それ以外                     → true
//
// 「target が prefill されているだけ（user が触っていない）」状態は
// 形式的には true になる。entry 経由でユーザーが意図的に作成したもののため許容する。
export function isStructureInProgress(workspace: EssayWorkspace): boolean {
  if (workspace.reviews.length > 0) return false;
  const t = workspace.target;
  const m = workspace.mini;
  return (
    t.university.trim() !== '' ||
    t.faculty.trim() !== '' ||
    t.department.trim() !== '' ||
    t.examType.trim() !== '' ||
    workspace.theme.text.trim() !== '' ||
    m.conclusion.trim() !== '' ||
    m.reasonOne.trim() !== '' ||
    m.reasonTwo.trim() !== '' ||
    workspace.body.trim() !== '' ||
    workspace.sparring !== null
  );
}
