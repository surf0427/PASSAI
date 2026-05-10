// 自己分析 AI に渡す UniversityContext を enrich するための純関数。
//
// statement / interview / essay の context builder と異なり、
// 戻り値は string ではなく Partial<UniversityContext>。
// 既存の buildUniversityContextFromBasicInfo の戻り値に
// spread merge する形で利用される想定。
//
// 思想:
//   「大学に合わせて人格を作る」ためではなく、
//   「本人の経験のうち大学と自然接続できる観点を見つけやすくする」
//   ための補助情報を返す。
//
// - 対象 selection_type は "書類" / "面接" / "小論文" の 3 種。
//   "筆記試験" / "実技" は自己分析の文脈に寄与しないため除外。
// - 各フィールドに件数上限を設ける（人格誘導防止 / prompt 膨張防止）:
//     admissionPolicy:      最大 3 件 → "\n" 結合で 1 つの文字列にする
//     preferredExperiences: 最大 5 件
//     preferredTraits:      最大 3 件
// - 空欄 / "不明" / "なし" は除外
// - 該当データが無い場合は {} を返す（DB 未登録 / 情報なしの文言は返さない）
// - 大学DB全件を AI に渡さない。matching 以外で全件参照は禁止
//
// 詳細ルール: docs/principles/university_database_usage_guide.md 参照。

import type { UniversityContext } from '@/types/universityContext';
import {
  findUniversityEntriesByUserChoices,
  getSelectionStepsByEntryId,
} from '@/lib/universities';

// 自己分析で集約する selection_type。書類・面接・小論文の 3 種のみ。
const TARGET_SELECTION_TYPES = new Set(['書類', '面接', '小論文']);

// 件数上限（人格誘導防止 / prompt 膨張防止 / token コスト抑制）。
const MAX_ADMISSION_POLICY = 3;
const MAX_PREFERRED_EXPERIENCES = 5;
const MAX_PREFERRED_TRAITS = 3;

// AI prompt に渡す価値のある値か。空欄 / "不明" / "なし" は除外。
function isMeaningfulValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (trimmed === '不明') return false;
  if (trimmed === 'なし') return false;
  return true;
}

// 入力配列から有意でない値を除外し、trim した上で重複削除（順序保持）。
function uniqueMeaningful(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values) {
    if (!isMeaningfulValue(v)) continue;
    const trimmed = v.trim();
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

// 件数上限を適用（先頭から N 件）。order は uniqueMeaningful 由来で安定。
function limitValues(values: string[], max: number): string[] {
  return values.slice(0, max);
}

export function buildSelfAnalysisUniversityContext(input: {
  university: string;
  faculty?: string;
  department?: string;
}): Partial<UniversityContext> {
  const entries = findUniversityEntriesByUserChoices(input);
  if (entries.length === 0) return {};

  // 対象 selection_type の step のみを集める
  const targetSteps = entries.flatMap((e) =>
    getSelectionStepsByEntryId(e.entry_id).filter((s) =>
      TARGET_SELECTION_TYPES.has(s.selection_type),
    ),
  );

  // ── 集約 ────────────────────────────────────────────
  const admissionPolicies = limitValues(
    uniqueMeaningful(targetSteps.map((s) => s.admission_policy)),
    MAX_ADMISSION_POLICY,
  );
  const preferredExperiences = limitValues(
    uniqueMeaningful(targetSteps.map((s) => s.evaluation_points)),
    MAX_PREFERRED_EXPERIENCES,
  );
  const preferredTraits = limitValues(
    uniqueMeaningful(targetSteps.map((s) => s.ai_strategy_hint)),
    MAX_PREFERRED_TRAITS,
  );

  // ── 出力組み立て ────────────────────────────────────
  // 各フィールドは値があるときだけ載せる（既存 prompt section の
  // optional 行省略挙動を活かすため、未設定は undefined のままにする）。
  const enrichment: Partial<UniversityContext> = {};

  if (admissionPolicies.length > 0) {
    // UniversityContext.admissionPolicy は string 型。複数 step を集約するため "\n" で結合。
    enrichment.admissionPolicy = admissionPolicies.join('\n');
  }
  if (preferredExperiences.length > 0) {
    enrichment.preferredExperiences = preferredExperiences;
  }
  if (preferredTraits.length > 0) {
    enrichment.preferredTraits = preferredTraits;
  }

  return enrichment;
}
