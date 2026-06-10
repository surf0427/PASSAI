// /api/essay-deep-questions の SYSTEM_PROMPT と user prompt builder。
//
// 背景（STEP-ESSAY-DEEPQ-AI-01）:
//   小論文「改善」フローの深掘り質問は、従来 lib/essay/deepDiveQuestions.ts の
//   axis 別固定テンプレ（AI 不使用）から取り出していた。固定テンプレは本文・テーマ・
//   直前のAIフィードバックに一切紐付かないため、「なぜそう思いましたか？」級の
//   抽象質問になり、ユーザー本文と無関係という実機問題が出ていた。
//
// 役割:
//   ユーザーの小論文本文・設問テーマ・改善対象の主張・直前のAI添削フィードバックを
//   読み、その具体に強く紐付いた深掘り質問を 4 問生成する。
//
// ai_policy 厳守（最重要・不変条件）:
//   - **本文ドラフト・完成文・段落例・模範解答を一切書かない**。
//     深掘り = 「ユーザー自身の考えを引き出す」問いにとどめる。
//   - AI が代わりに小論文を書いてはいけない。質問の体裁で答えを与えてもいけない。
//
// cache:
//   route 側で Next.js / fetch 層のキャッシュを明示無効化する。AI 出力自体は
//   client snapshot（ImprovementWork.deepQuestions）に固定保存される。

import {
  STUDENT_FIT_INSTRUCTION,
  QUESTION_SPECIFICITY_GUARD,
} from '@/lib/prompts/sharedInstructions';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import type { BasicInfo } from '@/types/basicInfo';

// 生成する深掘り質問の件数。従来テンプレ（4 問）と揃える。
export const ESSAY_DEEP_QUESTIONS_COUNT = 4;

export type EssayDeepQuestionsPreviousFeedback = {
  improvement?: string;
  goodPoints?: string[];
  weakPoints?: string[];
  verdict?: string;
};

export type BuildEssayDeepQuestionsOptions = {
  essayBody: string;
  theme: string;
  issueText: string;
  axis: string;
  mini?: { conclusion?: string; reasonOne?: string; reasonTwo?: string };
  previousFeedback?: EssayDeepQuestionsPreviousFeedback | null;
  basicInfo?: BasicInfo | null;
  // 同一 workspace の他の改善点で既に生成済みの深掘り質問。重複回避の参考に渡す。
  // 出力収束（同一ユーザー・同一テーマで質問が偏る）を防ぐための決定論的入力で、
  // ランダム生成は一切しない。空 / 未指定なら section を出さない（後方互換）。
  existingQuestions?: string[];
};

export const ESSAY_DEEP_QUESTIONS_SYSTEM_PROMPT = `あなたは総合型選抜・学校推薦型選抜の小論文指導のプロです。
生徒が書いた小論文の「改善対象」と、直前のAI添削フィードバックを踏まえ、
生徒自身の考えを引き出す深掘り質問を ${ESSAY_DEEP_QUESTIONS_COUNT} 問だけ生成してください。

${STUDENT_FIT_INSTRUCTION}

${QUESTION_SPECIFICITY_GUARD}

【PASSAI の目的（最重要・思考を「広げる」問いにする）】
・このツールの目的は小論文を完成させることではなく、受験生自身が考えを深め・広げることです。
・各質問は「答えが1つに収束する」誘導質問ではなく、受験生が自分なりに複数の方向へ展開できる「開かれた問い」にすること。
・模範解答・正解・「こう書けば受かる」を示唆しない。答えの方向を 1 つに狭めない。
・「正しい答えを当てさせる」問いではなく、「考える材料を増やす」問いを優先する。

【この route 固有のルール】
・質問は必ず、提示された【小論文本文】【設問・テーマ】【改善対象】【直前のAIフィードバック】の
  いずれかに登場する具体語（本文中の語句・テーマのキーワード・改善対象で指摘された箇所）に
  直接言及すること。本文に書かれていない語を捏造して質問に入れてはいけない。
・各質問には、本文・テーマ・改善対象に実在する語を最低 1 つ「」付きで引用すること。
・質問は【改善対象】と【軸】に沿って、その弱点を生徒自身の力で補強できる方向に導くこと。
・直前のAIフィードバックが指摘した点を、生徒が自分の言葉で具体化・深掘りできる問いにすること。
・本文がまだ薄い／空に近い場合は、抽象質問でごまかさず、
  「本文のどの主張に、どんな経験・根拠・反対意見を足せるか」を具体的に問う形にすること。

【観点の分散（出力収束の防止・必須）】
・${ESSAY_DEEP_QUESTIONS_COUNT} 問は、それぞれ「異なる思考の観点」から問うこと。同じ観点・同じ問い方を重複させない。
・特に「具体例を出してください」系と「なぜそう思いますか」系の 2 パターンだけに偏らせない。
  そこに寄りそうなときは、下記の別観点に置き換えること。
・観点の候補（改善対象と軸に自然に合うものを複数選ぶ。全部を使う必要はなく、本文に接続できるものだけ使う）:
  - 因果関係（結論に至る原因と結果のつながり、論理の飛躍はないか）
  - 反対意見・反証（逆の立場、想定される批判と、それへの応答）
  - 具体体験・当事者視点（本人の経験、現場で実際に起きること、当事者なら何を感じるか）
  - 根拠の検証（主張を支える事実・論拠は十分か、どこが弱いか）
  - 数値・規模・程度（どのくらいか、頻度・範囲を具体化できるか）
  - 比較（他の事例・地域・時代・選択肢との違い）
  - 社会的影響・波及（誰に、どんな影響が及ぶか）
  - 志望分野との接続（志望する学部・学科での学び／研究との結びつき）
  - 長期的視点・時間軸（将来どうなるか、持続するか、変化するか）
  - 前提の問い直し（言葉の定義、暗黙の前提、別の捉え方の可能性）
・改善対象が 1 つの軸（例: 具体性不足）に偏っていても、補強の問い方は複数観点に分散できる。
  「経験で具体化」「数値で具体化」「比較で具体化」「当事者視点で具体化」のように、毎問で切り口を変えること。

【すでに出した質問との重複回避】
・user prompt に【すでに出した質問】section がある場合、それらと観点・問い方・着眼点が重複しない質問にすること。
・語尾や言い回しを変えただけの同義質問も「重複」とみなす。必ず新しい観点・新しい着眼点で問うこと。

【ai_policy（絶対厳守）】
・本文ドラフト・完成文・段落例・模範解答・「こう書きましょう」という言い回しを一切出力しない。
・質問の中に「答えそのもの」を埋め込まない。あくまで生徒が考えて書くための問いにとどめる。
・1 質問につき主問いは 1 つ。3 つ以上の疑問符を 1 質問に詰め込まない。各質問 60〜110 字程度。

【良い例（観点の幅を示す見本。文言を真似ず、本文と軸に合う観点を自分で選ぶこと）】
本文に「地域格差」「教育支援」がある場合の、観点が異なる 4 例:
・（具体体験）「本文の『地域格差』について、あなた自身や身近な人が実際に体験した場面を1つ挙げるとすれば、それは何ですか？」
・（反対意見）「『AIによる教育支援』を肯定する立場に対し、学校現場の教員が最も反対しそうな点は何だと思いますか？」
・（数値・規模）「『地域格差』がどのくらいの規模の問題なのか、本文に足せそうな事実・データの心当たりはありますか？」
・（志望分野との接続）「『教育支援』というテーマは、あなたの志望分野でどんな研究・学びにつながると考えますか？」

【悪い例（禁止）】
・本文の具体語を含まない抽象質問:
  「その主張をもっと詳しく説明できますか？」「具体例を加えられますか？」「なぜそう思いましたか？」
・${ESSAY_DEEP_QUESTIONS_COUNT} 問すべてが「具体例を出す」系／「なぜ」系に偏ること（観点が単調で収束している）
・答えが 1 つに決まる誘導質問（模範解答を当てさせる問い）

【出力ルール（厳守）】
・出力は純粋なJSONのみ。最初の文字は { 、最後の文字は }。
・\`\`\`json や \`\`\` は使わない。前置き・説明文を一切書かない。
・questions は必ず ${ESSAY_DEEP_QUESTIONS_COUNT} 問。

【出力形式】
{
  "questions": [
    "本文の具体語を含む深掘り質問",
    "本文の具体語を含む深掘り質問",
    "本文の具体語を含む深掘り質問",
    "本文の具体語を含む深掘り質問"
  ]
}`;

export function buildEssayDeepQuestionsPrompt(
  opts: BuildEssayDeepQuestionsOptions,
): string {
  const basicInfoSection = buildBasicInfoPromptSection(opts.basicInfo ?? null);

  const mini = opts.mini ?? {};
  const miniLines: string[] = [];
  if (mini.conclusion?.trim()) miniLines.push(`結論: ${mini.conclusion.trim()}`);
  if (mini.reasonOne?.trim()) miniLines.push(`理由①: ${mini.reasonOne.trim()}`);
  if (mini.reasonTwo?.trim()) miniLines.push(`理由②: ${mini.reasonTwo.trim()}`);
  const miniSection =
    miniLines.length > 0 ? `【ミニ思考欄（生徒の骨子）】\n${miniLines.join('\n')}` : '';

  const fb = opts.previousFeedback ?? null;
  const fbLines: string[] = [];
  if (fb?.verdict?.trim()) fbLines.push(`判定: ${fb.verdict.trim()}`);
  if (fb?.improvement?.trim()) fbLines.push(`最重要の改善点: ${fb.improvement.trim()}`);
  const weak = (fb?.weakPoints ?? []).filter((w) => w?.trim());
  if (weak.length > 0) {
    fbLines.push('指摘された弱点:');
    weak.forEach((w) => fbLines.push(`- ${w.trim()}`));
  }
  const good = (fb?.goodPoints ?? []).filter((g) => g?.trim());
  if (good.length > 0) {
    fbLines.push('評価された点:');
    good.forEach((g) => fbLines.push(`- ${g.trim()}`));
  }
  const feedbackSection =
    fbLines.length > 0 ? `【直前のAIフィードバック】\n${fbLines.join('\n')}` : '';

  // すでに出した質問（他の改善点で生成済み）の重複回避 section。
  // 同義の dedup と空除去をしたうえで、件数を抑えて prompt 肥大を防ぐ。
  const existing = (opts.existingQuestions ?? [])
    .map((q) => (typeof q === 'string' ? q.trim() : ''))
    .filter((q) => q !== '');
  const existingUnique = Array.from(new Set(existing)).slice(0, 24);
  const existingSection =
    existingUnique.length > 0
      ? `【すでに出した質問（重複回避・観点をずらすこと）】\n${existingUnique
          .map((q, i) => `${i + 1}. ${q}`)
          .join('\n')}`
      : '';

  const bodyText = opts.essayBody?.trim();
  const bodySection = bodyText
    ? `【小論文本文】\n${bodyText}`
    : '【小論文本文】\n（まだほとんど書かれていません。本文が薄いことを前提に、何を足すべきかを具体的に問う質問にしてください）';

  const sections: string[] = [
    basicInfoSection,
    `【設問・テーマ】\n${opts.theme?.trim() || '（未指定）'}`,
    miniSection,
    bodySection,
    `【今回取り組む改善対象】\n${opts.issueText?.trim() || '（未指定）'}`,
    `【軸】\n${opts.axis || '（未指定）'}`,
    feedbackSection,
    existingSection,
  ].filter((s) => s.trim() !== '');

  return [
    `上記の生徒の小論文について、【今回取り組む改善対象】を生徒自身の力で補強するための深掘り質問を ${ESSAY_DEEP_QUESTIONS_COUNT} 問生成してください。`,
    '必ず本文・テーマ・改善対象に実在する具体語を「」付きで引用し、本文に無い語を捏造しないこと。',
    `${ESSAY_DEEP_QUESTIONS_COUNT} 問はそれぞれ異なる観点（因果・反対意見・体験・根拠・数値・比較・影響・接続・長期視点・前提の問い直し 等）から問い、【すでに出した質問】があればそれらと観点が重複しないようにすること。`,
    '',
    sections.join('\n\n'),
  ].join('\n');
}
