// STEP-INTERVIEW-AI-TYPE: 面接タイプの定義 + タイプ別プロンプト方針。
//
// server（questionGen / finalFeedback）と client（UI / sourceData）の双方から import するため、
// 依存なしの純データモジュールにする（'server-only' を付けない）。
//
// interview_type は「どの内容をもとに面接するか / どの面接モードか」。既存の session.source
// （voice/text の回答モダリティ）とは別概念。混同しないこと。
//
// 2026-06 方針変更:
//   - 採用: self_analysis（自己分析+活動を統合） / statement / essay / free（=本番モード） / pressure（圧迫面接）
//   - 廃止: activity（自己分析へ統合）/ matching（ユーザー価値が弱いため削除）
//   DB の interview_type は CHECK 無し（migration は ADD COLUMN のみ）なので enum 変更に DB 変更は不要。

export const INTERVIEW_TYPES = [
  'self_analysis',
  'statement',
  'essay',
  'free',
  'pressure',
] as const;

export type InterviewType = (typeof INTERVIEW_TYPES)[number];

export function isInterviewType(v: unknown): v is InterviewType {
  return typeof v === 'string' && (INTERVIEW_TYPES as readonly string[]).includes(v);
}

// 履歴 / UI 表示ラベル（emoji なし。emoji はカード UI 側で付与）。
export const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = {
  self_analysis: '自己分析ベース面接',
  statement: '志望理由書ベース面接',
  essay: '小論文ベース面接',
  free: '本番モード',
  pressure: '圧迫面接モード',
};

// 質問生成（seed / followup）でタイプごとに与える「深掘り方針」。source_context（元データ要約）と
// 合わせて渡す。
const QUESTION_GUIDANCE: Record<InterviewType, string> = {
  self_analysis:
    '受験生の自己分析（価値観・強み・弱み・原体験・将来像）と活動経験を統合した内容をもとに深掘りする。' +
    '価値観と志望大学・学部の接続 / 活動経験と将来像の接続 / 強みの具体例 / 原体験 / 一貫性 を確認し、' +
    '抽象的な回答には必ず具体例を求める。' +
    '（例: 価値観の「挑戦」が志望学部とどう繋がるか / 高校時代の活動と将来像の繋がり）',
  statement:
    '受験生の志望理由書をもとに、書類との整合性を確認しながら質問する。志望理由の具体性 / ' +
    '志望理由書に書いた内容の具体例 / 大学・学部との接続 / 学びたい内容の理解 / 将来像との一貫性 / ' +
    '曖昧な表現の確認 / 本当に本人の言葉か / 他大学ではなくその大学である理由 を確認する。' +
    '（例: 志望理由書で書いた○○の具体例 / なぜ他大学ではなくこの大学か）',
  essay:
    '受験生の小論文のテーマ・主張を、口頭で説明させる練習として深掘りする。主張の根拠 / ' +
    '反対意見への応答 / 具体例 / 社会課題への理解 / 自分の経験との接続 を問う。' +
    '（例: 先ほどの小論文の主張の根拠は何か / 反対意見にどう答えるか）',
  free:
    '「本番モード」。PASSAI 内の各機能の記録（自己分析・活動整理・志望理由書・小論文・過去の面接練習）を' +
    '**利用可能な範囲で総合参照**し、本番を想定した面接を行う。完全連携ではなく、ある記録だけを使う総合モード。' +
    '記録がある場合は次を重視する: 自己分析と志望理由書の一貫性 / 活動経験と将来像の接続 / ' +
    '志望大学・学部との適合性 / 小論文で扱ったテーマの口頭説明 / 過去の面接練習で弱かった点の再確認。' +
    '記録が無い項目は無理に触れず、一般的な総合型選抜の面接（志望理由 / 自己PR / 将来像 等）として進める。',
  pressure:
    '「圧迫面接モード」。本番より少し厳しめに、回答の弱点・抽象性・他大学比較などを率直に指摘して掘り下げる。' +
    'ただし内容へのツッコミに限り、人格否定・威圧・侮辱・嘲笑は絶対に行わない。' +
    '（許可例: それは誰でも言える内容ではないか / なぜ他大学ではダメなのか / 具体例が少し抽象的ですね）',
};

// フィードバック（最終評価）でタイプごとに追加する観点。
const FEEDBACK_GUIDANCE: Record<InterviewType, string> = {
  self_analysis:
    '加えて、自己分析・活動内容と回答が一致しているか / 強み・価値観を具体例で説明できているか / ' +
    '原体験と将来像がつながっているか を評価する。',
  statement:
    '加えて、志望理由書の内容を自分の言葉で話せているか / 書類と面接回答にズレがないか / ' +
    '大学理解が浅くないか を評価する。',
  essay:
    '加えて、自分の主張と根拠を口頭で筋道立てて説明できているか / 反対意見や具体例に触れられているか を評価する。',
  free: '本番想定の総合型選抜の観点（具体性・一貫性・伝わりやすさ・志望理由との接続）で評価する。',
  pressure:
    '加えて、厳しめの質問や指摘に動揺せず、具体例・論理で落ち着いて返せているか / 弱点指摘への対応力 を評価する。' +
    '人格や性格そのものは評価対象にしない（あくまで回答内容と受け答えを評価する）。',
};

export function questionGuidanceFor(type: InterviewType): string {
  return QUESTION_GUIDANCE[type];
}

export function feedbackGuidanceFor(type: InterviewType): string {
  return FEEDBACK_GUIDANCE[type];
}

// 最終フィードバックの講評トーン（全モード共通）。
// 圧迫面接モードでも「質問」だけ厳しめにし、講評は通常モードと同等の建設的トーンに統一する。
// ユーザーを落ち込ませることは目的ではない。
export const FEEDBACK_TONE_RULES =
  '【講評トーン（全モード共通・厳守）】最終フィードバックは常に建設的なトーンで書く。' +
  '圧迫面接モードでも、講評（フィードバック）のトーンは通常モードと完全に同じにする（質問だけ厳しめ）。' +
  'ユーザーを落ち込ませない。' +
  '禁止: 高圧的な講評 / 人格否定 / 断定的な評価（「向いていない」「合格できない」等）/ ' +
  '不必要に不安を煽る表現。' +
  '改善点は建設的な表現のみで書く' +
  '（例: 「本番では追加で質問される可能性があります」「もう少し具体例があると説得力が増します」' +
  '「他大学との差別化を整理するとさらに良くなります」）。';

// タイプ別のトーン指示。pressure のみ「少し厳しめ（人格否定禁止）」、他は落ち着いたトーン。
export function toneGuidanceFor(type: InterviewType): string {
  if (type === 'pressure') {
    return (
      '【トーン】本番より少し厳しめ。回答の弱点・抽象性・他大学比較は率直に指摘してよいが、' +
      '人格否定・威圧・侮辱・嘲笑は絶対に禁止（あくまで回答内容への厳しめのツッコミに限る）。'
    );
  }
  return '【トーン】圧迫的な態度は取らず、落ち着いた口調で進める。';
}

// 全タイプ共通の質問品質ルール。seed / followup の system に必ず含める。
// 「圧迫にするか否か」は toneGuidanceFor に分離した（pressure と矛盾させないため、本ルールには含めない）。
export const QUESTION_QUALITY_RULES =
  '【質問ルール】1ターンにつき質問は1つだけ。直前の回答を踏まえる。同じ質問を繰り返さない。' +
  '抽象的な回答には具体例を求める。矛盾があれば自然に確認する。本番で突っ込まれる観点は入れる（甘すぎない）。' +
  '高校生にもわかる日本語で、回答しやすいが考えさせる質問にする。';
