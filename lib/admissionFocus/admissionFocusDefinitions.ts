// AdmissionFocusType ごとの label / description / emphasis / risks 定義（STEP1a）。
//
// 責務:
// - 各 type の AI prompt 用 context 生成（buildAdmissionFocusContext、後続 STEP1c）で
//   利用される静的定義のみを置く。
// - 推定ロジックや context 文字列組み立てはここに書かない。
//
// 設計方針:
// - emphasis / risks の語彙は lib/admissionEvaluationAxes.ts で使われている評価軸ラベル
//   （主体性 / 論理性 / 異文化理解 / 志望理由の一貫性 / 具体的な経験 等）と意図的に揃える。
//   将来 AxisId 化（focus type → evaluation axes 合流）する PR で diff を最小化するため。
//   STEP1a 時点では plain readonly string[] のまま。AxisId 型は今期切らない。
// - 'unknown' は emphasis / risks を空にし、context builder 側で
//   GENERIC_EMPHASIS_FALLBACK を使うか / 空文字を返すかを判断する。
//
// 公開ポリシー:
// - admissionFocusDefinitions は feature コードから直接 import しない想定
//   （context フォーマットの責務漏れを避けるため）。直接の consumer は
//   buildAdmissionFocusContext.ts（STEP1c）のみ。
//
// 関連: lib/admissionFocus/types.ts / lib/admissionEvaluationAxes.ts

import type { AdmissionFocusType } from '@/lib/admissionFocus/types';

export type FocusDefinition = {
  readonly label: string;
  readonly description: string;
  readonly emphasis: readonly string[];
  readonly risks: readonly string[];
};

export const admissionFocusDefinitions: Record<AdmissionFocusType, FocusDefinition> = {
  activity_appeal: {
    label: '活動アピール型',
    description:
      '高校生活で取り組んだ活動と、そこから得た学び・主体性を中心に評価する型。',
    emphasis: [
      '活動の継続性',
      '主体性',
      '具体的な経験',
      '学びへの接続',
    ],
    risks: [
      '実績の羅列で内省が見えない',
      '大学で学びたいこととの接続不足',
      '活動の規模で語ろうとする',
    ],
  },
  essay_heavy: {
    label: '小論文重視型',
    description:
      '小論文を通じて、論理性・問題意識・社会課題への理解を評価する型。',
    emphasis: [
      '論理性',
      '問題意識',
      '社会課題への関心',
      '考察の深さ',
    ],
    risks: [
      '主張だけで根拠が薄い',
      '時事知識に偏り自分の考察が無い',
      '構成が破綻している',
    ],
  },
  interview_heavy: {
    label: '面接重視型',
    description:
      '複数回の面接や口頭試問で、一貫性・深掘り耐性・自分の言葉で語る力を評価する型。',
    emphasis: [
      '志望理由の一貫性',
      '自分の言葉で語る力',
      '深掘りされたときの応答力',
      '対話姿勢',
    ],
    risks: [
      '暗記回答に見える',
      '志望理由書と発話内容のズレ',
      '回答が抽象的で具体例が出てこない',
    ],
  },
  presentation: {
    label: 'プレゼン型',
    description:
      'プレゼンテーション・発表課題を通じて、構成力・伝達力・提案の独自性を評価する型。',
    emphasis: [
      '構成力',
      '伝達力',
      '提案の独自性',
      '質疑応答での対応力',
    ],
    risks: [
      '内容が浅く形式に頼る',
      'スライド作成だけに労力が偏る',
      '想定質問への準備不足',
    ],
  },
  academic_mixed: {
    label: '学力複合型',
    description:
      '評定・資格・筆記試験など学力面の基準を含み、書類・面接と複合的に評価する型。',
    emphasis: [
      '評定・学業成績',
      '志望分野への基礎学力',
      '志望理由書・面接との整合性',
    ],
    risks: [
      '学力要件のみに依存して志望動機が薄い',
      '書類と面接で語る内容のずれ',
    ],
  },
  international: {
    label: '国際型',
    description:
      '英語資格・留学経験・多文化理解など国際性を中心に評価する型。',
    emphasis: [
      '異文化理解',
      '英語力・外国語運用力',
      '国際課題への関心',
      '多様性への姿勢',
    ],
    risks: [
      '資格スコアだけで動機が見えない',
      '海外経験の表面的な記述',
      '日本語での思考力が見えない',
    ],
  },
  unknown: {
    label: '型不明',
    description:
      'DB 上の情報から特定の型を推定できない、または DB 未整備の状態。',
    emphasis: [],
    risks: [],
  },
};

// state (c) — signal はあるが型に偏りが無いケース用の一般原則 fallback。
// buildAdmissionFocusContext（STEP1c）で「参考」「一般的に重視されやすい」等の
// 曖昧化と共に提示する。
// 注:
// - admission_policy 由来ではなく hardcode する（DB 未整備の状態を AI が補正している
//   ように見せないため）。
// - 語彙は admissionEvaluationAxes.ts の汎用プリセット（PRESET_GENERAL）と揃えている。
export const GENERIC_EMPHASIS_FALLBACK: readonly string[] = [
  '志望理由の一貫性',
  '主体性',
  '学びへの接続',
];
