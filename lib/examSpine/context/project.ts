// PASSAI 受験版 Exam Spine — Stage 4 server projection → Stage 2 入力（純関数のみ）。
//
// 責務: Stage 3 の server row projection を、**Stage 2 の frozen contract が受け取れる形**へ写す。
//
// ★ Stage 2 を変更しない ★
//   Stage 2（blocks / orchestrator）は byte-equivalence 済みで凍結されている（E-S25）。
//   したがってここは「Stage 2 の入力型に合わせる」側であって、Stage 2 を server row に
//   合わせて曲げる側ではない。
//
// ★ 無いものを作らない（E-P8）★
//   basic_info の `name` は server に存在しない。ここで `''` を捏造せず、
//   bridge が name を持つときだけ合成し、**合成したことを bridgeFields として記録**する。
//   Canon §17 が禁じるのは *暗黙の* Mixed-Origin であり、明示すれば許容される。
//
// 禁止: I/O / Supabase / fetch / localStorage / Date / Date.now / Math.random / AI。
//   `projectionNow` は必ず引数で受け取る（Stage 2 の純関数性を壊さないため）。

import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { WallHittingResult } from '@/types/analysis';
import type { PreviousOutputSummary } from '@/types/divergence';
import { buildPreviousOutputSummary } from '@/lib/contextBuilders/divergence/buildPreviousOutputSummary';

import type {
  ExamActivityServerRow,
  ExamBasicInfoServerRow,
  ExamSelfAnalysisServerRow,
  ExamStatementReviewServerRow,
} from '../read/rowMappers';

/** projection の結果と、bridge から補った field。 */
export type ExamProjection<T> = {
  readonly value: T | null;
  /** server に無く bridge から取った field 名（origin='server' でも記録する）。 */
  readonly bridgeFields: readonly string[];
};

const NONE: ExamProjection<never> = { value: null, bridgeFields: [] };

/**
 * basic_info: server row（氏名なし）＋ bridge の氏名 → `BasicInfo`。
 *
 * ★ `name` が bridge にも無い場合でも `''` で埋めない ★
 *   `BasicInfo.name` は必須だが、空文字を入れると
 *   「氏名が空のユーザー」と「氏名が取れなかった」が区別できなくなる（E-P8）。
 *   したがって bridge に name が無ければ **projection 自体を返さない**（null）。
 *   その kind は bridge 側の値がそのまま使われる（E-P7: context を減らさない）。
 */
export function projectBasicInfo(
  row: ExamBasicInfoServerRow | null,
  bridge: BasicInfo | null,
): ExamProjection<BasicInfo> {
  if (!row) return NONE;
  const name = bridge?.name;
  if (typeof name !== 'string' || name === '') return NONE;

  const value: BasicInfo = {
    ...(bridge ?? ({} as BasicInfo)),
    name,
    grade: row.grade ?? '',
    track: row.track ?? '',
    examTypes: [...row.examTypes],
    preferences: row.preferences.map((p) => ({
      university: p.university,
      faculty: p.faculty ?? '',
      department: p.department ?? '',
    })),
    ...(row.overallGpa === null ? {} : { overallGpa: row.overallGpa }),
    ...(row.subjectGrades === null ? {} : { subjectGrades: { ...row.subjectGrades } }),
  } as BasicInfo;

  return { value, bridgeFields: ['name'] };
}

/**
 * activity: `activity_logs.payload` は `ActivityData` を **無加工**で mirror している
 * （writer に strip が無い）。したがって shape guard を通したうえでそのまま使える。
 *
 * ★ カテゴリ名を Spine 側で固定しない ★
 *   schema.sql の COMMENT は「9 カテゴリ」だが実体は 10 であり、増減しうる。
 *   key を列挙せず、配列である value だけを採る。
 */
export function projectActivity(
  row: ExamActivityServerRow | null,
): ExamProjection<ActivityData> {
  if (!row?.payload) return NONE;
  const out: Record<string, unknown> = {};
  let arrays = 0;
  for (const [key, value] of Object.entries(row.payload)) {
    if (!Array.isArray(value)) continue;
    out[key] = value;
    arrays += 1;
  }
  if (arrays === 0) return NONE;
  return { value: out as unknown as ActivityData, bridgeFields: [] };
}

/**
 * self_analysis: `self_analysis_logs.analysis` は `WallHittingResult` 相当の jsonb。
 *
 * ★ ここで `toStudentProfile()` を呼ばない ★
 *   `toStudentProfile` は既定で `new Date()` を使い、`generatedAt` / `sourceHash` を
 *   生成するため Spine が非決定的になる。Stage 2 は `wallHittingResult` ＋
 *   `projectionNow` を受け取る口を既に持っているので、そちらへ渡す
 *   （同じ pure selector を client / server で共有する = E-P6）。
 */
export function projectSelfAnalysis(
  rows: readonly ExamSelfAnalysisServerRow[] | null,
): ExamProjection<WallHittingResult> {
  const latest = rows?.[0];
  if (!latest?.analysis) return NONE;
  const analysis = latest.analysis;
  // 最低限の shape 確認。1 つも使える field が無ければ projection しない。
  const usable =
    typeof analysis.summary === 'string' ||
    Array.isArray(analysis.strengths) ||
    Array.isArray(analysis.weaknesses) ||
    Array.isArray(analysis.futureConnections);
  if (!usable) return NONE;
  return { value: analysis as unknown as WallHittingResult, bridgeFields: [] };
}

/**
 * statement_review: 履歴 → `PreviousOutputSummary`。
 *
 * ★ 本文（`essay` 列）は Stage 3 が SELECT していない ★
 *   ここで使うのは `result` の weaknesses / actions / strengths だけであり、
 *   client 側（`app/statement/edit/page.tsx:482`）が渡している compact projection と
 *   **同じ形・同じ builder** を通す（E-P6。server で作り直さない）。
 */
export function projectStatementReview(
  rows: readonly ExamStatementReviewServerRow[] | null,
): ExamProjection<PreviousOutputSummary> {
  if (!rows || rows.length === 0) return NONE;
  const compact = rows.map((row) => ({
    weaknesses: row.result?.weaknesses,
    actions: row.result?.actions,
    strengths: row.result?.strengths,
  }));
  const summary = buildPreviousOutputSummary(compact);
  // 材料が足りず空 struct になったなら「server から作れなかった」として扱う。
  if (summary.repeatedAdvice.length === 0 && summary.repeatedThemes.length === 0) return NONE;
  return { value: summary, bridgeFields: [] };
}
