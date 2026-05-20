// 面接質問生成 API。
// 志望理由書 / 活動整理 / 自己分析 / 大学DB / 受験方式をもとに、
// 「一般質問」と「個別深掘り質問」を 2 層で生成する。
//
// 設計方針:
//   - prompt 構築・素材圧縮・JSON parse は lib/interview/ に切り出し済み
//   - 本 route は HTTP I/O（body 取り出し → Anthropic 呼び出し → JSON 整形 → ログ）に専念
//   - interview-feedback route と同思想（system caching / max_tokens guard / parse_failed の構造化エラー）
//   - storage / data/ への直アクセスなし。クライアントが localStorage から集めた素材を body で渡す
//
// 関連:
//   lib/interview/buildInterviewQuestionMaterials.ts
//   lib/interview/buildInterviewQuestionPrompt.ts
//   lib/interview/parseInterviewQuestions.ts
//   lib/buildInterviewUniversityContext.ts
//   app/api/interview-feedback/route.ts（実装パターンの参考元）
//
// PR8b: admissionFocus 非接続方針
//   本 route は **interview-feedback (sibling) と異なり admissionFocus context を
//   接続しない**。理由:
//     1. 2-layer questions は personalized 質問で AI hallucination が顕在化しやすい
//        構造（件数硬制 vs 捏造禁止の競合、H3 audit risk）。admissionFocus を
//        加えると「この大学の面接評価軸を反映した質問」を AI が捏造するリスクが
//        さらに上がる
//     2. matching route と同じ Option B 採用パターン: 長文評価
//        (interview-feedback / statement-review) のみに admissionFocus を適用し、
//        短文・複数項目生成 (matching / 2-layer questions) では使わない
//     3. interviewQuestionsCache (lib/interviewQuestionCache.ts) の hash 入力に
//        admissionFocusContext を含めていない。接続する場合は PROMPT_VERSION bump
//        + cache 全 miss + hash 仕様変更が必要になり、コストが高い
//   接続再判断は PR8 後、実 personalized 質問品質と admissionFocus 効果を見てから。

import { NextResponse } from 'next/server';
import { anthropic } from '@/lib/ai';
import { logAiUsage, type AiUsageTokens } from '@/lib/aiUsageLog';
import { isStudentProfile } from '@/lib/studentProfileStorage';
import { buildInterviewUniversityContext } from '@/lib/buildInterviewUniversityContext';
import { buildInterviewQuestionMaterials } from '@/lib/interview/buildInterviewQuestionMaterials';
import {
  INTERVIEW_QUESTION_SYSTEM_PROMPT,
  buildInterviewQuestionUserPrompt,
} from '@/lib/interview/buildInterviewQuestionPrompt';
import {
  buildExamTypeQuestionGuidance,
  buildFacultyNameInput,
  isPlainObject,
  isStatementDraftShape,
} from '@/lib/interview/interviewQuestionsHelpers';
import { parseInterviewQuestions } from '@/lib/interview/parseInterviewQuestions';
import { validateInterviewQuestionSet } from '@/lib/interview/validateInterviewQuestionSet';
import type { BasicInfo } from '@/types/basicInfo';
import type { StudentProfile } from '@/types/studentProfile';
import type { StatementDraft } from '@/lib/statement/review/statementStorage';
import type { TwoLayerInterviewQuestions } from '@/types/interviewQuestions';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// /api/interview-feedback (Opus) と異なり、質問生成は軽量タスクのため Sonnet を採用。
// 既存 statement-review / essay-review と同じモデル ID 文字列を使う。
const MODEL = 'claude-sonnet-4-6';
const ROUTE = 'api/interview-questions';

// 質問 10 問（general 5 / personalized 5）× answerTip 込みで ~2000-2500 tokens 程度。
// 安全マージンを取って 2200 tokens を上限とする。max_tokens で切れた時は parse 失敗扱い。
const MAX_TOKENS = 2200;

// 質問生成は事実ベース寄りで、揺らぎは要らないが固すぎても代り映えしない。
// statement-review (0.3) より少し柔らかく、深掘り観点に多様性を持たせる。
const TEMPERATURE = 0.4;

// validateInterviewQuestionSet が「明らかな崩れ」を検出した時に user prompt 末尾に
// 1 回だけ append する補足指示。base prompt（system / user 本体）は不変なので
// PROMPT_VERSION bump 対象外（client cache key には影響しない）。
//
// retry 全体ポリシー:
//   - 1 回まで（無限 retry 禁止）
//   - 補足指示はあくまで「主題分散と固定重要枠維持」だけ。AI に大幅修正を促さない
//   - retry 後の出力に対しても validate するが、ここで fail しても warning log のみで返却
const VALIDATION_RETRY_HINT = `【再生成時の補足指示】
前回の生成では personalized 質問に偏りまたは固定重要枠の欠落が検出されました。今回は以下を厳守してください:
・personalized 5 問のうち、同一活動だけを扱う質問が 3 問を超えないようにする。
・固定重要枠（authenticity_check / university_fit / future_goal）を personalized から欠落させない。
・素材で繰り返し言及される最重要エピソードを personalized から完全に消さない（最低 1 問は扱う）。
他のルール（件数 5+5 / category 許可値 / 代筆禁止 / authenticity_check の作り方 / 出力 JSON 形式）は完全に維持してください。`;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'INVALID_BODY', message: 'リクエスト内容を読み取れませんでした。' },
      { status: 400 },
    );
  }

  const bodyObj = isPlainObject(body) ? body : {};

  const basicInfo: BasicInfo | null = isPlainObject(bodyObj.basicInfo)
    ? (bodyObj.basicInfo as BasicInfo)
    : null;
  const statementDraft: StatementDraft | null = isStatementDraftShape(bodyObj.statementDraft)
    ? bodyObj.statementDraft
    : null;
  const studentProfile: StudentProfile | null = isStudentProfile(bodyObj.studentProfile)
    ? bodyObj.studentProfile
    : null;
  const activitySummary: string | null =
    typeof bodyObj.activitySummary === 'string' ? bodyObj.activitySummary : null;

  // 日次バリエーション seed（PROMPT_VERSION v4）。client 側で 'YYYY-MM-DD' (JST) を生成して
  // hash 入力 + 本 body にセットで送ってくる契約。route 側で再計算しない（client / server で
  // hash 整合性が崩れるのを防ぐ）。形式が一致しない値は捨てて、legacy prompt（v3 互換）に落とす。
  const dailySeed: string | null =
    typeof bodyObj.dailySeed === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bodyObj.dailySeed)
      ? bodyObj.dailySeed
      : null;

  const materials = buildInterviewQuestionMaterials({
    basicInfo,
    statementDraft,
    studentProfile,
    activitySummary,
  });

  // 大学DB context は materials の university / faculty を優先入力にする。
  // 該当 entries が無ければ空文字が返り、prompt 側で「大学DB情報なし」として扱われる。
  // boundary は lib/universities.ts 経由（buildInterviewUniversityContext の中で守られている）。
  const universityContext = materials.university
    ? buildInterviewUniversityContext({
        university: materials.university,
        facultyName: buildFacultyNameInput(materials.faculty, materials.department),
      })
    : '';

  // 受験方式ガイダンスは route 内 local helper で構築。interview-feedback 側の
  // local function とは「文言の宛先（フィードバック/質問生成）」が違うため共通化しない。
  const examTypeGuidance = buildExamTypeQuestionGuidance(materials.examTypes);

  const userPrompt = buildInterviewQuestionUserPrompt({
    materials,
    universityContext,
    examTypeGuidance,
    dailySeed,
  });

  // ── 1 回目の生成 ──────────────────────────────────────────────
  const first = await runInterviewQuestionGeneration(userPrompt);
  if (first.kind === 'http_error') {
    // AI 失敗（network / truncation / parse）は従来通り 502 で返す。
    return first.response;
  }

  // ── validation A/B/C（明らかな崩れだけ検出）─────────────────
  const v1 = validateInterviewQuestionSet(first.questions, materials);
  if (v1.ok) {
    logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: first.usage });
    return NextResponse.json({ questions: first.questions });
  }

  // 1 回目で偏り検出。AI call 自体は成功しているので usage は記録した上で、
  // 補足指示付きで 1 回だけ retry する。
  console.warn('interview-questions validation failed', {
    route: ROUTE,
    attempt: 1,
    reasons: v1.reasons,
  });
  logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: first.usage });

  // ── 2 回目（retry, 最大 1 回）───────────────────────────────
  const second = await runInterviewQuestionGeneration(
    `${userPrompt}\n\n${VALIDATION_RETRY_HINT}`,
  );
  if (second.kind === 'http_error') {
    // retry の AI call が失敗した場合は、1 回目の質問（validate fail だが parse は成功）
    // を返す。retry 失敗で 502 を返すと 1 回目の有効な出力まで捨ててしまうため。
    console.warn('interview-questions validation retry: AI call failed, falling back to first attempt', {
      route: ROUTE,
    });
    return NextResponse.json({ questions: first.questions });
  }

  const v2 = validateInterviewQuestionSet(second.questions, materials);
  if (!v2.ok) {
    // 2 回目も fail。これ以上 retry しない方針なのでそのまま返す（warning のみ）。
    console.warn('interview-questions validation still failed after retry (returning anyway)', {
      route: ROUTE,
      attempt: 2,
      reasons: v2.reasons,
    });
  }
  logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: second.usage });
  return NextResponse.json({ questions: second.questions });
}

// ── 内部 helper ───────────────────────────────────────────────────

type InterviewQuestionGenerationResult =
  | {
      kind: 'success';
      questions: TwoLayerInterviewQuestions;
      usage: AiUsageTokens | undefined;
    }
  | { kind: 'http_error'; response: NextResponse };

// 1 回分の Anthropic 呼び出し + parse + error 分岐をまとめたヘルパ。
// validate は内側でやらない（validate / retry は POST 側の責務）。
// 既存の error response 構造（status code・error code・日本語 message）と
// logAiUsage の status enum は完全に維持する。
async function runInterviewQuestionGeneration(
  userPrompt: string,
): Promise<InterviewQuestionGenerationResult> {
  let response;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: [
        {
          type: 'text',
          text: INTERVIEW_QUESTION_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (error) {
    console.error('interview-questions api error', {
      route: ROUTE,
      model: MODEL,
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    return {
      kind: 'http_error',
      response: NextResponse.json(
        { error: 'AI_REQUEST_FAILED', message: 'AI の呼び出しに失敗しました。' },
        { status: 502 },
      ),
    };
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  const rawText = textBlock?.type === 'text' ? textBlock.text.trim() : '';

  if (response.stop_reason === 'max_tokens') {
    console.error('interview-questions truncated', {
      route: ROUTE,
      stopReason: response.stop_reason,
    });
    logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: response.usage });
    return {
      kind: 'http_error',
      response: NextResponse.json(
        {
          error: 'AI_QUESTIONS_TRUNCATED',
          message: 'AI の出力が途中で終了しました。もう一度お試しください。',
        },
        { status: 502 },
      ),
    };
  }

  try {
    const questions = parseInterviewQuestions(rawText);
    return { kind: 'success', questions, usage: response.usage };
  } catch (error) {
    console.error('interview-questions parse failed', {
      route: ROUTE,
      stopReason: response.stop_reason,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    logAiUsage({ route: ROUTE, model: MODEL, status: 'parse_failed', usage: response.usage });
    return {
      kind: 'http_error',
      response: NextResponse.json(
        {
          error: 'AI_QUESTIONS_PARSE_FAILED',
          message: 'AI の出力を正しく読み取れませんでした。もう一度お試しください。',
        },
        { status: 502 },
      ),
    };
  }
}

// 4 つの内部 helper (isPlainObject / isStatementDraftShape / buildFacultyNameInput /
// buildExamTypeQuestionGuidance) は lib/interview/interviewQuestionsHelpers.ts に切り出した。
// 戻り値・文字列リテラルは完全に同一。
