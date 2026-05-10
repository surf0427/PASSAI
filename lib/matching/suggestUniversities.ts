// ── スコアリング層 (Scoring Layer) ───────────────────────────────
// 生徒の basicInfo / StudentAnalysis から、deterministic に
// MatchingResult[] を組み立てる。AI には依存しない。
// （ここで生成される reason / strengthPoints 等はテンプレートベース。
//   AI による narrative は文章生成層 /app/api/matching/route.ts で上書きされる）
//
// TODO: 大学DBが整備されたら、ローカルの data/universities.ts を
//   Supabase テーブル / 大学 API に置き換える（universities 配列の取得元を切り替えるだけで済むよう、
//   ここでは universities を引数化していく方向で拡張する）。
//
import type {
  MatchingBasicInfo,
  StudentAnalysis,
  University,
  MatchingResult,
} from '@/types/matching';
import { universities } from '@/data/universities';
import { calculateScoreBreakdown, calculateOverallMatchScore } from './calculateScore';
import {
  generateMatchReason,
  generatePotentialMatchReason,
  extractWeaknesses,
  generateActionItems,
  generateStrengthPoints,
  generateMatchSummary,
} from './generateReason';

const TOP_N = 3;

// ── 1件の MatchingResult を組み立てるヘルパー ──────────────────

function buildSingleResult(
  university: University,
  analysis: StudentAnalysis,
  suggestionType: MatchingResult['suggestionType'],
  overrideReason?: string, // 潜在マッチなど理由を上書きしたい場合
): MatchingResult | null {
  const breakdown = calculateScoreBreakdown(university, analysis);
  if (!breakdown) return null; // スコア計算できない大学はスキップ

  const score = breakdown.total;
  const reason = overrideReason ?? generateMatchReason(university, analysis, breakdown);
  const weaknesses = extractWeaknesses(breakdown);
  const actionItems = generateActionItems(weaknesses);
  const strengthPoints = generateStrengthPoints(university, analysis, breakdown);
  const matchSummary = generateMatchSummary(university, score, suggestionType);

  return {
    university,
    score,
    scoreBreakdown: breakdown,
    reason,
    strengthPoints,
    weaknesses,
    actionItems,
    suggestionType,
    matchSummary,
  };
}

// ── ① 自分の志望校を評価 ───────────────────────────────────────

/**
 * basicInfo.choices に含まれる大学を DB から探してスコアを出す。
 * DB に載っていない大学はスキップする。
 */
function evaluateStudentChoices(
  basicInfo: MatchingBasicInfo,
  analysis: StudentAnalysis,
  allUniversities: University[],
): MatchingResult[] {
  const results: MatchingResult[] = [];

  for (const choice of basicInfo.choices) {
    // 大学名のみでDBレコードを検索する（学部名はユーザー入力を優先するため条件に含めない）
    const found = allUniversities.find((u) => u.name === choice.university);
    if (!found) continue;

    // スコア計算はDBのプロフィールを使いつつ、表示名はユーザー入力値で上書きする
    // 将来DBを入れた場合も、'自分の志望校'エントリはここで入力値を優先する構造を維持する
    const universityForDisplay: University = {
      ...found,
      name: choice.university,
      faculty: choice.faculty,
    };

    const result = buildSingleResult(universityForDisplay, analysis, '自分の志望校');
    if (result) results.push(result);
  }

  return results;
}

// ── ② ストレートマッチ ─────────────────────────────────────────

/**
 * 志望校の類似校・タグ・学部から関連大学を提案する。
 */
export function suggestStraightMatchUniversities(
  basicInfo: MatchingBasicInfo,
  allUniversities: University[],
): University[] {
  const choiceNames = basicInfo.choices.map((c) => c.university);

  // 志望校のタグを集める
  const choiceTags = allUniversities
    .filter((u) => choiceNames.includes(u.name))
    .flatMap((u) => u.tags);

  return allUniversities.filter((uni) => {
    if (choiceNames.includes(uni.name)) return false; // 志望校自体は除外

    // 類似校リストに含まれているか
    const inSimilarSchools = allUniversities
      .filter((u) => choiceNames.includes(u.name))
      .some((u) => u.similarSchools.includes(uni.name));

    // タグが1つ以上一致するか
    const hasTagOverlap = uni.tags.some((tag) => choiceTags.includes(tag));

    return inSimilarSchools || hasTagOverlap;
  });
}

// ── ③ 潜在マッチ ──────────────────────────────────────────────

/**
 * 生徒の strengths・tags・スコアから相性の高い大学を提案する。
 */
export function suggestPotentialMatchUniversities(
  analysis: StudentAnalysis,
  allUniversities: University[],
  excludeIds: string[],
): University[] {
  // 生徒の strengths に含まれる単語と大学タグを照合
  const candidates = allUniversities
    .filter((uni) => !excludeIds.includes(uni.id))
    .map((uni) => {
      const score = calculateOverallMatchScore(uni, analysis);

      // 生徒の強みと大学タグが重なる数（スコアへのボーナス要素）
      const tagMatchCount = uni.tags.filter((tag) =>
        analysis.strengths.some((s) => s.includes(tag) || tag.includes(s)),
      ).length;

      return { uni, score, tagMatchCount };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      // スコアが同じ場合はタグ一致数で優先
      if (b.score !== a.score) return b.score - a.score;
      return b.tagMatchCount - a.tagMatchCount;
    });

  return candidates.slice(0, TOP_N).map(({ uni }) => uni);
}

// ── メイン関数 ────────────────────────────────────────────────

/**
 * ①自分の志望校 ②ストレートマッチ ③潜在マッチ の順に
 * MatchingResult[] を組み立てて返す。
 * page.tsx からはこの関数だけ呼べばOK。
 */
export function buildMatchingResults(
  basicInfo: MatchingBasicInfo,
  analysis: StudentAnalysis,
): MatchingResult[] {
  // ① 自分の志望校
  const choiceResults = evaluateStudentChoices(basicInfo, analysis, universities);
  const usedIds = choiceResults.map((r) => r.university.id);

  // ② ストレートマッチ
  const straightUniversities = suggestStraightMatchUniversities(basicInfo, universities)
    .filter((u) => !usedIds.includes(u.id))
    .slice(0, TOP_N);

  const straightResults = straightUniversities
    .map((uni) => buildSingleResult(uni, analysis, 'ストレートマッチ'))
    .filter((r): r is MatchingResult => r !== null);

  usedIds.push(...straightUniversities.map((u) => u.id));

  // ③ 潜在マッチ（①②で使った大学は除外）
  const potentialUniversities = suggestPotentialMatchUniversities(
    analysis,
    universities,
    usedIds,
  );

  const potentialResults = potentialUniversities
    .map((uni) => {
      // 潜在マッチだけは「なぜ志望校でないのに推薦されるか」を理由に使う
      const potentialReason = generatePotentialMatchReason(uni, analysis);
      return buildSingleResult(uni, analysis, '潜在マッチ', potentialReason);
    })
    .filter((r): r is MatchingResult => r !== null);

  return [...choiceResults, ...straightResults, ...potentialResults];
}
