// PASSAI 受験版 Exam Spine — Layer 2 の入力 contract（Stage 2 / 型のみ）。
//
// ★ Stage 2 は Source Reader を作らない（Stage 3 の責務）。
//   本 type は「**すでに手元にある値**をどう block 化するか」だけを表す container であり、
//   Supabase 行でも localStorage の生 JSON でもない。row → domain の写像（rowMapper）は
//   Stage 3 が決める（sourceData/types.ts の ExamSourceBundle が `unknown` slot のままなのは
//   そのため）。ここで既存 domain 型を使うのは、Stage 2 が現行 prompt builder と
//   **同じ入力**を受けて同じ byte を出すことを検証するためである。
//
// 純粋な型のみ（I/O / env / Supabase / AI / Date 非依存）。
//
// 関連 Decision: E-P3（statementDraft は structural bridge）/ E-S9（origin 3 値）。

import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { UniversityContext } from '@/types/universityContext';
import type { StudentProfile } from '@/types/studentProfile';
import type { WallHittingResult } from '@/types/analysis';
import type { StatementDraft } from '@/lib/statement/review/statementStorage';
import type { NgWordIssue } from '@/lib/detectNgWords';
import type { StructureAnalysis } from '@/lib/structureAnalysis';
import type {
  PreviousOutputSummary,
  ThemeFrequency,
  UnusedExperience,
} from '@/types/divergence';
import type { TutorStudentContextInput } from '@/types/tutorContext';
import type { ExamContextOrigin } from '../types';

/**
 * Layer 2 の入力。すべて optional で、渡されなかった slot の block は
 * presence='missing' になる（空文字が渡された 'empty' とは区別する）。
 *
 * ★ `undefined`（未指定）と `null`（明示的に無い）は Stage 2 では同じ 'missing' に倒す。
 *   legacy builder も両者を区別しないため、ここで区別すると byte が合わなくなる。
 */
export type ExamContextInput = {
  /**
   * §Context Origin。Stage 2 は取得をしないので、caller の申告を block へ透過するだけ。
   * 既定は 'bridge'（client 由来の値を受けている現状に一致する）。
   */
  origin?: ExamContextOrigin;

  // ── Layer 1 由来 ────────────────────────────────────────────────
  basicInfo?: BasicInfo | null;
  universityContext?: UniversityContext | null;
  interviewUniversityContext?: string | null;
  essayUniversityContext?: string | null;
  admissionFocusContext?: string | null;
  /** 面接向け受験方式ガイダンス（route が組み立てて渡している文字列）。 */
  interviewExamTypeGuidance?: string | null;

  activityText?: string | null;
  activityData?: ActivityData | null;
  activitySummary?: string | null;

  studentProfile?: StudentProfile | null;
  /**
   * StudentProfile が無い場合の後方互換経路（statement_review）。
   * toStudentProfile() は既定で new Date() を使うため、Stage 2 では純関数性を保つために
   * `projectionNow` を必須にしている（§Pure Functions Only）。
   */
  wallHittingResult?: WallHittingResult | null;
  projectionNow?: string;

  /** E-P3 の structural bridge。server-readable な durable source が無い。 */
  statementDraft?: StatementDraft | null;

  ngIssues?: NgWordIssue[] | null;
  structureAnalysis?: StructureAnalysis[] | null;
  previousOutputSummary?: PreviousOutputSummary | null;
  themeFrequency?: ThemeFrequency | null;
  unusedExperience?: UnusedExperience | null;
  tutorSources?: TutorStudentContextInput | null;

  // ── feature 入力（当該 purpose 専用。他 purpose へは配られない）──
  statementTarget?: {
    university: string;
    faculty: string;
    department: string;
  } | null;
  statementBody?: string | null;
  selfPrBody?: string | null;
  /** summarize の 【AI分析】/【深掘り質問と回答】の材料。 */
  analysis?: WallHittingResult | null;
  answers?: string[] | null;
  deepAnswers?: string[] | null;
  freeMemo?: string | null;
  existingQuestions?: string[] | null;
  dailySeed?: string | null;
};
