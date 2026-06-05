// /api/statement-review の input hash。STEP-LIB-02 で lib/aiInputHash.ts から分離。
// 志望理由書添削 route の input hash。
// VERSION / MODEL / Hash 型 / 関数の signature と値は分離前と完全に同一。
//
// 関連保存層: lib/statementReviewCache.ts
// 観測ログ: lib/aiCacheLog.ts / docs/principles/ai_cache_observability.md
//
// 注: signature は他 hash 関数と違う（university/faculty/department/essay 等が入る）。
// stableStringify / djb2 は共通利用。
// ANALYSIS_* / ADDITIONAL_QUESTIONS_* / SUMMARIZE_* の contract には一切影響しない。
//
// hash に含めないもの:
//   - statementReviewHistory の生データ（本文 essay / score / 日付など）。出力ストックそのもの
//   - statementReviewLimit（観測対象だが AI 入力ではない）
//   - score / feedback / 全 response 系（出力）
//   - temperature / max_tokens は PROMPT_VERSION 側で invalidate を集約
//
// hash に含めるもの（STEP-DIVERGENCE-02A で追加）:
//   - previousOutputSummary（statementReviewHistory から派生した「既出の助言・論点」の圧縮）。
//     生履歴ではなく派生 summary を入力として hash に含める。DET-2/DET-4（essay 等から
//     deterministic 派生・hash 不変）と異なり、statementReviewHistory は時間で変化するため、
//     これを hash に含めないと「同本文 + 履歴変化」で app-cache が hit し、divergence prompt が
//     再実行されず feature が実質無効になる。意図的に hash 入力へ含める（PREIMPLEMENTATION 監査）。

import { djb2 } from '@/lib/hash/djb2';
import { stableStringify } from '@/lib/hash/stableStringify';
import type { PreviousOutputSummary, UnusedExperience } from '@/types/divergence';

// PROMPT_VERSION bump 履歴:
//   v1 → v2 : STEP15b で SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE /
//             STATEMENT_REVIEW_SUBJECT_GRADES_QUALIFIER を SYSTEM_PROMPT に接続。
//             user prompt（buildStatementReviewPrompt の戻り値）は byte-identical。
//             既存 cache の意味的妥当性が変わるため lane を分離。
//   v2 → v3 : STEP4b で Admission Focus Context を user prompt に optional section として接続
//             （universityDbSection の直後に admissionFocusContext を差し込み）。
//             university / faculty / department / examTypes から deterministic に派生するため
//             hash 入力構造は変更しないが、同入力でも prompt 本文が変わり improvements /
//             weaknesses / actions の出力が大学側の評価軸を反映するようになるため bump 必須。
//   v3 → v4 : STEP5b で SYSTEM_PROMPT のスコアルール矛盾を解消。
//             旧 v3 は「各項目 8〜20」「totalScore 60〜100」「totalScore は合計と一致」の
//             三者が低品質エッセイ（各軸合計 40〜59）で同時成立せず、Claude が floor を優先して
//             合計と一致しない totalScore を返していた。v4 では totalScore を「5 項目の単純合計
//             値そのまま・サーバで再計算」と明記し、60 点未満禁止と合計一致の二重制約を撤廃。
//             hash 入力構造 / JSON contract / 各 score 範囲（8〜20）は不変。出力 totalScore の
//             数値分布が変わるため既存 v3 cache の意味的妥当性が変わり bump 必須。
//   v4 → v5 : STEP-F で hash 入力から wallHittingResult を除外し、自己分析素材の
//             cache identity を canonical StudentProfile 一本に揃える。同素材を
//             studentProfile / wallHittingResult の 2 object で二重に hash していたのを
//             1 object に縮める変更（hash 入力構造が変わる）。route.ts / prompt 本文は
//             不変で、prompt 側は今後も studentProfile ?? toStudentProfile(wallHittingResult)
//             の fallback を維持するため、wallHittingResult-only ユーザの prompt 品質は
//             落ちない。bump によって旧 v4 cache は一律 miss になる（intentional 1 回損失）。
//             STEP-F は minimum migration。studentProfile.generatedAt drift の完全解消は
//             別 STEP（hash 入力を sourceHash 一本に絞る等）として残す。
//   v5 → v6 : STEP C（applicantType）で buildStatementStudentProfileContext に
//             applicantType（5 種 enum）から派生する「傾向: ラベル — ヒント」1 行を
//             optional context として注入。APPLICANT_TYPE_LABELS と statement-review
//             ローカルの hint table から日本語ラベル + 短い AI 向けヒントを「断定ではない
//             参考情報」として 1 行追加する。scoring rule（5 軸 8〜20）には踏み込まない。
//             hash 入力構造（HashStatementReviewInput の signature）は不変。
//             studentProfile field は STEP A/B で applicantType を持つ形に拡張済みのため、
//             applicantType を持つ profile は studentProfile JSON の差で hash が変わる
//             （applicantType=undefined の旧 profile は hash 等価のまま）。bump によって
//             旧 v5 cache が新 prompt 出力契約に流入することを防ぐ（intentional 1 回 miss）。
//             user prompt（buildStatementReviewPrompt の戻り値）の組み立て関数は byte-identical。
//   v6 → v7 : DET-2 で detectNgWords() の判定結果を user prompt に【既知のNG指摘候補】
//             section として注入。AI が同じ phrase を再 discovery することを避け、改善提案や
//             深い構造分析に注力できるようにする。NG 検出は essay / activityData / university /
//             faculty から deterministic に派生するため、hash 入力構造（HashStatementReviewInput
//             の signature）は不変（同入力 → 同 NG → 同 prompt body の関係が cache identity を
//             保つ）。response shape / JSON contract / scoring rule（5 軸 8〜20）も不変。
//             SYSTEM_PROMPT 側に STATEMENT_REVIEW_NG_ISSUES_QUALIFIER を追加し、section の
//             解釈ルール（再判定を抑える / 重複指摘を避ける / 採点には反映しない）を AI に伝える。
//             bump により旧 v6 cache は一律 miss になる（intentional 1 回損失）が、cache hit 経路の
//             仕様は何も変えていない。
//   v7 → v8 : DET-4 で analyzeStructure() の判定結果を user prompt に【既存構造分析】
//             section として注入（DET-3 で essay-review に入れた構造注入を statement-review に
//             横展開）。AI が同じ 6 要素（trigger / problem / action / learning / future /
//             universityConnection）を再 discovery することを避け、改善提案 / partialExamples /
//             actions に token を割けるようにする。構造分析は essay のみから deterministic に
//             派生するため、hash 入力構造（HashStatementReviewInput の signature）は不変
//             （同 essay → 同 structure → 同 prompt body の関係が cache identity を保つ）。
//             response shape / JSON contract / scoring rule（5 軸 8〜20）も不変。SYSTEM_PROMPT
//             側に STATEMENT_REVIEW_STRUCTURE_ANALYSIS_QUALIFIER を追加して section の
//             解釈ルール（再判定を抑える / 採点には反映しない）を AI に伝える。DET-2 の NG
//             section と独立 / 共存（順序: structure → ng → 【本文】、大局 → 細部 → 本体）。
//             bump により旧 v7 cache は一律 miss になる（intentional 1 回損失）が、cache hit 経路の
//             仕様は何も変えていない。
//   v8 → v9 : STEP-DIVERGENCE-02A で Divergence Layer v1 を statement-review に導入。
//             statementReviewHistory から派生した PreviousOutputSummary（既出の助言・論点の圧縮）を
//             user prompt に【過去に提示済みのフィードバック】section として注入し、出力収束
//             （毎回同じ弱点・改善アクション・論点）を抑える。SYSTEM_PROMPT 側に
//             STATEMENT_REVIEW_PREVIOUS_OUTPUT_QUALIFIER を追加（探索型 + 安全弁 / 採点不反映）。
//             DET-2/DET-4 と違い、入力源（statementReviewHistory）が時間で変化するため
//             previousOutputSummary を hash 入力構造（HashStatementReviewInput）にも追加した。
//             同本文でも履歴が変われば hash が変わり、app-cache を miss させて divergence prompt を
//             必ず再実行させる（これが無いと feature が cache-hit 経路で無効化される）。
//             履歴 0/1 件・projection 空のときは previousOutputSummary が空 struct になり section も
//             出ないため prompt 本文は旧挙動と等価。bump により旧 v8 cache は一律 miss（intentional
//             1 回損失）。response shape / JSON contract / scoring rule（5 軸 8〜20）は不変。
//   v9 → v10: STEP-DIVERGENCE-03A で ThemeFrequency Layer を導入。ユーザーのテーマ偏り
//             （activityData + studentProfile から決定論派生）を user prompt に【テーマの偏り（参考）】
//             section として注入し、同じテーマへの収束を抑えて薄い／未探索テーマの探索を促す。
//             SYSTEM_PROMPT 側に STATEMENT_REVIEW_THEME_FREQUENCY_QUALIFIER を追加（探索型のみ /
//             採点・減点に不反映 / overused 否定せず underused 強制せず）。
//             ThemeFrequency は activityData + studentProfile からの deterministic 派生であり、
//             両者は既に HashStatementReviewInput に含まれている（DET-2/DET-4 と同型）。よって
//             hash 入力構造（HashStatementReviewInput の signature）は不変・新規 field を追加しない
//             （同 activityData + 同 studentProfile → 同 ThemeFrequency → 同 prompt body の関係で
//             cache identity を保つ）。route 側で buildThemeFrequency() を生成するため body 追加も
//             caller 変更も不要。prompt 本文が変わり出力が変わるため bump は必須。bump により旧 v9
//             cache は一律 miss（intentional 1 回損失）。response shape / JSON contract / scoring
//             rule（5 軸 8〜20）は不変。
//   v10 → v11: STEP-DIVERGENCE-04B で UnusedExperience Layer を導入。activityData × 使用面
//             （現 essay + statementReviewHistory.essay + selfPRs.text + interview answers +
//             StudentProfile）から「まだ活用できていない可能性のある経験」を deterministic に検出し、
//             user prompt に【まだ活用できていない可能性のある経験】section として注入。SYSTEM_PROMPT
//             側に STATEMENT_REVIEW_UNUSED_EXPERIENCE_QUALIFIER を追加（探索型 / 主軸保護 / 未使用と
//             断定せず / 捏造禁止 / 採点不反映）。
//             ThemeFrequency（03A）と違い usedText が selfPRs / interview_records などの hash 外・
//             時間変化 source を含むため activityData の単純な決定論派生ではない。よって
//             PreviousOutputSummary（02A v8→v9）と同型で unusedExperience を hash 入力構造
//             （HashStatementReviewInput）に追加する（hash 外 source の変化で同 essay でも cache を
//             miss させ stale を防ぐ）。client(edit page) で 1 回 build し hash 入力と body の両方へ
//             同一 struct を渡す（digest 不整合回避）。未送信 / unused 空 / totalExperiences < 3 の
//             ときは section も出ず prompt 本文は旧挙動と等価。bump により旧 v10 cache は一律 miss
//             （intentional 1 回損失）。response shape / JSON contract / scoring rule（5 軸 8〜20）は不変。
export const STATEMENT_REVIEW_PROMPT_VERSION = 11;
export const STATEMENT_REVIEW_MODEL = 'claude-sonnet-4-6';

// hash と prompt body の input source は STEP-F 以降 intentional に非対称:
//   - hash 入力 (本 type): canonical StudentProfile のみ。wallHittingResult は含めない
//   - prompt body (route.ts に渡す JSON): studentProfile / wallHittingResult の両方
//     （route.ts 側の prompt builder が canonical 優先 + wallHitting fallback で参照する）
// この非対称は、cache identity を canonical 一本に揃えつつ、canonical 不在ユーザの
// prompt 品質を落とさないための trade-off。app/statement/edit/page.tsx 側の呼び出し
// コメントも同趣旨を明記している。
export type HashStatementReviewInput = {
  university: string;
  faculty: string;
  department: string;
  essay: string;
  basicInfo: unknown;
  activityData: unknown;
  studentProfile: unknown;
  // STEP-DIVERGENCE-02A: 過去添削の派生 summary。未指定は関数内で null 正規化する。
  previousOutputSummary?: PreviousOutputSummary | null;
  // STEP-DIVERGENCE-04B: 未使用経験の派生 struct。usedText が hash 外・時間変化 source を含むため
  // previousOutputSummary と同様に hash 対象に含める。未指定は関数内で null 正規化する。
  unusedExperience?: UnusedExperience | null;
  model: string;
  promptVersion: number;
};

export function hashStatementReviewInput(input: HashStatementReviewInput): string {
  // STEP-DIVERGENCE-02A/04B: previousOutputSummary / unusedExperience を hash 対象に含める。
  // 未指定は null に正規化し、caller 横断（projection を送らない caller 含む）で決定論的に同じ hash に
  // なるようにする。
  const normalized = {
    ...input,
    previousOutputSummary: input.previousOutputSummary ?? null,
    unusedExperience: input.unusedExperience ?? null,
  };
  return djb2(stableStringify(normalized));
}
