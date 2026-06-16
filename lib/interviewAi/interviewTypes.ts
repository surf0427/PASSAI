// STEP-INTERVIEW-AI-TYPE: 面接タイプの定義 + タイプ別プロンプト方針。
//
// server（questionGen / finalFeedback）と client（UI / sourceData）の双方から import するため、
// 依存なしの純データモジュールにする（'server-only' を付けない）。
//
// interview_type は「どの機能データをもとに面接するか」。既存の session.source（voice/text の
// 回答モダリティ）とは別概念。混同しないこと。

export const INTERVIEW_TYPES = [
  'self_analysis',
  'activity',
  'statement',
  'matching',
  'essay',
  'free',
] as const;

export type InterviewType = (typeof INTERVIEW_TYPES)[number];

export function isInterviewType(v: unknown): v is InterviewType {
  return typeof v === 'string' && (INTERVIEW_TYPES as readonly string[]).includes(v);
}

// 履歴 / UI 表示ラベル。
export const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = {
  self_analysis: '自己分析ベース面接',
  activity: '活動経験ベース面接',
  statement: '志望理由書ベース面接',
  matching: '志望校マッチングベース面接',
  essay: '小論文ベース面接',
  free: 'フリー面接',
};

// 質問生成（seed / followup）でタイプごとに与える「深掘り方針」。
// item 8 のプロンプト方針を圧縮。AI へは source_context（元データ要約）と合わせて渡す。
const QUESTION_GUIDANCE: Record<InterviewType, string> = {
  self_analysis:
    '受験生の自己分析（価値観・強み・弱み・原体験・将来像・志望理由との接続）をもとに深掘りする。' +
    '価値観の一貫性 / 強みの具体例 / 弱みと向き合った経験 / 原体験 / 活動経験との接続 / ' +
    '志望理由との接続 / 将来像の一貫性 を確認し、抽象的な回答には必ず具体例を求める。',
  activity:
    '受験生の活動経験をもとに深掘りする。何をしたか / なぜ取り組んだか / どんな困難があったか / ' +
    'どう工夫したか / 何を学んだか / その経験が志望理由にどうつながるか / 他者への影響 / 再現性 を問う。',
  statement:
    '受験生の志望理由書をもとに、面接官が突っ込みそうな点を質問する。志望理由の具体性 / ' +
    '大学・学部との接続 / 学びたい内容の理解 / 将来像との一貫性 / 経験との接続 / 曖昧な表現の確認 / ' +
    '本当に本人の言葉か / 他大学ではなくその大学である理由 を確認する。',
  matching:
    '志望校マッチング結果をもとに深掘りする。なぜその大学に興味を持ったか / 価値観と大学の特徴の合致 / ' +
    '学部選択の理由 / 他大学との違い / 入学後に何をしたいか を問う。',
  essay:
    '小論文のテーマ・回答内容をもとに深掘りする。なぜその立場を取ったか / 反対意見をどう考えるか / ' +
    '具体例を出せるか / 社会課題への理解 / 自分の経験との接続 / 口頭で説明できるか を問う。',
  free:
    'データ連動なしの一般的な総合型選抜の面接として進める。志望理由 / 高校で力を入れたこと / ' +
    '自己PR / 長所・短所 / 将来像 / 入学後にやりたいこと / 最近気になるニュース などを織り交ぜる。',
};

// フィードバック（最終評価）でタイプごとに追加する観点。item 10 を圧縮。
const FEEDBACK_GUIDANCE: Record<InterviewType, string> = {
  self_analysis:
    '加えて、自己分析内容と回答が一致しているか / 強み・価値観を具体例で説明できているか / ' +
    '原体験と将来像がつながっているか を評価する。',
  activity:
    '加えて、活動経験を STAR 形式に近い形（状況・課題・行動・結果）で話せているか / ' +
    '困難・工夫・学びが明確か / 経験が志望理由に接続できているか を評価する。',
  statement:
    '加えて、志望理由書の内容を自分の言葉で話せているか / 書類と面接回答にズレがないか / ' +
    '大学理解が浅くないか を評価する。',
  matching:
    '加えて、志望校選択の理由が価値観・学びたいことと整合しているか / 他大学との違いを語れているか を評価する。',
  essay:
    '加えて、自分の立場と理由を口頭で筋道立てて説明できているか / 反対意見や具体例に触れられているか を評価する。',
  free: '一般的な総合型選抜の観点（具体性・一貫性・伝わりやすさ・志望理由との接続）で評価する。',
};

export function questionGuidanceFor(type: InterviewType): string {
  return QUESTION_GUIDANCE[type];
}

export function feedbackGuidanceFor(type: InterviewType): string {
  return FEEDBACK_GUIDANCE[type];
}

// 全タイプ共通の質問品質ルール（item 9）。seed / followup の system に必ず含める。
export const QUESTION_QUALITY_RULES =
  '【質問ルール】1ターンにつき質問は1つだけ。直前の回答を踏まえる。同じ質問を繰り返さない。' +
  '抽象的な回答には具体例を求める。矛盾があれば自然に確認する。圧迫面接にはしないが、本番で' +
  '突っ込まれる観点は入れる（甘すぎない）。高校生にもわかる日本語で、回答しやすいが考えさせる質問にする。';
