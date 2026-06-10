// /api/interview-questions の input hash。STEP-LIB-02 で lib/aiInputHash.ts から分離。
// 面接質問生成 route の input hash。
// VERSION / MODEL / Hash 型 / 関数の signature と値は分離前と完全に同一。
//
// 関連保存層: lib/interviewQuestionCache.ts
// 観測ログ: lib/aiCacheLog.ts / docs/principles/ai_cache_observability.md
//
// 注: signature は他 hash 関数と違う（statementDraft / studentProfile / activitySummary が入る）。
// stableStringify / djb2 は共通利用。既存 _PROMPT_VERSION / _MODEL の contract には一切影響しない。
//
// hash に含めるもの:
//   - basicInfo（大学 / 学部 / 学科 / 受験方式）→ user prompt と route 内 universityContext を左右する
//   - statementDraft（university/faculty/department/statementText）→ 個別質問の根拠
//   - studentProfile（strengths / valueKeywords / futureConnections / 等）→ 自己分析セクション
//   - activitySummary（壁打ち由来の活動まとめ）→ 活動深掘り質問の根拠
//
// hash に含めないもの:
//   - generatedAt / sourceHash 等の出力メタ
//   - loading / UI state
//   - additionalQuestions の追加結果（legacy 用、AI 出力対象外）

import { djb2 } from '@/lib/hash/djb2';
import { stableStringify } from '@/lib/hash/stableStringify';

// PROMPT_VERSION bump 履歴:
//   v1 → v2 : STEP15c で SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE /
//             INTERVIEW_QUESTIONS_SUBJECT_GRADES_QUALIFIER を SYSTEM_PROMPT に接続。
//             user prompt（buildInterviewQuestionUserPrompt / buildInterviewQuestionMaterials の
//             戻り値）は byte-identical。既存 cache の意味的妥当性が変わるため lane を分離。
//   v2 → v3 : STEP E（applicantType）で buildInterviewQuestionMaterials に optional
//             applicantType field を追加し、buildInterviewQuestionUserPrompt 内の
//             【自己分析サマリー】セクション末尾に「傾向（参考情報・断定ではない）:
//             ラベル — ヒント」1 行を optional 注入。INTERVIEW_QUESTION_SYSTEM_PROMPT /
//             TwoLayerInterviewQuestions schema / 質問数 10 / general 5 + personalized 5
//             ルールには 1 字も踏み込まない。
//             hash 入力構造（HashInterviewQuestionsInput の signature）は不変。
//             studentProfile field は STEP A/B で applicantType を持つ形に拡張済みのため、
//             applicantType を持つ profile は studentProfile JSON の差で hash が分岐する
//             （applicantType=undefined の旧 profile は hash 等価のまま）。bump によって
//             旧 v2 cache が新 prompt 出力契約に流入することを防ぐ（intentional 1 回 miss）。
//             buildInterviewStudentProfileContext（interview-feedback 専用）も同 hint table
//             を共有するため出力挙動には副作用として影響あり。interview-feedback には input
//             cache 機構が無いため bump 対象外。
//   v3 → v4 : 日次バリエーション seed を導入。HashInterviewQuestionsInput に dailySeed
//             (YYYY-MM-DD / JST) を追加し、buildInterviewQuestionUserPrompt の末尾に
//             【出題バリエーション指示】セクションを 1 つ optional 追加。
//             system prompt / TwoLayerInterviewQuestions schema / 質問数 10 / category 許可値 /
//             代筆禁止 / authenticity_check ルール / temperature は 1 字も変えない。
//             同日 = 同 hash → cache hit、翌日 = 異なる hash → cache miss で再生成。
//             dailySeed が undefined の場合は legacy prompt と byte-identical（hash も
//             stableStringify で undefined を畳むため v3 hash と等価）。クライアントが
//             dailySeed を送らない場合は事実上 v3 と同じ挙動になる安全側 fallback。
//             bump により旧 v3 cache（dailySeed なしで生成）が新 prompt 出力契約と
//             混ざらないようにする（intentional 1 回 miss）。
//   v4 → v5 : 出題バリエーション指示の構造化。【出題バリエーション指示】section の中身を
//             4 ブロック（固定重要枠 / 日替わり深掘り枠 / 接続確認枠 / 偏りと喪失の禁止）に
//             書き換え、「最重要エピソード」の判定基準と「単一活動 3 問超え禁止 + 最低 1 問
//             残す」の保護ルールを明文化した。
//             system prompt / TwoLayerInterviewQuestions schema / 質問数 10 / personalized
//             必須 category 5 種 / category 許可値 / authenticity_check の作り方 / 代筆禁止 /
//             temperature / max_tokens / model は 1 字も変えない。HashInterviewQuestionsInput
//             の signature も不変（v4 と同じく optional dailySeed のみ）。
//             bump により v4 cache（緩い variation 指示で生成）が新ルール出力契約と混ざる
//             のを防ぐ（intentional 1 回 miss）。dailySeed 未送信 client は v4 と同様
//             legacy 経路に落ちる（section ごと省略）。
//   v5 → v6 : STEP-AUDIT-TOP1-5-FIX-01 で VALIDATION_RETRY_HINT を緩和した。
//             旧 hint は厳格な禁止条項を並べて AI を萎縮させ bland な質問を生む副作用が
//             観測されたため、禁止だけ伝えて創造性（深掘り度・固有名詞言及）を保つ方針に
//             refinement。validate fail 経路のみ影響する変更だが、retry 経由で生成された
//             cache entry の意味的妥当性が変わるため lane 分離が必要。
//             first-attempt prompt / system prompt / schema / 質問数 / category / 代筆禁止 /
//             temperature は 1 字も変えない。
//   v6 → v7 : 出力収束化対策。SYSTEM_PROMPT に【personalized の問い方（観点）の分散】
//             （観点バンク10種 + 同一問い方 3 問超え禁止 + 「学び/成長」系 1 問上限）と
//             【安全回答への収束防止】（リーダーシップ/コミュ力/成長 等の無難な抽象語着地を回避）
//             を追加。user prompt の【出題バリエーション指示】に「seed で観点割り当ても回す」
//             「同一観点 3 問超え禁止」を追記。schema / 質問数 10 / general5+personalized5 /
//             category 許可値 / sourceHint / authenticity_check の作り方 / 代筆禁止 / temperature /
//             max_tokens / model / HashInterviewQuestionsInput の signature は 1 字も変えない。
//             prompt 文言が変わるため、旧 v6 cache（観点分散指示なしで生成）が新出力契約と
//             混ざらないよう lane 分離（intentional 1 回 miss）。dailySeed 未送信 client も
//             SYSTEM 側の観点分散ルールは効くため legacy fallback でも改善が届く。
export const INTERVIEW_QUESTIONS_PROMPT_VERSION = 7;
export const INTERVIEW_QUESTIONS_MODEL = 'claude-sonnet-4-6';

export type HashInterviewQuestionsInput = {
  basicInfo: unknown;
  statementDraft: unknown;
  studentProfile: unknown;
  activitySummary: unknown;
  // 日次バリエーション seed。'YYYY-MM-DD'（JST）または undefined。
  // 同日内では cache hit を維持し、日が変われば hash が変わる軸として機能する。
  // 値の生成は client（InterviewQuestionForm）で行い、route 側にも body 経由で同値を送る
  // ことで client / server の hash 計算が一致する前提。undefined のときは hash から落ちる
  // ため v3 と互換（プロンプトも byte-identical 経路）。
  dailySeed?: string;
  model: string;
  promptVersion: number;
};

export function hashInterviewQuestionsInput(input: HashInterviewQuestionsInput): string {
  return djb2(stableStringify(input));
}
