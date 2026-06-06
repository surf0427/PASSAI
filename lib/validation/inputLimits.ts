// AI route 入力の最大文字数（上限ガード）。
//
// 目的（B2: AI 入力長無制限の解消）:
//   - LLM コスト爆発を防ぐ（prompt に埋め込む自由記述の総量を上限で抑える）
//   - 悪意ある巨大入力を拒否する
//
// 性質:
//   ここは「上限の安全弁」であり、UX ガイダンス（最小文字数 / 反復文字 / placeholder
//   などの品質ルール）は lib/validation/validate*Input.ts 側が持つ。値はいずれも
//   実際の総合型選抜入力の数倍の余裕を取っており、既存 UX の正常入力では踏まない。
//
//   tutor route は固有の MAX_MESSAGE_LENGTH=500（チャット 1 メッセージ）を維持する。
//   本定数は tutor 以外の route の自由記述に適用する。
export const INPUT_MAX_LENGTHS = {
  /** 本文（志望理由書 / 小論文 本文）。実上限 ~2400 字に対し約 3 倍の余裕。 */
  ESSAY: 8000,
  /** 単一の自由記述（質問 / 動機 / メモ / 理由要素 / 素材メモ など）。 */
  TEXT: 2000,
  /** 大学 / 学部 / 学科名・テーマ軸など短い構造化テキスト。 */
  LABEL: 200,
  /** formatActivityData() 後の活動データ全体。 */
  ACTIVITY_TOTAL: 12000,
  /** 自由記述配列（answers[] / deepAnswers[] / questionsAndAnswers[] 等）の合計。 */
  ANSWERS_TOTAL: 12000,
} as const;
