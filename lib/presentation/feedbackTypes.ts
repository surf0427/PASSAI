/**
 * STEP-PRESENTATION-PR5: プレゼン AI 評価の JSON contract と normalize / type guard。
 *
 * 設計（docs/presentation/pr0_design.md §10.2 / principles/ai_score_contract.md）:
 *   - カテゴリ評価は weak | normal | strong の 3 値のみ。数値化しない＝数値整合事故が構造的に起きない。
 *   - AI 出力は本ファイルの normalizePresentationFeedback で server-side 正規化してから保存する。
 *     UI / cache は正規化後の値だけを参照する（AI の生値を直接バインドしない）。
 *   - 配列（goodPoints / improvements / nextPractice）は空禁止・2〜4 個（PRESENTATION_LIST_MIN/MAX）。
 *     条件を満たせない出力は PresentationFeedbackError を throw し、route 側で「保存も課金もしない」。
 */

import { PRESENTATION_LIST_MAX, PRESENTATION_LIST_MIN } from './constants';

export type PresentationLevel = 'weak' | 'normal' | 'strong';

export type PresentationCategoryKey =
  | 'composition'
  | 'persuasion'
  | 'concreteness'
  | 'clarity'
  | 'timeManagement'
  | 'completeness';

export type PresentationCategories = Record<
  PresentationCategoryKey,
  PresentationLevel
> & {
  // 資料が添付されている評価のみ付与（任意・後方互換）。STEP-PRESENTATION-MATERIAL。
  materialConsistency?: PresentationLevel;
};

export type PresentationFeedback = {
  categories: PresentationCategories;
  overallComment: string;
  goodPoints: string[];
  improvements: string[];
  nextPractice: string[];
  // 資料が添付されている評価のみ付与（任意・後方互換）。資料に関する改善提案。
  materialFeedback?: string[];
};

// normalize / 品質条件を満たせない AI 出力（route で 500 evaluate-failed に倒す。保存も課金もしない）。
export class PresentationFeedbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PresentationFeedbackError';
  }
}

export const PRESENTATION_CATEGORY_KEYS: readonly PresentationCategoryKey[] = [
  'composition',
  'persuasion',
  'concreteness',
  'clarity',
  'timeManagement',
  'completeness',
];

const LEVELS: readonly PresentationLevel[] = ['weak', 'normal', 'strong'];

function isLevel(v: unknown): v is PresentationLevel {
  return typeof v === 'string' && (LEVELS as readonly string[]).includes(v);
}

// 単一カテゴリの coercion。不正 / 欠落は安全側に 'normal' に倒す（カテゴリ欠落で全体を落とさない）。
function coerceLevel(v: unknown): PresentationLevel {
  return isLevel(v) ? v : 'normal';
}

// 配列を「空文字除去 + trim + 重複除去 + 最大件数 slice」した string[] にする。
function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= PRESENTATION_LIST_MAX) break;
  }
  return out;
}

/**
 * AI の生 JSON を PresentationFeedback に正規化する。
 *   - categories: 6 軸を coercion（不正は 'normal'）。
 *   - overallComment: 非空 string 必須（空なら throw）。
 *   - goodPoints / improvements / nextPractice: clean 後に >= PRESENTATION_LIST_MIN を必須（満たさねば throw）。
 * 品質条件を満たさない場合は PresentationFeedbackError を throw する（呼び出し側は保存も課金もしない）。
 */
export function normalizePresentationFeedback(
  raw: unknown,
  opts?: { hasMaterial?: boolean },
): PresentationFeedback {
  if (!raw || typeof raw !== 'object') {
    throw new PresentationFeedbackError('feedback-shape-invalid');
  }
  const obj = raw as Record<string, unknown>;

  const rawCats =
    obj.categories && typeof obj.categories === 'object'
      ? (obj.categories as Record<string, unknown>)
      : null;
  if (!rawCats) {
    throw new PresentationFeedbackError('feedback-categories-missing');
  }
  const categories = {} as PresentationCategories;
  for (const key of PRESENTATION_CATEGORY_KEYS) {
    categories[key] = coerceLevel(rawCats[key]);
  }

  const overallComment =
    typeof obj.overallComment === 'string' ? obj.overallComment.trim() : '';
  if (!overallComment) {
    throw new PresentationFeedbackError('feedback-overall-empty');
  }

  const goodPoints = cleanList(obj.goodPoints);
  const improvements = cleanList(obj.improvements);
  const nextPractice = cleanList(obj.nextPractice);
  if (
    goodPoints.length < PRESENTATION_LIST_MIN ||
    improvements.length < PRESENTATION_LIST_MIN ||
    nextPractice.length < PRESENTATION_LIST_MIN
  ) {
    throw new PresentationFeedbackError('feedback-list-too-short');
  }

  const feedback: PresentationFeedback = {
    categories,
    overallComment,
    goodPoints,
    improvements,
    nextPractice,
  };

  // 資料添付ありの評価のみ materialConsistency / materialFeedback を付与する。
  if (opts?.hasMaterial) {
    categories.materialConsistency = coerceLevel(rawCats.materialConsistency);
    const materialFeedback = cleanList(obj.materialFeedback);
    if (materialFeedback.length < 1) {
      throw new PresentationFeedbackError('feedback-material-empty');
    }
    feedback.materialFeedback = materialFeedback;
  }

  return feedback;
}

/**
 * categories のみの投影（presentation_results.categories へ保存）。
 * 履歴一覧で feedback 全文を読まずにバッジ表示するための非正規化コピー。
 */
export function projectCategories(
  feedback: PresentationFeedback,
): PresentationCategories {
  // materialConsistency が付いていればそのまま投影に含める（spread でコピーされる）。
  return { ...feedback.categories };
}

// cache / 履歴読み取り側の type guard（値域ではなく型のみ。ai_score_contract §3-4）。
export function isPresentationFeedback(v: unknown): v is PresentationFeedback {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  if (!f.categories || typeof f.categories !== 'object') return false;
  const cats = f.categories as Record<string, unknown>;
  for (const key of PRESENTATION_CATEGORY_KEYS) {
    if (!isLevel(cats[key])) return false;
  }
  if (typeof f.overallComment !== 'string') return false;
  return (
    Array.isArray(f.goodPoints) &&
    Array.isArray(f.improvements) &&
    Array.isArray(f.nextPractice)
  );
}
