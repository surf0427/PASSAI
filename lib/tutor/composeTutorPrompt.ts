// 受験チューターAI の prompt 合成（Exam Spine Phase 3 で app/api/tutor/route.ts から抽出）。
//
// なぜ route から出したか:
//   Phase 3 の保証は「canary ON では client 由来の人物情報が最終 prompt に載らない」こと。
//   これを機械 QA するには合成結果を route の外から観測できる必要がある。
//   route に残したままだと auth / rate limit / Anthropic を通さずに検証できず、
//   結局 QA 側でロジックを写経することになり、テストがコードを守らなくなる。
//
// 責務:
//   - body 由来 context / block2 / block3 / userPrompt / systemBlocks を組み立てる
//   - canary（spineOnlyContext）に応じて **人物情報の source** を切り替える
//
// 責務でないもの:
//   - 認証 / quota / rate limit（route の前段）
//   - Supabase read（Exam Spine: lib/examSpine/read/*）
//   - Anthropic 呼び出し / latency 計測 / usage 記録（route）
//
// 純関数:
//   fetch / Supabase / localStorage / Date.now / Math.random を持たない。
//   throw しない（各 builder を try で包み、失敗した section は '' に倒す）。
//   例外を握りつぶした事実は onBuildError で呼び出し側へ通知する（log 方針は route が決める）。
//
// 関連:
//   lib/tutor/spineContextFlag.ts（canary）
//   lib/contextBuilders/tutorContext.ts（block3 / Spine 由来）
//   scripts/exam-spine-tutor-composition-qa.ts（本 module の QA）

import {
  TUTOR_SYSTEM_PROMPT,
  buildTutorUserPrompt,
  buildTutorStudentContextSection,
} from '@/lib/tutor/tutorPrompt';
import { buildTutorPromptContext } from '@/lib/contextBuilders/tutor/buildTutorPromptContext';
import { buildTutorStudentContext } from '@/lib/contextBuilders/tutorStudentContext';
import { buildTutorSupabaseContextSection } from '@/lib/contextBuilders/tutorContext';
import type { TutorStudentContext } from '@/lib/contextBuilders/tutorContext';
import { getStudentProfileFromRequest } from '@/lib/getStudentProfileFromRequest';
import type { TutorIntent, PreferredProfileField } from '@/lib/tutor/types';

/** system block の形（Anthropic messages.create の system 配列と同じ）。 */
export type TutorSystemBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
};

/** どの段階で builder が例外を投げたか（log 用の enum。本文は含めない）。 */
export type TutorPromptBuildStage =
  | 'context'
  | 'student_context'
  | 'supabase_context';

export type ComposeTutorPromptInput = {
  /**
   * canary。**default deny**（呼び出し側が isTutorSpineContextEnabled で決める）。
   *   false … legacy 合成（block1 + block2 + block3、userPrompt に body 由来の人物情報）
   *   true  … Spine 一本化（block1 + block3。body 由来の人物情報は載せない）
   */
  spineOnlyContext: boolean;
  /** route が `await req.json()` で得た body。shape guard は各 builder に委ねる。 */
  body: Record<string, unknown>;
  intent: TutorIntent;
  preferredProfileField?: PreferredProfileField;
  /** Exam Spine が Supabase から読んだ生徒情報（block3 の素）。 */
  spineContext: TutorStudentContext;
  /** 受験生の最新メッセージ。 */
  userMessage: string;
  /** builder が throw したときの通知（log は呼び出し側の責務）。 */
  onBuildError?: (stage: TutorPromptBuildStage, error: unknown) => void;
};

export type ComposeTutorPromptResult = {
  /** Anthropic の system 配列。[0] は必ず静的 prompt + cache_control。 */
  systemBlocks: TutorSystemBlock[];
  /** messages 末尾の user prompt（intent=advice の qualifier は route が付ける）。 */
  userPrompt: string;
  /** buildTutorPromptContext の出力（userPrompt に埋め込まれる）。観測・QA 用に返す。 */
  contextString: string;
  /** block2（body 由来）。canary ON では常に ''。 */
  studentContextSection: string;
  /** block3（Spine 由来）。 */
  supabaseStudentContextSection: string;
};

export function composeTutorPrompt(
  input: ComposeTutorPromptInput,
): ComposeTutorPromptResult {
  const {
    spineOnlyContext,
    body,
    intent,
    preferredProfileField,
    spineContext,
    userMessage,
    onBuildError,
  } = input;

  // ── context 組み立て ──
  // builder は純粋関数で throw しない設計だが、念のため try で包む。
  // 万一例外が出ても contextString='' に倒して AI call は続行（graceful degradation）。
  let contextString = '';
  try {
    contextString = buildTutorPromptContext({
      // ── 人物情報（Spine が canonical を持つ）──
      // canary ON では body 由来を渡さない。sub-builder は null で '' を返すため、
      // basicInfo / studentProfile / 壁打ち結果の section が丸ごと落ちる。
      // これらは block3（Spine 由来）が唯一の source になる。
      basicInfo: spineOnlyContext ? null : body.basicInfo ?? null,
      studentProfile: spineOnlyContext
        ? null
        : getStudentProfileFromRequest({ body }),
      wallHittingResult:
        spineOnlyContext || intent !== 'self_analysis'
          ? null
          : body.wallHittingResult ?? null,
      // ── intent 固有の作業材料（Spine に durable source が無い）──
      // statementDraft / selfPRDraft は table 自体が存在せず（E-P3 / SD-1）、
      // 面接記録は Tutor の Spine reader が読む 6 source に含まれない。
      // ここを落とすと「今まさに書いている原稿」を Tutor が見失うため、
      // canary ON でも従来どおり body から受け取る。人物情報ではないので
      // source of truth の二重化にはあたらない。
      intent,
      preferredProfileField,
      statementDraft: intent === 'statement' ? body.statementDraft ?? null : null,
      statementReviewLatest:
        intent === 'statement' ? body.statementReviewLatest ?? null : null,
      interviewRecordLatest:
        intent === 'interview' ? body.interviewRecordLatest ?? null : null,
      interviewFeedbackLatest:
        intent === 'interview' ? body.interviewFeedbackLatest ?? null : null,
      selfPRDraft:
        intent === 'selfpr' && typeof body.selfPRDraft === 'string'
          ? body.selfPRDraft
          : null,
    });
  } catch (error) {
    onBuildError?.('context', error);
    contextString = '';
  }

  // ── studentContext 組み立て（STEP-TUTOR-STUDENT-CONTEXT） ──
  // PASSAI 内の保存データ（client が body で送る）を横断要約し、SYSTEM の 2 つ目の
  // block として渡す「【PASSAI内の生徒情報】」section を作る。
  //   - intent に依存せず常に組み立てる（既存 contextString とは別レイヤー）。
  //   - builder は throw しない純粋関数だが、念のため try で包み、例外時は '' に倒す
  //     （graceful degradation: studentContext 無しで AI call は続行）。
  //   - studentProfile は body の生データを直接渡す（getStudentProfileFromRequest は
  //     full StudentProfile 以外を弾くため、compact profile の strengths/weaknesses を
  //     拾えるよう builder 側の defensive guard に委ねる）。
  //
  // Exam Spine Phase 3: canary ON ではこの block 自体を組み立てない。
  //   block2（body / localStorage 由来）と block3（Supabase / Spine 由来）は
  //   同じ人物を別 source・別 truncate 規則で二重に記述していた。ON では block3 に一本化する。
  //   ⚠️ Spine 側が空でも body へ暗黙 fallback しないこと（source of truth が再び二重になる）。
  //      薄い context のまま Tutor は通常動作させる。
  let studentContextSection = '';
  if (!spineOnlyContext) {
    try {
      const studentContext = buildTutorStudentContext({
        basicInfo: body.basicInfo ?? null,
        studentProfile: body.studentProfile ?? null,
        statementReviewLatest: body.statementReviewLatest ?? null,
        activityData: body.activityData ?? null,
        essayReviewLatest: body.essayReviewLatest ?? null,
        interviewRecordLatest: body.interviewRecordLatest ?? null,
        interviewFeedbackLatest: body.interviewFeedbackLatest ?? null,
        mypageSummary: body.mypageSummary ?? null,
      });
      studentContextSection = buildTutorStudentContextSection(studentContext);
    } catch (error) {
      onBuildError?.('student_context', error);
      studentContextSection = '';
    }
  }

  // ── Supabase studentContext section（STEP-TUTOR-SUPABASE-CONTEXT-OUTPUT-01）──
  // 上の studentContextSection は client が body で送る localStorage 由来データを要約する。
  // 本 section は Supabase（self_analysis / basic_info / diagnosis / activity）由来。
  //   - context は route 側の並列ブロックで取得済み（60 秒 per-user cache 経由）。
  //     ここでは pre-loaded な spineContext を section 文字列へ整形するだけ（同期・DB なし）。
  //   - buildTutorSupabaseContextSection は throw しない純粋関数だが、念のため try で包み、
  //     例外時は '' に倒して Tutor は通常動作させる（空 context も '' を返すので従来挙動と同一）。
  let supabaseStudentContextSection = '';
  try {
    supabaseStudentContextSection = buildTutorSupabaseContextSection(spineContext);
  } catch (error) {
    onBuildError?.('supabase_context', error);
    supabaseStudentContextSection = '';
  }

  const userPrompt = buildTutorUserPrompt({ contextString, userMessage });

  // ── SYSTEM block 構成 ──
  //   block 1: TUTOR_SYSTEM_PROMPT（byte-identical / cache_control: 'ephemeral'）。
  //            cache breakpoint はここ。後段に何を足しても block 1 の cache hit は不変。
  //   block 2: studentContextSection（body 由来 / dynamic、cache 対象外）。
  //            空のときは block 自体を足さない。canary ON では常に空 = 出ない。
  //   block 3: supabaseStudentContextSection（Spine 由来 / dynamic）。
  //            空のときは block 自体を足さない。block 1 の cache breakpoint より後段。
  //   ⚠️ Spine 由来 context を block 1 へ結合してはいけない（cached prefix が壊れる）。
  const systemBlocks: TutorSystemBlock[] = [
    {
      type: 'text',
      text: TUTOR_SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' },
    },
  ];
  if (studentContextSection !== '') {
    systemBlocks.push({ type: 'text', text: studentContextSection });
  }
  if (supabaseStudentContextSection !== '') {
    systemBlocks.push({ type: 'text', text: supabaseStudentContextSection });
  }

  return {
    systemBlocks,
    userPrompt,
    contextString,
    studentContextSection,
    supabaseStudentContextSection,
  };
}
