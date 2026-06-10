// /api/essay-themes の SYSTEM_PROMPT と user prompt builder。
//
// 背景:
//   従来テーマ生成は lib/essayThemes.ts の決定論テンプレ（3〜9 件固定）を循環表示する
//   だけで、ユーザーが「もっと別のお題で練習したい」ニーズに応えられなかった。
//   本 route は同じ志望校・学部・アドミッションポリシー文脈をもとに、既出テーマと
//   重複しない新しい小論文「お題」を追加生成する。過去問完全一致は狙わず、志望校の
//   傾向に近い練習用テーマを大量に出せる状態を作るのが目的。
//
// ai_policy 厳守（最重要・不変条件）:
//   - 生成するのは「お題（設問文）」のみ。**本文・模範解答・段落例・書き出し例を一切書かない**。
//   - 入力に無い大学固有の事実（具体的な過去問・配点・教員名など）を捏造しない。
//
// 出力収束の防止:
//   - 既出テーマ（alreadyShownThemes）と切り口・カテゴリが重複しないようにする。
//   - usedCategories で偏っているカテゴリを避け、未出・少数のカテゴリへ分散させる。

import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { ALL_ESSAY_THEME_TYPES, type EssayThemeType } from '@/lib/essayThemes';
import type { BasicInfo } from '@/types/basicInfo';

// 1 回の追加生成で返すテーマ件数。多すぎると 1 回の押下で似た文が並ぶため控えめに。
export const ESSAY_THEMES_COUNT = 4;

// category(=themeType) の日本語ラベル。prompt 内の説明・偏り分散の指示に使う。
// 値（英 snake_case）は EssayThemeCandidate.themeType としてそのまま UI バッジに出る。
export const ESSAY_THEME_CATEGORY_LABELS: Record<EssayThemeType, string> = {
  social_issue: '社会課題',
  technology: 'テクノロジー・AI',
  globalization: 'グローバル化・国際',
  ethics: '倫理',
  self_reflection: '自己・経験の省察',
  policy: '政策・制度',
  culture: '文化・価値観',
  education: '教育',
  environment: '環境・持続可能性',
};

export type BuildEssayThemesOptions = {
  label: string; // 「○○大学 ○○学部」表示ラベル
  hasPolicy: boolean;
  policies: string[]; // 意味のある admission_policy 全文
  biasOrder: EssayThemeType[]; // 学部・入試方式由来の優先カテゴリ順
  experiencePhrase: string; // 受験方式由来の語気ヒント（空可）
  alreadyShownThemes: string[]; // 既出テーマ（重複回避の参考）
  usedCategories: string[]; // 既出テーマの category 一覧（偏り分散の参考）
  basicInfo?: BasicInfo | null;
};

const CATEGORY_LIST_FOR_PROMPT = ALL_ESSAY_THEME_TYPES.map(
  (t) => `  - ${t}（${ESSAY_THEME_CATEGORY_LABELS[t]}）`,
).join('\n');

export const ESSAY_THEMES_SYSTEM_PROMPT = `あなたは総合型選抜・学校推薦型選抜の小論文指導のプロです。
受験生が「同じ志望校・学部でも、いろいろな切り口のお題で何度も練習できる」ようにするため、
志望校のアドミッションポリシー・学部特性に近い小論文の練習テーマ（設問文）を ${ESSAY_THEMES_COUNT} 個生成してください。

【このツールの目的】
・過去問に完全一致させる必要はありません。志望校の傾向に近い「練習用のお題」を量産することが目的です。
・受験生が多くのお題で練習できることを最優先にしつつ、学部の関心領域から大きく外れないようにしてください。

【ai_policy（絶対厳守）】
・生成するのは「お題（設問文）」だけです。本文・模範解答・段落例・書き出し例・「こう書きましょう」を一切書かないこと。
・入力に無い大学固有の事実（具体的な過去問・配点・教員名・実在しない統計など）を捏造しないこと。
・お題は「受験生自身に考えさせ、書かせる」問いにとどめること。答えを設問文に埋め込まないこと。

【category（必須・偏り分散）】
・各テーマに必ず category を 1 つ付与すること。category は次の値のいずれかから選ぶ（英 snake_case のまま出力）:
${CATEGORY_LIST_FOR_PROMPT}
・${ESSAY_THEMES_COUNT} 個の category はできるだけ重複させず、互いに異なる切り口にすること。
・user prompt の【既出カテゴリ】で多く使われている category は避け、まだ出ていない／少ない category を優先すること。
・globalization / culture / technology などの「出しやすいテーマ」に偏らせないこと。

【既出テーマとの重複回避】
・user prompt の【既出テーマ】と、主題・切り口・問い方が重複しないテーマにすること。
・語尾や言い回しを変えただけの同義テーマも「重複」とみなす。必ず新しい着眼点で出すこと。

【お題の作り方】
・志望校のアドミッションポリシーが提示されている場合は、その方針に沿った関心領域・能力を問うお題にすること（ただし方針文をそのまま長く引用しない）。
・アドミッションポリシーが無い場合は、学部特性（提示された優先カテゴリ）に沿った汎用的だが学部らしいお題にすること。
・各お題は 1 問につき主題は 1 つ。「あなたの考えを述べなさい」「論じなさい」等で締める設問文の体裁にすること。
・お題は 40〜140 字程度。長すぎる前提文を付けないこと。

【出力ルール（厳守）】
・出力は純粋な JSON のみ。最初の文字は { 、最後の文字は }。
・\`\`\`json や \`\`\` は使わない。前置き・説明文を一切書かない。
・themes は必ず ${ESSAY_THEMES_COUNT} 個。

【出力形式】
{
  "themes": [
    { "theme": "小論文の設問文", "category": "social_issue" },
    { "theme": "小論文の設問文", "category": "technology" },
    { "theme": "小論文の設問文", "category": "education" },
    { "theme": "小論文の設問文", "category": "policy" }
  ]
}`;

export function buildEssayThemesPrompt(opts: BuildEssayThemesOptions): string {
  const basicInfoSection = buildBasicInfoPromptSection(opts.basicInfo ?? null);

  const targetSection = `【志望校】\n${opts.label || '（未指定。汎用テーマで構わない）'}`;

  const policySection = opts.hasPolicy
    ? `【アドミッションポリシー】\n${opts.policies
        .map((p, i) => `${i + 1}. ${p}`)
        .join('\n')}`
    : '【アドミッションポリシー】\n（見つからないため、学部特性に沿った汎用テーマを出すこと）';

  // 優先カテゴリ（学部・入試方式由来）。AI が category を選ぶ際の指針。
  const biasUnique = opts.biasOrder.filter(
    (t, i, arr) => arr.indexOf(t) === i,
  );
  const biasSection =
    biasUnique.length > 0
      ? `【この学部で優先したいカテゴリ（上位ほど親和性が高い）】\n${biasUnique
          .map(
            (t) =>
              `- ${t}（${ESSAY_THEME_CATEGORY_LABELS[t] ?? t}）`,
          )
          .join('\n')}`
      : '';

  const toneSection = opts.experiencePhrase.trim()
    ? `【設問のトーン】\n受験方式の特性上、お題に「${opts.experiencePhrase}」のように本人の経験・視点を引き出す要素を適度に含めてよい。`
    : '';

  const shown = opts.alreadyShownThemes
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t !== '');
  const shownUnique = Array.from(new Set(shown)).slice(-30);
  const shownSection =
    shownUnique.length > 0
      ? `【既出テーマ（重複回避・切り口をずらすこと）】\n${shownUnique
          .map((t, i) => `${i + 1}. ${t}`)
          .join('\n')}`
      : '【既出テーマ】\n（まだありません）';

  const usedCats = opts.usedCategories
    .map((c) => (typeof c === 'string' ? c.trim() : ''))
    .filter((c) => c !== '');
  const catCounts = usedCats.reduce<Record<string, number>>((acc, c) => {
    acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {});
  const usedCatLine =
    Object.keys(catCounts).length > 0
      ? Object.entries(catCounts)
          .map(([c, n]) => `${c}×${n}`)
          .join(' / ')
      : '（まだありません）';
  const usedCatSection = `【既出カテゴリ（これらに偏らせず、未出・少数のカテゴリを優先）】\n${usedCatLine}`;

  const sections = [
    basicInfoSection,
    targetSection,
    policySection,
    biasSection,
    toneSection,
    shownSection,
    usedCatSection,
  ].filter((s) => s.trim() !== '');

  return [
    `上記の志望校・学部の傾向に沿った小論文の練習テーマ（設問文）を ${ESSAY_THEMES_COUNT} 個生成してください。`,
    '【既出テーマ】と重複せず、【既出カテゴリ】に偏らないよう、互いに異なる category の切り口で出すこと。',
    '本文・模範解答は書かず、お題（設問文）と category だけを JSON で返すこと。',
    '',
    sections.join('\n\n'),
  ].join('\n');
}
