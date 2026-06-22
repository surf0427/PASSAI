import 'server-only';

import { anthropic } from '@/lib/ai';
import { logAiUsage } from '@/lib/aiUsageLog';
import {
  INTERVIEW_AI_FOLLOWUP_LOG_ROUTE,
  INTERVIEW_AI_FOLLOWUP_MODEL,
  INTERVIEW_AI_MAX_ANSWER_TURNS,
  INTERVIEW_AI_MAX_TOKENS,
  INTERVIEW_AI_MODEL,
  INTERVIEW_AI_PREFETCH_LOG_ROUTE,
  INTERVIEW_AI_SEED_LOG_ROUTE,
} from './constants';
import {
  questionGuidanceFor,
  QUESTION_QUALITY_RULES,
  toneGuidanceFor,
  type InterviewType,
} from './interviewTypes';

/**
 * STEP-INTERVIEW-AI-PR6: 面接 AI の質問生成（seed / followup）。
 *
 * 重要（PR6 必須条件 §2）:
 *   seed question generation / followup question generation は **logAiUsage のみ**。
 *   recordUsage は **絶対に呼ばない**（内部 AI 処理は課金トリガではない）。
 *   本ファイルは lib/billing/usageLog（recordUsage）を import しない。
 *
 * 生成物は短い面接質問 1 文（plain text）。JSON ではない。
 */

export type PriorTurn = {
  role: 'question' | 'answer';
  content: string;
};

// followup の「一言リアクション」のトーン指示（最大1文）。圧迫のみ短く厳しめ、他は穏やかに受け止める。
// いずれも褒めすぎ禁止 / 空褒め禁止 / 人格否定・侮辱・嘲笑・脅し禁止。reaction は回答内容にだけ触れる。
function reactionGuidanceFor(type: InterviewType): string {
  if (type === 'pressure') {
    return (
      '【リアクション（最大1文・厳しめ）】直前の回答に対し、短く厳しめに受け答える（甘く褒めない・称賛しない）。' +
      '回答の弱点・抽象性・根拠不足は端的に指摘してよいが、人格否定・侮辱・嘲笑・脅しは絶対に禁止' +
      '（あくまで回答内容へのツッコミに限る）。'
    );
  }
  return (
    '【リアクション（最大1文）】直前の回答を一言だけ自然に受け止める（短い共感・相づち程度）。' +
    '大げさな称賛・褒めすぎ・「素晴らしい」等の乱発は禁止。回答に実際に含まれた要素にだけ触れ、' +
    '中身のない空褒め（誰にでも言える一般論の称賛）はしない。'
  );
}

// 面接タイプごとの「面接官の人格（ペルソナ）」。質問内容だけでなく、面接官そのものを演じ分ける。
// ここは **質問生成プロンプト専用**（interviewTypes.ts の共有 guidance は変更しない＝Realtime/評価に無影響）。
// 人格・話し方・言葉遣い・深掘りの仕方・厳しさを定義する。例文は「方向性の見本」であり、毎回同じ文を
// 使い回さない（テンプレ禁止 / 表現は毎回変える）。
function personaGuidanceFor(type: InterviewType): string {
  switch (type) {
    case 'self_analysis':
      return (
        '【面接官の人格】優しく寄り添う大学教員。「一緒にあなた自身を掘り下げていきましょう」という姿勢。' +
        '話し方は柔らかく落ち着いていて、受験生を急かさない。' +
        '価値観・経験・原体験・行動理由・その時の感情を、温かく丁寧に掘り下げる。' +
        '（方向性の例:「なるほど、その経験がきっかけだったのですね。もう少し詳しく教えてください」' +
        '「その時はどのようなことを感じましたか」「なぜその行動を取ろうと思ったのでしょうか」のような寄り添う問い方）。' +
        '威圧的な態度・詰問口調は絶対にしない。'
      );
    case 'statement':
      return (
        '【面接官の人格】大学の入試担当教員。志望理由の一貫性を確認する立場。' +
        '話し方は論理的で丁寧、少し厳格。' +
        '志望理由・大学とのマッチ度・将来像・具体性を、筋道立てて確認するように掘り下げる。' +
        '（方向性の例:「志望理由書には〇〇とありますが、その理由を詳しく教えてください」' +
        '「なぜ他大学ではなく本学なのでしょうか」「将来どのように活かしたいと考えていますか」のような確認の問い方）。' +
        '雑談化させない。感情論だけで終わらせない。'
      );
    case 'essay':
      return (
        '【面接官の人格】小論文の採点教員。論理性を確認する立場。' +
        '話し方は端的で、テンポは少し速め。' +
        '主張の根拠・データ・客観性・反対意見を、鋭く端的に掘り下げる。' +
        '（方向性の例:「その根拠は何でしょうか」「別の視点から考えるとどうなりますか」' +
        '「反対意見についてはどう考えますか」のような論理を突く問い方）。' +
        '長い前置き・過剰な共感はしない。'
      );
    case 'pressure':
      return (
        '【面接官の人格】厳しい面接官。本番以上の緊張感を作る。' +
        '話し方は短く鋭く、少し低圧的。' +
        '回答の矛盾・曖昧さ・根拠不足を端的に突いて掘り下げる。' +
        '（方向性の例:「それだけでは根拠として弱いですね」「具体性が足りません」' +
        '「なぜそう言い切れるのでしょうか」のような短く鋭い指摘）。' +
        '厳しさは必ず「回答内容」だけに向ける。' +
        '人格否定・嘲笑・侮辱・高圧的すぎる表現・受験生が不快になる表現は絶対に禁止。'
      );
    case 'free':
    default:
      return (
        '【面接官の人格】実際の大学面接官。最も本番に近い。' +
        '話し方は自然で、少し緊張感があり、淡々としている。' +
        '深掘りはランダムで、受験生の回答に応じて柔軟に変える。' +
        '（方向性の例:「ありがとうございます。では次の質問です」' +
        '「もう少し具体例を教えてください」「その経験から何を学びましたか」のような自然で淡々とした進め方）。' +
        'フレンドリーすぎる態度・雑談化は避ける。'
      );
  }
}

// 話し方の共通ルール（全モード共通・TTS 読み上げ前提）。人格に上書きされず常に守る。
const PERSONA_DELIVERY_RULES =
  '【話し方（全モード共通・音声読み上げ前提）】出力は面接官が声に出して話す、自然な日本語にする。' +
  '質問は必ず1つだけ、最大2文。リアクションを付ける場合も最大1文。' +
  '毎回同じ言い回し・定型文を避け、表現を必ず変える（「素晴らしいですね」等の同じ称賛の連発は禁止）。' +
  '箇条書き・番号・記号の多用・3文以上の長文は禁止。';

// 面接タイプごとの人格 + 方針 + 共通品質ルールを織り込んだ system プロンプトを組む。
//   - kind=seed / speculative は「質問文のみ」を出力する。
//   - kind=followup のみ「一言リアクション（最大1文）+ 質問1つ（合計2文以内目安）」を出力する。
function buildSystem(type: InterviewType, kind: 'seed' | 'followup' | 'speculative'): string {
  const intro =
    kind === 'seed'
      ? 'あなたは大学入試（総合型選抜）の面接官です。受験生に最初の面接質問を1つだけ出してください。'
      : kind === 'speculative'
        ? 'あなたは大学入試（総合型選抜）の面接官です。受験生は今、最後に提示された質問にこれから答えようとしています。' +
          'その回答内容を待たずに、面接官として次に出す可能性が最も高い質問を1つだけ予測して出してください。'
        : 'あなたは大学入試（総合型選抜）の面接官です。これまでのやり取りと受験生の直前の回答を踏まえ、深掘りする面接質問を1つだけ出してください。';
  const parts = [
    intro,
    // 面接官そのものを5タイプで演じ分ける（人格を最優先で枠付けする）。
    personaGuidanceFor(type),
    `【方針】${questionGuidanceFor(type)}`,
    toneGuidanceFor(type),
    QUESTION_QUALITY_RULES,
    PERSONA_DELIVERY_RULES,
  ];
  if (kind === 'followup') {
    // followup のみ: 冒頭に一言リアクション → 続けて質問1つ。合計2文以内目安。
    parts.push(reactionGuidanceFor(type));
    parts.push(
      '【出力形式（リアクション+質問）】まず直前の回答への一言リアクション（最大1文）を述べ、' +
        '続けて深掘りする質問を1つだけ出す。リアクションと質問は自然につなげてよい。' +
        '合計2文以内を目安にする（長い前置き・採点者目線の説明・箇条書き・番号・記号・引用符は付けない）。' +
        '質問は必ず1つだけ（1発話に質問を2つ以上混ぜない）。リアクションと質問以外の余計な文は出さない。',
    );
  } else {
    // seed / speculative: 従来どおり「質問文のみ」（リアクションは付けない）。
    parts.push(
      '【文体】受験面接として自然な口語の日本語。質問は原則1文、長くても2文まで。' +
        '採点者目線の説明・長い前置き・箇条書き・番号・記号・引用符は付けない。' +
        '1つの発話に質問を2つ以上混ぜない。出力は質問文そのものだけ。',
    );
  }
  return parts.join('\n');
}

// source データ要約（target_ref.sourceContext）をプロンプトに載せる section。空なら何も足さない。
function sourceSection(sourceContext: string | undefined): string {
  const s = (sourceContext ?? '').trim();
  if (!s) return '';
  return `\n\n【受験生の関連データ】\n${s}\n（上記を踏まえて質問を作る。データに無い事実を捏造しない）`;
}

// target_ref（大学 / 学部 / 受験方式等）を短い文脈行に落とす。PII 本文は載せない（識別子相当のみ）。
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
  return parts.length > 0 ? `面接対象 — ${parts.join(' / ')}` : '面接対象 — 一般的な大学面接';
}

// 直近のやり取りを transcript 文脈に整形する。
function buildTranscript(turns: PriorTurn[]): string {
  return turns
    .map((t) => (t.role === 'question' ? `面接官: ${t.content}` : `受験生: ${t.content}`))
    .join('\n');
}

// 5問の観点設計（総合型選抜の目安 / req ③）。観点（論点・切り口）の重複を避け、深さを段階的に上げる。
// 順番は絶対固定ではなく、面接タイプの方針・受験生のデータ・直前回答に合わせて調整してよい。
const QUESTION_ARC: readonly string[] = [
  '志望理由の核心。なぜその分野・学問なのか、関心の源にある具体的な経験まで掘り下げる。',
  '自己分析・強み。強みや価値観を抽象論で終わらせず、具体的な場面・行動で語らせる。',
  '活動実績・経験の深掘り。取り組んだ活動の中での判断・困難・工夫など一段深い部分を問う。',
  '大学・学部との接続。その大学・学部だからこそ学べること / 志望との結びつきを確認する。',
  '将来像と学びの活用。学んだことを将来どう活かすか、面接の総仕上げとして問う。',
];

// PriorTurn[] の answer 件数 = 回答済みの質問数。次に作る質問の番号 = これ + 1。
function countAnswers(turns: PriorTurn[]): number {
  return turns.filter((t) => t.role === 'answer').length;
}

// 今回の質問（questionNumber: 1-based / total: 全問数）の観点ガイドを組む（req ③④）。
function buildArcGuidance(questionNumber: number, total: number): string {
  const idx = Math.min(Math.max(questionNumber, 1), QUESTION_ARC.length) - 1;
  return [
    `【全${total}問の設計】各質問は観点（論点・切り口）を変え、重複させない。問が進むほど深さを上げる。`,
    '総合型選抜の目安: 1=志望理由の核 / 2=自己分析・強み / 3=活動・経験の深掘り / 4=大学・学部との接続 / 5=将来像と学びの活用。',
    `【今回（${questionNumber}問目 / 全${total}問）の主眼】${QUESTION_ARC[idx]}`,
    '面接タイプの方針を最優先し、それに沿って観点を調整してよい。既に十分聞いた観点は繰り返さない。',
  ].join('\n');
}

// 同一セッションで既に出した質問一覧（重複回避用 / req ⑤）。直近のやり取りに加えて明示提示する。
function askedQuestionsSection(turns: PriorTurn[]): string {
  const asked = turns
    .filter((t) => t.role === 'question')
    .map((t) => t.content.trim())
    .filter(Boolean);
  if (asked.length === 0) return '';
  const list = asked.map((q, i) => `${i + 1}. ${q}`).join('\n');
  return `\n\n【既に聞いた質問（論点も聞き方も繰り返さない）】\n${list}`;
}

// anthropic response から text を取り出す。
function extractText(
  content: Array<{ type: string; text?: string }>,
): string {
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
    .trim();
}

async function generateQuestion(args: {
  logRoute: string;
  system: string;
  userPrompt: string;
  // 使用モデル。未指定なら INTERVIEW_AI_MODEL（= Sonnet）。followup のみ高速モデルを渡す。
  model?: string;
}): Promise<string> {
  const model = args.model ?? INTERVIEW_AI_MODEL;
  let response;
  try {
    response = await anthropic.messages.create({
      model,
      max_tokens: INTERVIEW_AI_MAX_TOKENS,
      system: args.system,
      messages: [{ role: 'user', content: args.userPrompt }],
    });
  } catch {
    // messages.create が throw（network / API error）。usage 無し。
    logAiUsage({ route: args.logRoute, model, status: 'failed' });
    throw new Error('question-generation-failed');
  }

  if (response.stop_reason === 'max_tokens') {
    logAiUsage({
      route: args.logRoute,
      model,
      status: 'truncated',
      usage: response.usage,
    });
  } else {
    logAiUsage({
      route: args.logRoute,
      model,
      status: 'success',
      usage: response.usage,
    });
  }

  const text = extractText(response.content as Array<{ type: string; text?: string }>);
  if (!text) throw new Error('question-generation-empty');
  return text;
}

/**
 * 最初の質問（seed）を生成する。interview_type + sourceContext でタイプ別に方針を変える。
 * logAiUsage のみ。recordUsage は呼ばない。
 */
export async function generateSeedQuestion(args: {
  interviewType: InterviewType;
  targetRef: Record<string, unknown>;
  sourceContext?: string;
}): Promise<string> {
  const userPrompt =
    `${buildTargetContext(args.targetRef)}` +
    `${sourceSection(args.sourceContext)}\n\n` +
    `${buildArcGuidance(1, INTERVIEW_AI_MAX_ANSWER_TURNS)}\n\n` +
    `上記を踏まえ、1問目の質問を1つ出してください。`;
  return generateQuestion({
    logRoute: INTERVIEW_AI_SEED_LOG_ROUTE,
    system: buildSystem(args.interviewType, 'seed'),
    userPrompt,
  });
}

/**
 * 直前の回答を深掘りする followup を生成する。interview_type + sourceContext でタイプ別に方針を変える。
 * logAiUsage のみ。recordUsage は呼ばない。
 */
export async function generateFollowupQuestion(args: {
  interviewType: InterviewType;
  targetRef: Record<string, unknown>;
  turns: PriorTurn[];
  sourceContext?: string;
}): Promise<string> {
  const total = INTERVIEW_AI_MAX_ANSWER_TURNS;
  // 次に作る質問の番号 = これまでの回答数 + 1（上限でクランプ）。観点設計（arc）に使う。
  const questionNumber = Math.min(countAnswers(args.turns) + 1, total);
  const userPrompt =
    `${buildTargetContext(args.targetRef)}` +
    `${sourceSection(args.sourceContext)}\n\n` +
    `これまでのやり取り:\n${buildTranscript(args.turns)}` +
    `${askedQuestionsSection(args.turns)}\n\n` +
    `${buildArcGuidance(questionNumber, total)}\n\n` +
    `受験生の直前の回答にまず一言リアクション（最大1文）をしてから、その回答を自然に踏まえて` +
    `${questionNumber}問目の質問を1つ出してください` +
    `（リアクション+質問で合計2文以内を目安に。褒めすぎず、深掘りに寄せすぎず、上記の主眼に沿って観点を進める）。`;
  return generateQuestion({
    logRoute: INTERVIEW_AI_FOLLOWUP_LOG_ROUTE,
    system: buildSystem(args.interviewType, 'followup'),
    userPrompt,
    // followup のみ高速モデルを使う（env 未設定なら INTERVIEW_AI_MODEL = Sonnet にフォールバック）。
    model: INTERVIEW_AI_FOLLOWUP_MODEL,
  });
}

/**
 * 次質問の **先読み候補**（speculative）を生成する。
 *
 * 用途: 現在の質問を表示した直後、ユーザーの回答を待たずに「次に出す可能性が高い質問」を
 *       1 件だけ先生成しておき、回答時に即採用して待機時間を消す（STEP-INTERVIEW-AI-PREFETCH）。
 *
 * 前提: `turns` の末尾は **受験生がこれから答える現在の未回答質問**（role='question'）。
 *       回答内容はまだ無いため、特定の回答を仮定しすぎず、観点設計（arc）に沿った自然な次問を予測する。
 *
 * 注意: generateFollowupQuestion と同様に **logAiUsage のみ**。recordUsage は呼ばない（課金トリガではない）。
 *       本生成結果は採用時に通常の followup と同じ経路で保存される（保存・課金ロジックは不変）。
 */
export async function generateSpeculativeQuestion(args: {
  interviewType: InterviewType;
  targetRef: Record<string, unknown>;
  turns: PriorTurn[]; // 末尾は現在の未回答質問
  sourceContext?: string;
}): Promise<string> {
  const total = INTERVIEW_AI_MAX_ANSWER_TURNS;
  // 現在の未回答質問の番号 = これまでの回答数 + 1。先読み候補はその「次」= 回答数 + 2（上限クランプ）。
  const nextQuestionNumber = Math.min(countAnswers(args.turns) + 2, total);
  const userPrompt =
    `${buildTargetContext(args.targetRef)}` +
    `${sourceSection(args.sourceContext)}\n\n` +
    `これまでのやり取り（末尾「面接官:」が受験生がこれから答える現在の質問）:\n${buildTranscript(args.turns)}` +
    `${askedQuestionsSection(args.turns)}\n\n` +
    `${buildArcGuidance(nextQuestionNumber, total)}\n\n` +
    `受験生はこれから上記の最後の質問に答えます。その回答を待たずに、面接官が次に出す可能性が高い` +
    `${nextQuestionNumber}問目の質問を1つだけ予測して出してください` +
    `（特定の回答内容を仮定しすぎず、観点の自然な進行として）。`;
  return generateQuestion({
    logRoute: INTERVIEW_AI_PREFETCH_LOG_ROUTE,
    system: buildSystem(args.interviewType, 'speculative'),
    userPrompt,
  });
}
