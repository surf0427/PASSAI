import type { University } from '@/types/matching';
import { universities } from '@/data/universities';
import { universityEntries, type UniversityEntry } from '@/data/universityEntries';
import { selectionSteps, type SelectionStep } from '@/data/selectionSteps';

// 境界経由で row 型を消費できるよう re-export。
// 他 lib（lib/matching/checkEligibility 等）は data/ ではなく @/lib/universities から
// この型を import すること（data/ 直 import 禁止ルールの遵守）。
export type { UniversityEntry } from '@/data/universityEntries';

// 大学DBの唯一の読み取り境界。
// - page / route / 他 lib は data/ 配下を直接 import しない
// - getAllUniversities は matching 機能（全件参照の例外）専用
// - findUniversityEntriesByUserChoices / getSelectionStepsByEntryId は
//   ユーザー入力に紐づく分だけを取得する deterministic な検索 helper
// - Supabase 移行時はこのファイルの中身だけを差し替える
//
// 詳細ルール: docs/principles/university_database_usage_guide.md および
// lib/README.md の「大学DB」セクションを参照。
//
// 将来追加予定（名前のみ予約。消費者が出た段階で 1 つずつ追加。空関数や型は作らない）:
//   buildStatementUniversityContext / buildInterviewUniversityContext /
//   buildEssayUniversityContext / buildSelfAnalysisUniversityContext /
//   buildMatchingUniversityContext

export function getAllUniversities(): University[] {
  return universities;
}

// ユーザー入力（大学名・学部・学科）に完全一致する universityEntries を抽出する。
// - university が空欄なら [] を返す
// - faculty / department が空欄ならその絞り込みは行わない
// - 完全一致のみ。fuzzy / alias は今期対応しない
// - 複数候補は自動で 1 件に絞らずそのまま返す
// - entry_id が空欄の行も除外しない（CSV のまま）
export function findUniversityEntriesByUserChoices(input: {
  university: string;
  faculty?: string;
  department?: string;
}): UniversityEntry[] {
  const university = (input.university ?? '').trim();
  if (university === '') return [];

  const faculty = (input.faculty ?? '').trim();
  const department = (input.department ?? '').trim();

  return universityEntries.filter((entry) => {
    if (entry.university_name !== university) return false;
    if (faculty && entry.faculty !== faculty) return false;
    if (department && entry.department !== department) return false;
    return true;
  });
}

// step_no を sort key 用の数値に変換。空欄 / 非数値は末尾に寄せる。
function stepNoOrder(stepNo: string): number {
  const trimmed = stepNo.trim();
  if (trimmed === '') return Number.MAX_SAFE_INTEGER;
  const n = Number(trimmed);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

// 指定された entry_id に紐づく selectionSteps を step_no 昇順で返す。
// - entryId が空文字なら []
// - 完全一致のみ
// - step_no が数値化できない / 空欄の場合は末尾に寄せる
// - 値の正規化は行わない
export function getSelectionStepsByEntryId(entryId: string): SelectionStep[] {
  if (entryId === '') return [];
  return selectionSteps
    .filter((step) => step.entry_id === entryId)
    .sort((a, b) => stepNoOrder(a.step_no) - stepNoOrder(b.step_no));
}
