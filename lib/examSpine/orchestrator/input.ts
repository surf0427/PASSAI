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
import type { ExamSourceKind } from '../sourceData/types';

/**
 * durable table を持たない context slot（Spine の 10 kind に写像できないもの）。
 * ★ 増やすときは E-P3 / E-S9 と突き合わせること。「まだ実装していない」ものは入れない。
 */
export type ExamNotServerCapableSlot = 'statementDraft';

/**
 * Layer 2 の入力。すべて optional で、渡されなかった slot の block は
 * presence='missing' になる（空文字が渡された 'empty' とは区別する）。
 *
 * ★ `undefined`（未指定）と `null`（明示的に無い）は Stage 2 では同じ 'missing' に倒す。
 *   legacy builder も両者を区別しないため、ここで区別すると byte が合わなくなる。
 */
export type ExamContextInput = {
  /**
   * §Context Origin — **既定値のみ**（E-S26）。
   *
   * ★ これ 1 個で context 全体の origin を表現してはいけない ★
   *   移行期は 1 つの context の中で kind ごとに origin が違うのが常態である。実例:
   *     basicInfo        server 経路あり（tutor は既に server で読んでいる）
   *     statementDraft   durable table が存在しない = not_server_capable（E-P3 で恒久）
   *     activityData     server 経路はあるが canary OFF なら bridge
   *   単一値ではこの 3 者を同時に表現できず、Canon §17 が禁じる
   *   「暗黙的 Mixed-Origin」をそのまま作ることになる。
   *
   *   したがって本 field は `origins` に該当エントリが無い slot の **fallback** に降格する。
   *   未指定時の既定は 'bridge'（client 由来の値を受けている現状に一致する）。
   */
  origin?: ExamContextOrigin;

  /**
   * §Context Origin — **kind 単位の申告**（E-S26 / Canon §17 / E-P7）。
   *
   *   key は Layer 1 の `ExamSourceKind`。その kind に由来する block だけがこの値を受け取る。
   *   kind を持たない block（feature 入力 / 静的 section）は `origin` の既定値を受ける。
   *
   *   ★ Stage 2 はこの値で分岐しない。透過して block に載せるだけである。
   *     veto / verification / 選択の変更は Stage 4 以降の責務であり、ここには入れない。
   *
   *   ★ 「server 経路があるか」ではなく「**今回この値をどこから取ったか**」を書く。
   *     server 経路が存在しても今回 bridge から受けたなら 'bridge' である。
   */
  origins?: Readonly<Partial<Record<ExamSourceKind, ExamContextOrigin>>>;

  /**
   * durable source を持たない slot の origin（E-P3 / E-S9 の structural bridge）。
   *
   *   `ExamSourceKind` に対応しないため `origins` では表現できない。
   *   現状の該当例: `statementDraft`（E-P3 で恒久据え置き）。
   *   ここに書かれた slot は観測上 `not_server_capable` として数え、
   *   canary 中の bridge 率に混ぜない（E-S9）。
   */
  notServerCapableSlots?: readonly ExamNotServerCapableSlot[];

  // ── Layer 1 由来 ────────────────────────────────────────────────
  basicInfo?: BasicInfo | null;
  universityContext?: UniversityContext | null;
  interviewUniversityContext?: string | null;
  essayUniversityContext?: string | null;
  admissionFocusContext?: string | null;
  /** 面接向け受験方式ガイダンス（route が組み立てて渡している文字列）。 */
  interviewExamTypeGuidance?: string | null;

  /**
   * 診断タイプから導いた会話補助 hint（`resolveDiagnosisTypeHint` の出力）。
   *
   * ★ payload そのものを渡さない ★
   *   `diagnosis_logs.payload` には resultTitle / resultDescription / answers /
   *   createdAt が入るが、Tutor が prompt に出しているのは hint 1 文だけである。
   *   raw payload を Layer 2 へ持ち込むと不要な情報が block へ流れる（Canon §55 / E-P5）。
   */
  diagnosisTypeHint?: string | null;

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
