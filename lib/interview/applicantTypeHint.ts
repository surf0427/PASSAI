// applicantType を interview prompt に「薄く」流すための feature-local helper。
//
// 責務:
//   - interview-questions / interview-feedback で共有する 5 種 hint table を 1 箇所に集約
//   - prompt に出す 1 行（「傾向（参考情報・断定ではない）: ラベル — ヒント」）の format を統一
//
// 取り扱い方針:
//   - applicantType enum 文字列（"activity_driven" 等）は prompt に出さない（日本語ラベル + ヒント文だけ）
//   - 「断定ではなく傾向」明示。本人を型に閉じ込めない
//   - scoring rule / 出力 schema / 質問数 / general 5 + personalized 5 ルールには踏み込まない
//   - 文言を変える場合は INTERVIEW_QUESTIONS_PROMPT_VERSION の bump 検討必須
//     （user prompt 本文が変わるため。interview-feedback には input cache 機構が無いので
//      bump 対象外だが、出力挙動は副作用として変わる）
//
// 関連:
//   - lib/interview/buildInterviewQuestionPrompt.ts（interview-questions の user prompt builder）
//   - lib/contextBuilders/interviewContext.ts（interview-feedback 用 builder）
//   - types/applicantType.ts（5 種 enum と日本語ラベルの単一情報源）
//   - lib/contextBuilders/statementContext.ts（statement-review STEP C の同形パターン）

import { APPLICANT_TYPE_LABELS, type ApplicantType } from '@/types/applicantType';

// applicantType（5 種）ごとに「面接で深掘る方向」を表す短いヒント。
//
// 文末は「〜は話しやすい。〜を意識する」のフォーマットに統一:
//   - 「〜は話しやすい」: applicantType に応じた「本人が語りやすい領域」を肯定する
//   - 「〜を意識する」: 過度な指示ではなく観察ヒントの語感にする（断定回避）
//
// 注意:
//   - INTERVIEW_QUESTION_SYSTEM_PROMPT の「general / personalized の方針」や
//     「PASSAI の繋がり原則（2 領域以上の橋渡し）」を上書きしないこと
//   - 採点軸（interview-feedback の levelEvaluation 含む）には踏み込まない
export const INTERVIEW_APPLICANT_TYPE_HINTS: Record<ApplicantType, string> = {
  activity_driven:
    '活動・実績は話しやすい。問題意識や学問との接続、活動の動機の深さを掘る方向を意識する',
  issue_driven:
    '社会課題への問題意識は話しやすい。自分の経験との具体的な接続、当事者性の深さを掘る方向を意識する',
  academic_driven:
    '探究・知的関心は話しやすい。具体的な行動・実践、現場経験への落とし込みを掘る方向を意識する',
  growth_driven:
    '自己成長の物語は話しやすい。大学での学びや将来像との接続、変化後の継続性を掘る方向を意識する',
  value_driven:
    '原体験・価値観は話しやすい。学問・志望先との論理的接続、行動への展開を掘る方向を意識する',
};

// applicantType から prompt 注入用の 1 行を作る純粋関数。
//
// 戻り値の format は固定:
//   「傾向（参考情報・断定ではない）: <日本語ラベル> — <ヒント文>」
//
// 本 helper を呼ぶ側は profile.applicantType / materials.applicantType が
// undefined の場合に skip する責務を持つ（戻り値は常に string）。
export function formatInterviewApplicantTypeHint(type: ApplicantType): string {
  const label = APPLICANT_TYPE_LABELS[type];
  const hint = INTERVIEW_APPLICANT_TYPE_HINTS[type];
  return `傾向（参考情報・断定ではない）: ${label} — ${hint}`;
}
