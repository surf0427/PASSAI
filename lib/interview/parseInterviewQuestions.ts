// 面接質問生成 AI の出力を安全に parse して TwoLayerInterviewQuestions に正規化する純粋関数。
//
// 責務:
//   - AI 出力の markdown フェンスを剥がす（既存 lib/ai.ts の extractJson を流用）
//   - JSON.parse 失敗・schema 違反は throw
//   - 要素レベルの schema 違反（category 不正・必須 string 欠落 等）は drop して継続
//   - personalized の sourceHint / intent は任意項目として扱う（不正なら drop、要素は残す）
//   - general / personalized は各最大 5 件に slice
//   - 両層が空になった場合は throw（救済不能と判断する）
//
// 本ファイル単体では Anthropic / fetch / storage に触れない。
//
// 関連: types/interviewQuestions.ts / lib/ai.ts(extractJson) / lib/interview/buildInterviewQuestionPrompt.ts

import { extractJson } from '@/lib/ai';
import type {
  GeneralInterviewQuestion,
  InterviewQuestionCategory,
  PersonalizedInterviewQuestion,
  PersonalizedQuestionSourceHint,
  TwoLayerInterviewQuestions,
} from '@/types/interviewQuestions';

const ALLOWED_CATEGORIES: readonly InterviewQuestionCategory[] = [
  'motivation',
  'activity',
  'self_analysis',
  'university_fit',
  'future_goal',
  'consistency_check',
  'authenticity_check',
];

const ALLOWED_SOURCE_HINTS: readonly PersonalizedQuestionSourceHint[] = [
  'statement',
  'activity',
  'self_analysis',
  'university_db',
  'admission_policy',
  'selection_steps',
];

const MAX_PER_LAYER = 5;

export function parseInterviewQuestions(rawText: string): TwoLayerInterviewQuestions {
  const jsonText = extractJson(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('INTERVIEW_QUESTIONS_PARSE_FAILED');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('INTERVIEW_QUESTIONS_INVALID_SHAPE');
  }

  if (!Array.isArray(parsed.general)) {
    throw new Error('INTERVIEW_QUESTIONS_GENERAL_NOT_ARRAY');
  }
  if (!Array.isArray(parsed.personalized)) {
    throw new Error('INTERVIEW_QUESTIONS_PERSONALIZED_NOT_ARRAY');
  }

  const general = parsed.general
    .map(toGeneral)
    .filter((q): q is GeneralInterviewQuestion => q !== null)
    .slice(0, MAX_PER_LAYER);

  const personalized = parsed.personalized
    .map(toPersonalized)
    .filter((q): q is PersonalizedInterviewQuestion => q !== null)
    .slice(0, MAX_PER_LAYER);

  if (general.length === 0 && personalized.length === 0) {
    throw new Error('INTERVIEW_QUESTIONS_EMPTY_RESULT');
  }

  return { general, personalized };
}

// ── 内部 helper ───────────────────────────────────────────────────

function toGeneral(raw: unknown): GeneralInterviewQuestion | null {
  if (!isPlainObject(raw)) return null;
  if (raw.type !== 'general') return null;
  const category = pickCategory(raw.category);
  if (!category) return null;
  const question = pickNonEmptyString(raw.question);
  const answerTip = pickNonEmptyString(raw.answerTip);
  if (!question || !answerTip) return null;
  return { type: 'general', category, question, answerTip };
}

function toPersonalized(raw: unknown): PersonalizedInterviewQuestion | null {
  if (!isPlainObject(raw)) return null;
  if (raw.type !== 'personalized') return null;
  const category = pickCategory(raw.category);
  if (!category) return null;
  const question = pickNonEmptyString(raw.question);
  const answerTip = pickNonEmptyString(raw.answerTip);
  if (!question || !answerTip) return null;

  const out: PersonalizedInterviewQuestion = {
    type: 'personalized',
    category,
    question,
    answerTip,
  };
  const sourceHint = pickSourceHint(raw.sourceHint);
  if (sourceHint) out.sourceHint = sourceHint;
  const intent = pickNonEmptyString(raw.intent);
  if (intent) out.intent = intent;
  return out;
}

function pickCategory(v: unknown): InterviewQuestionCategory | null {
  if (typeof v !== 'string') return null;
  return (ALLOWED_CATEGORIES as readonly string[]).includes(v)
    ? (v as InterviewQuestionCategory)
    : null;
}

function pickSourceHint(v: unknown): PersonalizedQuestionSourceHint | null {
  if (typeof v !== 'string') return null;
  return (ALLOWED_SOURCE_HINTS as readonly string[]).includes(v)
    ? (v as PersonalizedQuestionSourceHint)
    : null;
}

function pickNonEmptyString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
