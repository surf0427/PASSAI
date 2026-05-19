// 受験生側の「型（傾向）」を表す内部ラベル。
//
// 自己分析の AI 出力から推定し、StudentProfile に optional で保存する。
// 下流（statement / interview / essay / matching）の prompt context に
// 「参考情報」として注入するのが主用途。
//
// 取り扱い方針:
// - UI で MBTI のように強く見せない（内部 prompt context 用）
// - 断定ではなく「傾向」として扱う
// - 単一値（複数併記しない）
// - optional。未推定の StudentProfile も後方互換で受け入れる
//
// 5 種を増減する場合は ANALYSIS_PROMPT_VERSION の bump 検討が必要（出力ラベル集合の変更）。

export type ApplicantType =
  | 'activity_driven'
  | 'issue_driven'
  | 'academic_driven'
  | 'growth_driven'
  | 'value_driven';

export const APPLICANT_TYPE_LABELS: Record<ApplicantType, string> = {
  activity_driven: '活動実績型',
  issue_driven: '社会課題型',
  academic_driven: '学問探究型',
  growth_driven: '自己成長型',
  value_driven: '原体験・価値観型',
};

export const APPLICANT_TYPE_DESCRIPTIONS: Record<ApplicantType, string> = {
  activity_driven:
    '行動・実績・運営や成果づくりを通じて自分を表現する傾向。リーダー経験や主体的な取り組みが軸になりやすい。',
  issue_driven:
    '社会の課題や違和感への問題意識が出発点になる傾向。解決したいテーマや社会貢献の文脈で語られやすい。',
  academic_driven:
    '学問的関心や知的好奇心が出発点になる傾向。「なぜ？」を起点にした探究や研究テーマで語られやすい。',
  growth_driven:
    '挑戦・克服・自己変化を通じて自分を語る傾向。「自分を変えたい」というモチベーションが軸になりやすい。',
  value_driven:
    '原体験・人との関わり・感情的経験から価値観を語る傾向。人生経験から導かれる価値観が軸になりやすい。',
};

// 列挙体の canonical list。AI 出力の validation と prompt 内の候補列挙の
// 単一情報源にするための readonly tuple。要素を増減する場合は ANALYSIS_PROMPT_VERSION
// の bump（出力ラベル集合の変更）を必ず検討すること。
export const APPLICANT_TYPES: readonly ApplicantType[] = [
  'activity_driven',
  'issue_driven',
  'academic_driven',
  'growth_driven',
  'value_driven',
] as const;

// AI 出力 / 永続化データから読み取った任意値が ApplicantType として有効かを判定する type guard。
// route 側で「不正な applicantType は drop」のために使う（STEP B）。
export function isApplicantType(value: unknown): value is ApplicantType {
  return (
    typeof value === 'string' &&
    (APPLICANT_TYPES as readonly string[]).includes(value)
  );
}
