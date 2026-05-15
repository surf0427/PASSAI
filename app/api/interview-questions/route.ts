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

import { NextResponse } from 'next/server';
import { anthropic } from '@/lib/ai';
import { logAiUsage } from '@/lib/aiUsageLog';
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
import type { BasicInfo } from '@/types/basicInfo';
import type { StudentProfile } from '@/types/studentProfile';
import type { StatementDraft } from '@/lib/statement/review/statementStorage';

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
  });

  // Anthropic 呼び出し（system のみ prompt caching 対象）。
  // userPrompt は素材が毎回変わるためキャッシュ対象外。
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
    // 本文・prompt はログに出さない（aiUsageLog の方針に従う）。
    console.error('interview-questions api error', {
      route: ROUTE,
      model: MODEL,
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    return NextResponse.json(
      { error: 'AI_REQUEST_FAILED', message: 'AI の呼び出しに失敗しました。' },
      { status: 502 },
    );
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  const rawText = textBlock?.type === 'text' ? textBlock.text.trim() : '';

  if (response.stop_reason === 'max_tokens') {
    console.error('interview-questions truncated', {
      route: ROUTE,
      stopReason: response.stop_reason,
    });
    logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: response.usage });
    return NextResponse.json(
      {
        error: 'AI_QUESTIONS_TRUNCATED',
        message: 'AI の出力が途中で終了しました。もう一度お試しください。',
      },
      { status: 502 },
    );
  }

  try {
    const questions = parseInterviewQuestions(rawText);
    logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: response.usage });
    return NextResponse.json({ questions });
  } catch (error) {
    // rawText（AI 出力本文）も志望理由書本文も志望者識別情報もログに出さない。
    console.error('interview-questions parse failed', {
      route: ROUTE,
      stopReason: response.stop_reason,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    logAiUsage({ route: ROUTE, model: MODEL, status: 'parse_failed', usage: response.usage });
    return NextResponse.json(
      {
        error: 'AI_QUESTIONS_PARSE_FAILED',
        message: 'AI の出力を正しく読み取れませんでした。もう一度お試しください。',
      },
      { status: 502 },
    );
  }
}

// 4 つの内部 helper (isPlainObject / isStatementDraftShape / buildFacultyNameInput /
// buildExamTypeQuestionGuidance) は lib/interview/interviewQuestionsHelpers.ts に切り出した。
// 戻り値・文字列リテラルは完全に同一。
