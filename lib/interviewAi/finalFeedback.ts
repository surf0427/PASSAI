import 'server-only';

import { anthropic, extractJson } from '@/lib/ai';
import { logAiUsage } from '@/lib/aiUsageLog';
import { isInterviewFeedback } from '@/lib/interview/isInterviewFeedback';
import type { InterviewFeedback } from '@/types/interview';
import {
  INTERVIEW_AI_COMPLETE_LOG_ROUTE,
  INTERVIEW_AI_FEEDBACK_MAX_TOKENS,
  INTERVIEW_AI_FEEDBACK_MODEL,
} from './constants';
import {
  feedbackGuidanceFor,
  FEEDBACK_TONE_RULES,
  type InterviewType,
} from './interviewTypes';

/**
 * STEP-INTERVIEW-AI-PR7: 面接 AI セッションの final feedback 生成（InterviewFeedback 形式）。
 *
 * 重要（PR7 必須条件）:
 *   - 本ファイルは **logAiUsage のみ**。recordUsage は **絶対に呼ばない**（complete は課金トリガではない）。
 *     lib/billing/usageLog（recordUsage）を import しない。
 *   - 出力は既存 InterviewFeedback 契約（types/interview.ts）をそのまま再利用（pr0_design.md §8）。
 *     isInterviewFeedback で runtime 検証する。
 */

export type FeedbackTurn = {
  role: 'question' | 'answer';
  content: string;
};

// 生成失敗を区別するエラー（route で 502 に倒す）。
export class FinalFeedbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinalFeedbackError';
  }
}

const SYSTEM_PROMPT = [
  'あなたは大学入試の面接官です。受験生との面接のやり取り全体をもとに、最終フィードバックを',
  '日本語で作成してください。出力は次の JSON オブジェクト **のみ**（前後の説明文なし）:',
  '{',
  '  "overallEvaluation": string,            // 全体評価の総括（数文）',
  '  "goodPoints": string[],                 // 良かった点',
  '  "improvements": string[],               // 改善点',
  '  "perQuestionFeedback": [{               // 質問ごとのフィードバック',
  '    "question": string, "answer": string,',
  '    "evaluation": string, "improvement": string, "betterAnswer": string,',
  '    "levelEvaluation": {                  // 各軸は "weak" | "normal" | "strong"',
  '      "logical": string, "concrete": string, "consistency": string,',
  '      "originality": string, "interviewReadiness": string }',
  '  }],',
  '  "followUpQuestions": [{                  // 各質問への深掘り候補',
  '    "questionNumber": number, "originalQuestion": string, "followUps": string[] }],',
  '  "nextPractice": string[]                // 次に練習すべきこと',
  '}',
  'levelEvaluation の各値は "weak" / "normal" / "strong" のいずれかにしてください。',
  '',
  '【最重要 — 「この受験生だからこその評価」にする】',
  '- すべての項目は、受験生が実際に話した内容（具体的な経験・活動・志望理由・将来像・その場の発言）を根拠にする。',
  '  可能な限り回答中の具体的な語句を引用・参照する（例:「○○という経験」「○○という活動」「○○という考え」）。',
  '- どの受験生にも当てはまる一般論・テンプレ文は禁止。',
  '  禁止例:「笑顔が良かったです」「もっと具体的に話しましょう」「自信を持ちましょう」「論理的に話せています」のような中身のない指摘。',
  '  （※この面接は音声/テキストのやり取りのみ。表情・声・態度など、やり取りから判断できないことには触れない。）',
  '- 面接のやり取り・関連データに無い事実や固有名詞は捏造しない。',
  '',
  '【面接官目線で評価する】',
  '- 受験生を励ますコメントではなく、大学の面接官として評価する。',
  '  「大学側がここを知りたい」「ここが合否の判断材料になる」という観点を、評価の根拠として自然に含める。',
  '',
  '【良かった点 goodPoints（必ず回答から具体例を引用）】',
  '- 回答内容の具体例を引用して、何がどう良かったかを述べる。抽象的な称賛だけは禁止。',
  '  良い例:「留学生交流イベントで『司会進行』を担当したという具体例は説得力がありました」' +
    '「志望理由として高校時代の経験と大学で学びたい内容が自然につながっていました」。',
  '',
  '【改善点 improvements（「もっと具体的に」ではなく、何が不足していたかを説明）】',
  '- 何が足りなかったかを、回答内容に即して説明する。',
  '  良い例:「活動内容は説明できていましたが、自分が果たした役割が伝わりにくかったです」' +
    '「志望理由は明確でしたが、大学で何を学びたいかとの接続が弱く感じられました」' +
    '「『将来は国際機関で働きたい』という目標に対し、そのために大学4年間で何を身につけたいかまでは説明できていませんでした」。',
  '',
  '【次に練習すべきこと nextPractice（テンプレ禁止・今回の内容に合わせる）】',
  '- 今回の受験生の回答内容に合わせた具体策にする。',
  '  良い例:「今回は活動経験が強みなので、その経験を大学での学びにどう活かすかまで話せるようにしましょう」。',
  '',
  '【評価のバランスと厳しさ】',
  '- 良かった点と改善点をほぼ同じ比重で扱い、次に練習すべきことはそれより少なめでよい（目安: 良かった点40% / 改善点40% / 次への具体策20%）。',
  '- PASSAI は本番に向けた練習ツール。必要以上に褒めず、改善点があるならきちんと指摘する。ただし人格否定はしない（回答内容への指摘に限る）。',
  '',
  '【評価で見る観点（該当するものを根拠に使う）】',
  '- 論理性 / 具体性 / 一貫性 / 志望理由 / 大学・学部との適合性 / 活動経験 / 将来像 / 受け答えの自然さ / 質問にきちんと答えられていたか。',
  '',
  '【出力スタイル】',
  '- overallEvaluation は、面接官が実際に書いたコメントのような短い総評（2〜4文）にする。良かった点・課題・総合水準が自然な文章で伝わるようにする。',
  '- goodPoints / improvements / nextPractice は必ずそれぞれ 2〜4 個入れ、空配列にしない。各項目は 1〜2 文の意味のある日本語にする（単語だけ・空文字は禁止）。',
  '- 同じ内容や同一文の繰り返しを避ける。各項目は異なる観点にし、表現も重複させない。',
  '- improvements / nextPractice は、受験生が本番までに次に直すべき具体的な内容・行動が分かるように書く。',
  '',
  '【分量（厳守・全体を簡潔に）】各文は具体的だが冗長にしない。',
  '- perQuestionFeedback の evaluation / improvement / betterAnswer は各 1〜2 文（betterAnswer は要点のみの模範回答で、長文の作文にしない）。',
  '- followUpQuestions の followUps は各質問につき 1〜2 個まで。',
  '- 質問が多い場合でも全体の出力が長くなりすぎないよう、各項目を簡潔にまとめる（途中で切れないことを最優先）。',
  '',
  '【レベル判定基準（perQuestionFeedback の levelEvaluation 各軸。overallEvaluation の総括にも反映）】各値は weak / normal / strong。',
  '  strong: 回答に具体的な経験・事実があり、志望理由・活動・将来像が大学/学部の学びと接続できている。',
  '  normal: 一定の受け答えはできているが、具体性・一貫性・大学との接続のいずれかが弱い。',
  '  weak: 回答が短すぎる / 抽象的すぎる / 質問に答えていない、または志望理由との接続がほとんどない。',
  '  overallEvaluation には、この基準でのおおまかな総合水準（strong / normal / weak 相当）が伝わるよう総括を書く。',
  '- perQuestionFeedback / followUpQuestions は対象が無ければ空配列でよい（キーは必ず含める）。',
].join('\n');

function buildTargetContext(targetRef: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (label: string, key: string) => {
    const v = targetRef[key];
    if (typeof v === 'string' && v.trim()) parts.push(`${label}: ${v.trim()}`);
  };
  push('大学', 'universityName');
  push('大学', 'university');
  push('学部', 'faculty');
  push('学科', 'department');
  push('受験方式', 'examType');
  return parts.length > 0 ? parts.join(' / ') : '一般的な大学面接';
}

function buildTranscript(turns: FeedbackTurn[]): string {
  return turns
    .map((t) => (t.role === 'question' ? `面接官: ${t.content}` : `受験生: ${t.content}`))
    .join('\n');
}

/**
 * final feedback を生成する。logAiUsage のみ。recordUsage は呼ばない。
 * 失敗（API error / truncation / parse 失敗 / guard 不一致）は FinalFeedbackError を throw する。
 */
export async function generateFinalFeedback(args: {
  interviewType: InterviewType;
  targetRef: Record<string, unknown>;
  turns: FeedbackTurn[];
  sourceContext?: string;
}): Promise<InterviewFeedback> {
  // タイプ別の追加評価観点 + 全モード共通の建設的トーン規約を system に足す。
  // 圧迫面接モードでも講評トーンは通常モードと統一する（FEEDBACK_TONE_RULES）。
  const system =
    `${SYSTEM_PROMPT}\n【評価観点（タイプ別）】${feedbackGuidanceFor(args.interviewType)}\n` +
    FEEDBACK_TONE_RULES;
  const sourceLine = (args.sourceContext ?? '').trim()
    ? `受験生の関連データ:\n${(args.sourceContext ?? '').trim()}\n\n`
    : '';
  const userPrompt =
    `面接対象 — ${buildTargetContext(args.targetRef)}\n\n` +
    sourceLine +
    `面接のやり取り:\n${buildTranscript(args.turns)}\n\n` +
    `上記をもとに最終フィードバック JSON を出力してください。`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: INTERVIEW_AI_FEEDBACK_MODEL,
      max_tokens: INTERVIEW_AI_FEEDBACK_MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch {
    logAiUsage({
      route: INTERVIEW_AI_COMPLETE_LOG_ROUTE,
      model: INTERVIEW_AI_FEEDBACK_MODEL,
      status: 'failed',
    });
    throw new FinalFeedbackError('feedback-generation-failed');
  }

  if (response.stop_reason === 'max_tokens') {
    logAiUsage({
      route: INTERVIEW_AI_COMPLETE_LOG_ROUTE,
      model: INTERVIEW_AI_FEEDBACK_MODEL,
      status: 'truncated',
      usage: response.usage,
    });
    throw new FinalFeedbackError('feedback-truncated');
  }

  const text = (response.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    logAiUsage({
      route: INTERVIEW_AI_COMPLETE_LOG_ROUTE,
      model: INTERVIEW_AI_FEEDBACK_MODEL,
      status: 'parse_failed',
      usage: response.usage,
    });
    throw new FinalFeedbackError('feedback-parse-failed');
  }

  if (!isInterviewFeedback(parsed)) {
    logAiUsage({
      route: INTERVIEW_AI_COMPLETE_LOG_ROUTE,
      model: INTERVIEW_AI_FEEDBACK_MODEL,
      status: 'parse_failed',
      usage: response.usage,
    });
    throw new FinalFeedbackError('feedback-parse-failed');
  }

  logAiUsage({
    route: INTERVIEW_AI_COMPLETE_LOG_ROUTE,
    model: INTERVIEW_AI_FEEDBACK_MODEL,
    status: 'success',
    usage: response.usage,
  });
  return parsed;
}

/**
 * InterviewFeedback → interview_ai_results の正規化カラム射影（pr0_design.md §6.2 / §8）。
 *   - strengths     ← goodPoints
 *   - improvements  ← improvements
 *   - next_practice ← nextPractice
 * guard は goodPoints / nextPractice を緩く扱うため、ここで string[] に防御的に正規化する。
 */
export function projectResultArrays(feedback: InterviewFeedback): {
  strengths: string[];
  improvements: string[];
  nextPractice: string[];
} {
  return {
    strengths: toStringArray(feedback.goodPoints),
    improvements: toStringArray(feedback.improvements),
    nextPractice: toStringArray(feedback.nextPractice),
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string');
}
