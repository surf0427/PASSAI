import { anthropic, extractJson } from '@/lib/ai';
import type { BasicInfo } from '@/types/basicInfo';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';

// 受験方式に応じた小論文添削の方針を生成する。breakdown 構造（5項目固定）には影響を与えず、
// improvement / weakPoints / goodPoints の中身を文脈に沿わせるためだけに使う。
function buildExamTypeEssayGuidance(examTypes: string[] | undefined): string {
  const types = examTypes ?? [];
  const rules: string[] = [];

  if (types.includes('総合型選抜（AO入試）')) {
    rules.push('- 総合型選抜（AO）対策として、思考力・主体性・社会課題との接続を重視する。');
  }
  if (types.includes('学校推薦型選抜（公募・指定校）')) {
    rules.push('- 学校推薦型選抜対策として、高校生活での経験や基礎的な論理性を重視する。難解な専門知識は要求しない。');
  }
  if (types.includes('一般選抜') || types.includes('共通テスト利用')) {
    rules.push('- 一般選抜（共通テスト利用を含む）も併願しているため、汎用性が高く短時間でも書きやすい構成かどうかを評価する。');
  }
  if (types.includes('海外大学受験')) {
    rules.push('- 海外大学受験を含むため、国際的視点・多文化理解への接続も評価軸に加える。');
  }
  if (types.includes('まだ決まっていない')) {
    rules.push('- 受験方式が未確定なため、特定方式に偏らず汎用的な観点で評価する。');
  }
  if (rules.length === 0) return '';
  return ['【受験方式に応じた添削方針】', ...rules].join('\n');
}

const VALID_VERDICTS = ['合格ライン', 'あと一歩', '改善必要', '構造からやり直し'] as const;
const VALID_BREAKDOWN_LABELS = ['論理構造', '具体性', '説得力', 'テーマ理解', '独自性'] as const;

type BreakdownItem = { label: string; score: number };

type ReviewResult = {
  totalScore: number;
  verdict: string;
  breakdown: BreakdownItem[];
  improvement: string;
  goodPoints: string[];
  weakPoints: string[];
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

function safeParseResult(data: unknown): ReviewResult {
  if (typeof data !== 'object' || data === null) {
    return {
      totalScore: 0,
      verdict: '構造からやり直し',
      breakdown: [],
      improvement: FALLBACK_IMPROVEMENT,
      goodPoints: FALLBACK_GOOD_POINTS,
      weakPoints: FALLBACK_WEAK_POINTS,
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

  return {
    totalScore: finalScore,
    verdict,
    breakdown,
    improvement,
    goodPoints: goodPoints.length > 0 ? goodPoints : FALLBACK_GOOD_POINTS,
    weakPoints: weakPoints.length > 0 ? weakPoints : FALLBACK_WEAK_POINTS,
  };
}

export async function POST(req: Request) {
  const body = await req.json();
  const theme: string = body.theme ?? '';
  const conclusion: string = body.conclusion ?? '';
  const reasonOne: string = body.reasonOne ?? '';
  const reasonTwo: string = body.reasonTwo ?? '';
  const essayBody: string = body.essayBody ?? '';
  // basicInfo は任意。未送信や形が不正でも null として扱う。
  const basicInfo: BasicInfo | null = body.basicInfo ?? null;

  if (!essayBody.trim()) {
    return Response.json({ error: '本文を入力してください' }, { status: 400 });
  }

  const systemPrompt = `あなたは高校生・大学受験生向けの小論文添削者です。
生徒の小論文を採点・添削し、自分で改善できるよう具体的なフィードバックを返します。

【絶対にやってはいけないこと】
- 小論文の本文・完成文・模範解答を書くこと
- 「〜と書けます」のようにそのまま使える文を出すこと
- 「具体例を増やしましょう」「説得力を高めましょう」のような抽象的なアドバイスを出すこと

【生徒の志望情報の扱い】
受験生の志望大学・学部・学科・文理・学年・受験方式が与えられている場合は、それを採点・改善提案の文脈に必ず織り込むこと。具体的には：
- 「テーマ理解」採点時：志望学部・学科の専門性とテーマがどう接続できるかを基準に評価する。
- 「独自性」採点時：志望理由・将来目標との一貫性が見える場合は加点要素にする。
- improvement / weakPoints：「志望学部との一致」「学科との関連性」「将来目標との接続」「受験方式に合った論理構成」のうち弱い点があれば、行動レベルの指示として明示する。
- 文理（理系/文系）に応じて、論じ方の方向性を意識する。
- 学年が低い場合は、専門知識の深さよりも論理性・主体性を重視する。
- ※ breakdown のラベルは固定（論理構造・具体性・説得力・テーマ理解・独自性）。新しいラベルを追加してはいけない。

【improvement のルール】
必ず「次に何をすればいいか」が分かる行動レベルの指示を1文で書くこと。

必ず以下のどれかの形で終えること：
- 「〜を1文追加してください」
- 「〜を1文書き換えてください」
- 「〜を1文で説明してください」
- 「〜を本文に入れてください」

禁止表現（これだけで終わるのは禁止）：
「具体例を増やしましょう」「説得力を高めましょう」「もっと詳しく書きましょう」
「内容を深めましょう」「論理性を高めましょう」「独自性を出しましょう」「意識しましょう」

良い例：
「あなたの実体験・ニュース・社会問題の中から1つ選び、『課題 → 影響 → 自分の考え』の流れで1文追加してください。」
「反対意見として考えられる立場を1つ選び、それに対する自分の反論を1文で説明してください。」
「結論部分に、あなたが大学で学びたいこととテーマをつなげる1文を追加してください。」

【verdict の判定基準】
必ず以下の4つのうちどれかを使うこと。他の文言は禁止。
- 80以上：合格ライン
- 70〜79：あと一歩
- 60〜69：改善必要
- 59以下：構造からやり直し

【スコアのルール】
- totalScore は 0〜100 の整数
- breakdown は必ず以下の5項目（各 0〜20 の整数）
- 5つの score の合計が totalScore と一致すること
  - 論理構造 / 具体性 / 説得力 / テーマ理解 / 独自性

【出力ルール】
- 返答は必ず1つの JSON オブジェクトのみ
- JSON の前後に説明文・コメント・挨拶を一切書かないこと
- Markdown コードブロック（\`\`\`json や \`\`\`）を使わないこと
- JSON の外側に中括弧 { } を絶対に使わないこと
- すべてのキーをダブルクォートで囲むこと
- すべての文字列値をダブルクォートで囲むこと
- 出力の1文字目が { であること
- 出力の最後の文字が } であること

出力形式：
{
  "totalScore": 78,
  "verdict": "あと一歩",
  "breakdown": [
    { "label": "論理構造", "score": 16 },
    { "label": "具体性", "score": 14 },
    { "label": "説得力", "score": 15 },
    { "label": "テーマ理解", "score": 17 },
    { "label": "独自性", "score": 16 }
  ],
  "improvement": "（行動レベルの具体的な指示）",
  "goodPoints": ["...", "..."],
  "weakPoints": ["...", "..."]
}`;

  const basicInfoSection = buildBasicInfoPromptSection(basicInfo);
  const examTypeGuidance = buildExamTypeEssayGuidance(basicInfo?.examTypes);

  const userMessage = `以下の小論文を採点・添削してください。

${basicInfoSection}

${examTypeGuidance ? `${examTypeGuidance}\n\n` : ''}【テーマ】
${theme || '（未入力）'}

【生徒の結論（1文）】
${conclusion || '（未入力）'}

【理由①】
${reasonOne || '（未入力）'}

【理由②】
${reasonTwo || '（未入力）'}

【本文】
${essayBody}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';

    let parsed: unknown = {};
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      console.error('essay-review: JSON parse failed. raw text:', text);
    }

    return Response.json(safeParseResult(parsed));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('essay-review API error:', msg);
    return Response.json(
      { error: 'AIの処理に失敗しました。時間をおいてお試しください。' },
      { status: 500 }
    );
  }
}
