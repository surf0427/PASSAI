// Exam Spine — purpose registry（Phase 1）。
//
// 位置づけ:
//   「どの用途（purpose）が、どの source kind を必要とするか」だけを宣言する純データ層。
//   Phase 3 以降の reader は **この表に載っている kind だけを SELECT する**。
//   載っていない kind は query を発行しない = 常時全 table SELECT を構造的に防ぐ。
//
// 厳守（本ファイルの不変条件）:
//   - 純データのみ。関数は表を引くだけの純関数に限る。
//   - fetch / Supabase client / localStorage / Date.now / Math.random / AI SDK を import しない。
//   - isomorphic。'server-only' を付けない。
//   - **この表は「読む範囲」の宣言であって、prompt に載せる範囲の宣言ではない。**
//     何を prompt に出すかは各 feature の section builder が決める。
//
// ⚠️ status の意味（重要）:
//   実装済みの purpose と、Phase 4 以降に向けた宣言だけの purpose が混在する。
//   `EXAM_PURPOSE_REGISTRY[p].status` で区別すること。
//     'wired'   … 実際に Spine reader が使っている（コード実態から確定）
//     'planned' … 宣言のみ。selector 未実装。**これを根拠に実装してはいけない**
//                 （実装時は必ず対象 feature のコードを読んで kind 集合を再確認する）
//
// 関連:
//   docs/principles/exam_spine/EXAM_SPINE_ARCHITECTURE.md
//   lib/examSpine/types.ts

import type { ExamSourceKind } from './types';

// ── 1. Purpose ────────────────────────────────────────────────────

export type ExamSpinePurpose =
  // 全 purpose 共通の最小核（identity / 志望校 / 受験方式 / 学年 / 評定）。
  | 'examCore'
  // 受験相談チューター AI。現時点で唯一 server read を持つ purpose。
  | 'tutor'
  // 以下は Phase 4 以降。selector 未実装。
  | 'statementReview'
  | 'interview'
  | 'essay'
  | 'matching'
  | 'interviewAi'
  | 'presentation';

export type ExamPurposeStatus = 'wired' | 'planned';

export type ExamPurposeEntry = {
  /** この purpose が読む source kind。ここに無い kind は SELECT しない。 */
  readonly sources: readonly ExamSourceKind[];
  /** 実装状況。'planned' は宣言のみで、実装の根拠にしてはいけない。 */
  readonly status: ExamPurposeStatus;
  /** 由来（監査で確認したコード位置 / 未実装の場合は設計上の予定）。 */
  readonly provenance: string;
};

// ── 2. Registry ───────────────────────────────────────────────────

export const EXAM_PURPOSE_REGISTRY: Readonly<
  Record<ExamSpinePurpose, ExamPurposeEntry>
> = {
  examCore: {
    // 志望校 / 学部 / 学科 / 受験方式 / 学年 / 文理 / 評定 はすべて basic_info に入る。
    sources: ['basic_info'],
    status: 'planned',
    provenance:
      'types/basicInfo.ts:BasicInfo（preferences / examTypes / grade / track / subjectGrades / overallGpa）',
  },

  tutor: {
    // ⚠️ コード実態から確定（変更するときは実装も同時に変えること）。
    //    lib/contextBuilders/tutorContext.ts:loadTutorStudentContext の
    //    Promise.allSettled に並ぶ 6 loader と 1:1 で対応する。
    //    並び順もそこに合わせている（観測ログの読み合わせのため）。
    sources: [
      'self_analysis',
      'basic_info',
      'diagnosis',
      'activity',
      'interview_ai',
      'presentation',
    ],
    status: 'wired',
    provenance:
      'lib/contextBuilders/tutorContext.ts:loadTutorStudentContext（Promise.allSettled の 6 source）',
  },

  statementReview: {
    sources: ['basic_info', 'self_analysis', 'activity'],
    status: 'planned',
    provenance:
      '予定。現状は body bridge（app/api/statement-review/route.ts が basicInfo / activityData / studentProfile / wallHittingResult を受け取る）',
  },

  interview: {
    sources: ['basic_info', 'self_analysis', 'activity', 'statement_review'],
    status: 'planned',
    provenance:
      '予定。現状は body bridge（app/api/interview-questions, app/api/interview-feedback）',
  },

  essay: {
    sources: ['basic_info', 'essay'],
    status: 'planned',
    provenance: '予定。現状は body bridge（app/api/essay-review ほか essay 系 route）',
  },

  matching: {
    sources: ['basic_info', 'self_analysis', 'diagnosis'],
    status: 'planned',
    provenance: '予定。現状は body bridge（app/api/matching/route.ts）',
  },

  interviewAi: {
    // 現状この feature は人格情報を一切参照していない（監査 B5 / M7）。
    // Phase 4 で「加算のみ」の変更として接続する予定。
    sources: ['basic_info', 'self_analysis', 'statement_review', 'essay'],
    status: 'planned',
    provenance:
      '予定。現状 app/api/interview-ai/** は basicInfo / studentProfile / activityData を参照しない',
  },

  presentation: {
    // 同上（監査 B5 / M7）。
    sources: ['basic_info', 'self_analysis'],
    status: 'planned',
    provenance:
      '予定。現状 app/api/presentation/** は basicInfo / studentProfile / activityData を参照しない',
  },
} as const;

// ── 3. Lookup（純関数のみ）─────────────────────────────────────────

/** purpose が読む source kind を返す。 */
export function sourcesForPurpose(
  purpose: ExamSpinePurpose,
): readonly ExamSourceKind[] {
  return EXAM_PURPOSE_REGISTRY[purpose].sources;
}

/** purpose がその kind を読んでよいか。reader の guard に使う。 */
export function purposeUsesSource(
  purpose: ExamSpinePurpose,
  kind: ExamSourceKind,
): boolean {
  return EXAM_PURPOSE_REGISTRY[purpose].sources.includes(kind);
}

/** 実際に reader が接続済みの purpose かどうか。 */
export function isPurposeWired(purpose: ExamSpinePurpose): boolean {
  return EXAM_PURPOSE_REGISTRY[purpose].status === 'wired';
}
