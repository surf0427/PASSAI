// 出願条件 eligibility 判定（pure helper / 副作用なし / UI 非依存）。
//
// 役割:
//   大学DB（universityEntries）の評定条件と、ユーザーの basicInfo
//   （overallGpa / subjectGrades）を照合し EligibilityResult を返す。
//   AO/推薦の適性スコア (lib/matching/calculateScore.ts) とは別レーンで動く。
//
// MVP スコープ:
//   - overallGpa ↔ entry.gpa_required
//   - subjectGrades.english ↔ entry.gpa_english
//   他科目（国語/数学/理科/社会）は DB 側 `不明` が支配的なため次STEPで追加。
//   欠席日数は DB に構造化フィールドが無いため判定しない。
//
// 設計方針:
//   - data/ は直接 import しない。型は @/lib/universities 経由で受ける。
//   - lib/matching/calculateScore.ts / deriveStudentAnalysis.ts / toBasicInfo.ts には触れない。
//   - MatchingResult の shape を変えない（cache 互換を保つ）。consumer 側で別 state として持つ前提。
//   - CSV の値揺れ（"3.8" / "4" / "なし" / "不明" / "" / "履修要件あり"）に耐える safe parse。

import type { BasicInfo } from '@/types/basicInfo';
import type { UniversityEntry } from '@/lib/universities';
import type {
  EligibilityCheckItem,
  EligibilityResult,
  EligibilityStatus,
} from '@/types/matching';

// DB 値の特殊 token。
const NO_REQUIREMENT_TOKEN = 'なし';
const UNKNOWN_TOKENS = new Set(['', '不明', '記載なし', '要項確認']);

// parseGpaRequired の戻り値 discriminated union（内部利用）。
type RequiredParse =
  | { kind: 'numeric'; value: number }
  | { kind: 'none' }          // 条件なし
  | { kind: 'unknown' }       // DB 未整備
  | { kind: 'non_numeric' };  // 数値以外の制約（履修要件あり 等）

// DB の評定条件 raw 値を分類する。
// "3.8"   → { kind: 'numeric', value: 3.8 }
// "4"     → { kind: 'numeric', value: 4 }
// "なし"  → { kind: 'none' }
// ""      → { kind: 'unknown' }
// "不明"  → { kind: 'unknown' }
// "履修要件あり" → { kind: 'non_numeric' }
export function parseGpaRequired(raw: string | undefined): RequiredParse {
  const trimmed = (raw ?? '').trim();
  if (trimmed === NO_REQUIREMENT_TOKEN) return { kind: 'none' };
  if (UNKNOWN_TOKENS.has(trimmed)) return { kind: 'unknown' };
  const n = Number(trimmed);
  if (Number.isFinite(n)) return { kind: 'numeric', value: n };
  return { kind: 'non_numeric' };
}

// ユーザー入力（string optional）を number | null に safe parse する。
// 空文字 / undefined / 数値化失敗 → null。
export function parseUserGpa(raw: string | undefined): number | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// 1 項目の EligibilityStatus を決める pure 判定。
// 「断定しない」UX 要件は呼び出し側の UI 表現で扱う。ここはルール忠実に分類する。
export function classifyEligibility(
  userValue: number | null,
  required: RequiredParse,
): EligibilityStatus {
  if (required.kind === 'none') return 'eligible';
  if (required.kind === 'unknown') return 'insufficient_db_data';
  if (required.kind === 'non_numeric') return 'needs_confirmation';
  if (userValue === null) return 'insufficient_user_data';
  return userValue >= required.value ? 'eligible' : 'not_eligible';
}

// 1 項目を組み立てる internal helper。
function buildItem(
  label: EligibilityCheckItem['label'],
  userValue: number | null,
  rawRequired: string | undefined,
): EligibilityCheckItem {
  const parsed = parseGpaRequired(rawRequired);
  const status = classifyEligibility(userValue, parsed);
  const requiredValue = parsed.kind === 'numeric' ? parsed.value : null;
  return {
    label,
    userValue,
    requiredValue,
    rawRequired: (rawRequired ?? '').trim(),
    status,
  };
}

// 「最も保守的」な状態を返す（厳しい順）:
//   not_eligible > needs_confirmation > insufficient_user_data
//   > insufficient_db_data > likely_eligible > eligible
const STATUS_PRIORITY: Record<EligibilityStatus, number> = {
  not_eligible: 6,
  needs_confirmation: 5,
  insufficient_user_data: 4,
  insufficient_db_data: 3,
  likely_eligible: 2,
  eligible: 1,
};

function pickWorst(statuses: EligibilityStatus[]): EligibilityStatus {
  if (statuses.length === 0) return 'insufficient_db_data';
  return statuses.reduce((worst, cur) =>
    STATUS_PRIORITY[cur] > STATUS_PRIORITY[worst] ? cur : worst,
  );
}

// decisive（eligible / not_eligible）の比率で粗く confidence を決める。
function pickConfidence(items: EligibilityCheckItem[]): 'high' | 'medium' | 'low' {
  if (items.length === 0) return 'low';
  const decisive = items.filter(
    (i) => i.status === 'eligible' || i.status === 'not_eligible',
  ).length;
  const ratio = decisive / items.length;
  if (ratio >= 0.5) return 'high';
  if (ratio > 0) return 'medium';
  return 'low';
}

// 1 entry（= 1 入試方式）に対する eligibility 判定。
export function checkEligibilityForEntry(
  basicInfo: BasicInfo,
  entry: UniversityEntry,
): EligibilityResult {
  const items: EligibilityCheckItem[] = [
    buildItem('評定平均', parseUserGpa(basicInfo.overallGpa), entry.gpa_required),
    buildItem('英語評定', parseUserGpa(basicInfo.subjectGrades?.english), entry.gpa_english),
  ];

  // gpa_subject_notes（free text 補足）は freeTextNotes に格納し、
  // 「数値は満たすが補足条件あり」として eligible → likely_eligible に降格する。
  const freeTextNotes: string[] = [];
  const subjectNotes = (entry.gpa_subject_notes ?? '').trim();
  if (subjectNotes !== '' && !UNKNOWN_TOKENS.has(subjectNotes)) {
    freeTextNotes.push(subjectNotes);
    for (const item of items) {
      if (item.status === 'eligible') {
        item.status = 'likely_eligible';
        item.note = subjectNotes;
      }
    }
  }

  return {
    overallStatus: pickWorst(items.map((i) => i.status)),
    items,
    freeTextNotes,
    confidence: pickConfidence(items),
  };
}

// 複数 entry（1 大学に複数入試方式が存在するケース）の利便関数。
// 順序は入力順を保持する。
export function checkEligibility(
  basicInfo: BasicInfo,
  entries: UniversityEntry[],
): EligibilityResult[] {
  return entries.map((entry) => checkEligibilityForEntry(basicInfo, entry));
}
