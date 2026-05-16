// 面接質問生成 AI に渡す「最小素材」を組み立てる純粋関数。
//
// 責務:
//   - localStorage / DB / AI に触れない
//   - prompt 文を作らない（context builder であって prompt builder ではない）
//   - 入力素材を trim / normalize / 長さ制限して「圧縮済みの素材 object」を返すだけ
//
// 将来の使い方:
//   /api/interview-questions（未実装）が client から
//   { basicInfo, statementDraft, studentProfile, activitySummary } を受け取り、
//   本関数で素材化してから prompt builder へ渡す想定。
//
// 関連:
//   types/interviewQuestions.ts
//   lib/buildInterviewUniversityContext.ts（大学DB 側の context、別レーン）

import type { BasicInfo } from '@/types/basicInfo';
import type { StudentProfile } from '@/types/studentProfile';
import type { StatementDraft } from '@/lib/statement/review/statementStorage';
import { buildSubjectGradesPromptLines } from '@/lib/buildBasicInfoPromptSection';

// 文字数制限。AI prompt 肥大化と Claude 不安定化を予防する単純な打ち切り。
// 値は将来 prompt builder 側のチューニングで動かすが、context builder の責務として
// ここで固定する（呼び出し側で意図せず無制限に伸びるのを防ぐ）。
const STATEMENT_TEXT_MAX_CHARS = 1200;
const ACTIVITY_SUMMARY_MAX_CHARS = 800;
const STUDENT_PROFILE_LIST_MAX = 5;
const STRING_ITEM_MAX_CHARS = 200;

export type InterviewQuestionMaterialsInput = {
  basicInfo?: BasicInfo | null;
  statementDraft?: StatementDraft | null;
  studentProfile?: StudentProfile | null;
  activitySummary?: string | null;
};

export type InterviewQuestionMaterials = {
  university: string | null;
  faculty: string | null;
  department: string | null;
  examTypes: string[];

  // 科目別評定・出席状況。subjectGrades 未入力なら空配列（prompt builder は section を出さない）。
  // 値の整形ロジックは lib/buildBasicInfoPromptSection.ts の buildSubjectGradesPromptLines に集約。
  subjectGradesLines: string[];

  statementSummary: string | null;

  activitySummary: string | null;

  strengths: string[];
  interests: string[];
  futureGoals: string[];
};

export function buildInterviewQuestionMaterials(
  input: InterviewQuestionMaterialsInput,
): InterviewQuestionMaterials {
  const { basicInfo, statementDraft, studentProfile, activitySummary } = input;

  // 大学・学部・学科は statementDraft を最優先（添削対象の正本）→
  // 無ければ basicInfo.preferences[0] にフォールバック。表記ゆれ吸収は今期しない。
  const fromDraft = pickUniversityFromDraft(statementDraft ?? null);
  const fromBasic = pickUniversityFromBasicInfo(basicInfo ?? null);

  return {
    university: fromDraft.university ?? fromBasic.university,
    faculty: fromDraft.faculty ?? fromBasic.faculty,
    department: fromDraft.department ?? fromBasic.department,
    examTypes: sanitizeStringArray(basicInfo?.examTypes),
    subjectGradesLines: buildSubjectGradesPromptLines(basicInfo?.subjectGrades),
    statementSummary: compressBody(
      statementDraft?.statementText,
      STATEMENT_TEXT_MAX_CHARS,
    ),
    activitySummary: compressBody(activitySummary, ACTIVITY_SUMMARY_MAX_CHARS),
    strengths: sanitizeStringArray(
      studentProfile?.strengths,
      STUDENT_PROFILE_LIST_MAX,
    ),
    interests: sanitizeStringArray(
      studentProfile?.valueKeywords,
      STUDENT_PROFILE_LIST_MAX,
    ),
    futureGoals: sanitizeStringArray(
      studentProfile?.futureConnections,
      STUDENT_PROFILE_LIST_MAX,
    ),
  };
}

// ── 内部 helper ───────────────────────────────────────────────────

type UniversityTriple = {
  university: string | null;
  faculty: string | null;
  department: string | null;
};

function pickUniversityFromDraft(draft: StatementDraft | null): UniversityTriple {
  if (!draft) return { university: null, faculty: null, department: null };
  return {
    university: nonEmpty(draft.university),
    faculty: nonEmpty(draft.faculty),
    department: nonEmpty(draft.department),
  };
}

function pickUniversityFromBasicInfo(basicInfo: BasicInfo | null): UniversityTriple {
  const pref = basicInfo?.preferences?.[0];
  if (!pref) return { university: null, faculty: null, department: null };
  return {
    university: nonEmpty(pref.university),
    faculty: nonEmpty(pref.faculty),
    department: nonEmpty(pref.department),
  };
}

function nonEmpty(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// 連続する空白・改行を圧縮して長さで打ち切る。
// 改行は段落の意味を残すため 1 つだけ保持する（多重改行のみ畳む）。
function compressBody(
  value: string | undefined | null,
  maxChars: number,
): string | null {
  if (typeof value !== 'string') return null;
  const collapsed = value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (collapsed === '') return null;
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars - 1)}…`;
}

function sanitizeStringArray(
  input: readonly string[] | undefined | null,
  limit?: number,
): string[] {
  if (!Array.isArray(input)) return [];
  const result: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed === '') continue;
    result.push(
      trimmed.length <= STRING_ITEM_MAX_CHARS
        ? trimmed
        : `${trimmed.slice(0, STRING_ITEM_MAX_CHARS - 1)}…`,
    );
    if (limit !== undefined && result.length >= limit) break;
  }
  return result;
}
