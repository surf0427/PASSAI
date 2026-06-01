// /api/essay-review の AI 出力 JSON parser / 正規化層。
//
// 役割:
//   anthropic.messages.create() 後の JSON.parse 結果（unknown）を defensive に検査して
//   ReviewResult shape に正規化する純粋関数。失敗時は安全な fallback 値で埋める。
//
//   - breakdown は VALID_BREAKDOWN_LABELS の 5 ラベル / 各 0-20 / 配列長 5 のみ許容
//   - verdict は VALID_VERDICTS の 4 値のみ許容。範囲外は deriveVerdict(finalScore) で再計算
//   - totalScore は breakdown 5 件が揃えば合計値で上書き（AI 出力と breakdown の不整合を吸収）
//   - improvement / goodPoints / weakPoints は trim 済み非空文字列のみ採用、空なら FALLBACK
//
// 切り出し経緯:
//   元は app/api/essay-review/route.ts に同居していたが、route.ts が肥大化していたため
//   切り出した。AI 呼び出し経路 / ESSAY_REVIEW_SYSTEM_PROMPT / examType ガイダンスとは
//   無関係で、AI 出力の defensive 正規化のみを担う。
//
// 注意:
//   - 戻り値 ReviewResult shape を変えてはいけない。route.ts は本関数の戻り値を
//     Response.json にそのまま渡しており、クライアント側 (app/essay-practice/page.tsx 等) が
//     この shape に依存している。
//   - FALLBACK_* 文言は過去の AI 出力失敗ユーザーに表示された文字列でもあるため不変条件。
//   - VALID_VERDICTS / VALID_BREAKDOWN_LABELS の文字列は prompt 内の同名リテラルと
//     1 対 1 で対応している。文字列を変えると AI 出力との照合が崩れる。

const VALID_VERDICTS = ['合格ライン', 'あと一歩', '改善必要', '構造からやり直し'] as const;
const VALID_BREAKDOWN_LABELS = ['論理構造', '具体性', '説得力', 'テーマ理解', '独自性'] as const;

type BreakdownItem = { label: string; score: number };

// STEP-SILENT-FALLBACK-01:
//   source / parseError は AI 出力か fallback テンプレかを UI 側で判別するためのメタ field。
//   - source='ai'       : AI が returned した正常な JSON が一通り採用された
//   - source='fallback' : data 全体が非 object / null（AI 呼び出し失敗 / 完全 parse 失敗）
//   - source='partial'  : 一部 field のみ AI 出力、欠落部分は FALLBACK_* で補完された
//   既存 ReviewResult shape の互換性のため optional 追加とする（旧 client は無視）。
type OutputSource = 'ai' | 'fallback' | 'partial';

type ReviewResult = {
  totalScore: number;
  verdict: string;
  breakdown: BreakdownItem[];
  improvement: string;
  goodPoints: string[];
  weakPoints: string[];
  // STEP-SILENT-FALLBACK-01: 出力元の明示。UI が fallback 注意文を出す判定に使う。
  source?: OutputSource;
  // 完全 parse failure 時のみ true（AI 呼び出し / JSON parse / shape 検査の失敗）。
  parseError?: boolean;
  // fallback 発火理由の structured code（個人情報 / 本文全文は含めない）。
  fallbackReason?: string;
};

function deriveVerdict(score: number): string {
  if (score >= 80) return '合格ライン';
  if (score >= 70) return 'あと一歩';
  if (score >= 60) return '改善必要';
  return '構造からやり直し';
}

const FALLBACK_IMPROVEMENT =
  '「私は〇〇と考える。なぜなら〜だからだ」という形で、結論と理由をそれぞれ1文ずつ書き直してみましょう。';

const FALLBACK_GOOD_POINTS = [
  '自分の考えを言葉にして表現できています。論述の第一歩として大切な力です。',
];

const FALLBACK_WEAK_POINTS = [
  '結論→理由→具体例の流れを意識すると、読み手に伝わる論文になります。',
];

function safeStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .slice(0, max);
}

export function safeParseResult(data: unknown): ReviewResult {
  if (typeof data !== 'object' || data === null) {
    // STEP-SILENT-FALLBACK-01: 完全 parse 失敗時の warn。route / 理由 / timestamp のみログ。
    console.warn('[fallback]', {
      route: 'api/essay-review',
      reason: 'data_not_object',
      timestamp: new Date().toISOString(),
    });
    return {
      totalScore: 0,
      verdict: '構造からやり直し',
      breakdown: [],
      improvement: FALLBACK_IMPROVEMENT,
      goodPoints: FALLBACK_GOOD_POINTS,
      weakPoints: FALLBACK_WEAK_POINTS,
      source: 'fallback',
      parseError: true,
      fallbackReason: 'data_not_object',
    };
  }
  const d = data as Record<string, unknown>;

  const rawScore = d.totalScore;
  const totalScore =
    typeof rawScore === 'number' &&
    Number.isInteger(rawScore) &&
    rawScore >= 0 &&
    rawScore <= 100
      ? rawScore
      : 0;

  const rawBreakdown = Array.isArray(d.breakdown) ? d.breakdown : [];
  const breakdown: BreakdownItem[] = rawBreakdown
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .filter((row) =>
      VALID_BREAKDOWN_LABELS.includes(row.label as typeof VALID_BREAKDOWN_LABELS[number]) &&
      typeof row.score === 'number' &&
      Number.isInteger(row.score) &&
      (row.score as number) >= 0 &&
      (row.score as number) <= 20
    )
    .map((row) => ({ label: row.label as string, score: row.score as number }))
    .slice(0, 5);

  const finalScore =
    breakdown.length === 5
      ? breakdown.reduce((sum, item) => sum + item.score, 0)
      : totalScore;

  const rawVerdict = d.verdict;
  const verdict = VALID_VERDICTS.includes(rawVerdict as typeof VALID_VERDICTS[number])
    ? (rawVerdict as string)
    : deriveVerdict(finalScore);

  const rawImprovement = d.improvement;
  const improvement =
    typeof rawImprovement === 'string' && rawImprovement.trim().length > 0
      ? rawImprovement.trim()
      : FALLBACK_IMPROVEMENT;

  const goodPoints = safeStringArray(d.goodPoints, 3);
  const weakPoints = safeStringArray(d.weakPoints, 3);

  // STEP-SILENT-FALLBACK-01: 一部欠落 / fallback 適用箇所を集計し、メタ field に乗せる。
  const fallbackFields: string[] = [];
  if (improvement === FALLBACK_IMPROVEMENT) fallbackFields.push('improvement');
  if (goodPoints.length === 0) fallbackFields.push('goodPoints');
  if (weakPoints.length === 0) fallbackFields.push('weakPoints');
  if (breakdown.length !== 5) fallbackFields.push('breakdown');
  const source: OutputSource = fallbackFields.length === 0 ? 'ai' : 'partial';
  if (source === 'partial') {
    console.warn('[fallback]', {
      route: 'api/essay-review',
      reason: 'partial_fallback',
      fields: fallbackFields,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    totalScore: finalScore,
    verdict,
    breakdown,
    improvement,
    goodPoints: goodPoints.length > 0 ? goodPoints : FALLBACK_GOOD_POINTS,
    weakPoints: weakPoints.length > 0 ? weakPoints : FALLBACK_WEAK_POINTS,
    source,
    parseError: false,
    ...(source === 'partial' && { fallbackReason: fallbackFields.join(',') }),
  };
}
