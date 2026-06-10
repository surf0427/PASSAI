// 小論文テーマ候補の生成。
//
// 責務分離（過去問DBや頻出テーマ分析を後乗せしても破綻しない構造）:
//   1. collectAdmissionPolicies()     大学DBから admission_policy をユニーク取得
//   2. detectFacultyThemeBias()       学部名・学科名から themeType の傾向を抽出
//   3. detectExamThemeBias()          入試方式から themeType の傾向と tone を抽出
//   4. detectSelectionThemeBias()     selectionSteps（面接/プレゼン/探究など）から傾向を抽出
//   5. mergeBiases()                  優先順位 faculty > exam > selection > default で合成
//   6. buildThemeCandidates()         policy 由来 or fallback の候補を組み立てる
//
// データ境界:
//   - data/ 配下は直接 import しない（lib/universities.ts 経由のみ）
//   - 純関数。localStorage / fetch / 乱数なし
//   - 同じ入力に対して常に同じ並びの候補を返す（deterministic）
//
// sourceType:
//   - 'admission_policy' : 該当 entries に有意な admission_policy が存在
//   - 'fallback'         : 該当 entries が無い or 有意な policy が無い

import {
  findUniversityEntriesByUserChoices,
  getSelectionStepsByEntryId,
} from '@/lib/universities';

export type EssayThemeSourceType = 'admission_policy' | 'fallback';

// 添削基準・深掘り質問・面接質問のテーマ別連携に使う想定の分類。
// 値は意図的に英 snake_case（UI badge にそのまま表示できる軽量さを優先）。
export type EssayThemeType =
  | 'social_issue'
  | 'technology'
  | 'globalization'
  | 'ethics'
  | 'self_reflection'
  | 'policy'
  | 'culture'
  | 'education'
  | 'environment';

export type EssayThemeCandidate = {
  theme: string;
  sourceType: EssayThemeSourceType;
  reason: string;
  themeType: EssayThemeType;
};

export type EssayThemeInput = {
  university: string;
  faculty?: string;
  department?: string;
  examType?: string;
};

// テーマ文に差し込む語気の調整。examType 由来でしか変えない（決定性のため）。
type ToneHints = {
  experiencePhrase: string; // 例: "あなた自身の経験も踏まえて、"。空文字なら何も挿入しない。
};

const NEUTRAL_TONE: ToneHints = { experiencePhrase: '' };

// バイアスが弱い・無い場合の補充に使う既定順。並びは UX 経由で繰り返し露出されるため
// 決め打ちで固定（ランダム禁止）。
const DEFAULT_THEME_TYPE_ORDER: readonly EssayThemeType[] = [
  'social_issue',
  'self_reflection',
  'technology',
  'globalization',
  'policy',
  'ethics',
  'culture',
  'education',
  'environment',
];

// 1 つの policy あたり何種類の themeType を展開するか。
// 多すぎると「次のテーマで始める」連打で似た文ばかり出るため、上位 3 件まで。
const MAX_TYPES_PER_POLICY = 3;
// 全体での候補数上限。複数 policy がある大学でも切り替えに疲れない件数。
const MAX_TOTAL_CANDIDATES = 9;

// ===================================
// 1. admission_policy 収集
// ===================================

function isMeaningfulPolicy(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (trimmed === '不明') return false;
  if (trimmed === 'なし') return false;
  return true;
}

function splitPolicySentences(policy: string): string[] {
  return policy
    .split(/[。．]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function collectAdmissionPolicies(input: EssayThemeInput): string[] {
  const entries = findUniversityEntriesByUserChoices({
    university: input.university,
    faculty: input.faculty,
    department: input.department,
  });
  if (entries.length === 0) return [];

  const seen = new Set<string>();
  const policies: string[] = [];
  for (const entry of entries) {
    for (const step of getSelectionStepsByEntryId(entry.entry_id)) {
      const policy = step.admission_policy;
      if (!isMeaningfulPolicy(policy)) continue;
      const key = policy.trim();
      if (seen.has(key)) continue;
      seen.add(key);
      policies.push(key);
    }
  }
  return policies;
}

// ===================================
// 2. 学部特性バイアス
// ===================================

// 学部名・学科名から themeType の優先傾向を抽出する。
// 単純な substring match。複数キーワードに該当した場合は出現順で合成。
function detectFacultyThemeBias(faculty: string, department: string): EssayThemeType[] {
  const haystack = `${faculty} ${department}`;
  const bias: EssayThemeType[] = [];
  const push = (...types: EssayThemeType[]) => {
    for (const t of types) if (!bias.includes(t)) bias.push(t);
  };

  if (
    haystack.includes('国際') ||
    haystack.includes('外国') ||
    haystack.includes('グローバル')
  ) {
    push('globalization', 'culture', 'technology');
  }
  if (
    haystack.includes('経済') ||
    haystack.includes('経営') ||
    haystack.includes('商')
  ) {
    push('policy', 'social_issue');
  }
  if (haystack.includes('教育')) {
    push('education', 'ethics');
  }
  if (
    haystack.includes('情報') ||
    haystack.includes('AI') ||
    haystack.includes('データサイエンス') ||
    haystack.includes('工学') ||
    haystack.includes('理工')
  ) {
    push('technology', 'ethics');
  }
  if (
    haystack.includes('看護') ||
    haystack.includes('医療') ||
    haystack.includes('医学') ||
    haystack.includes('薬') ||
    haystack.includes('保健')
  ) {
    push('ethics', 'social_issue');
  }
  if (haystack.includes('法')) {
    push('policy', 'ethics');
  }
  if (
    haystack.includes('文学') ||
    haystack.includes('言語') ||
    haystack.includes('文化')
  ) {
    push('culture', 'self_reflection');
  }
  if (
    haystack.includes('環境') ||
    haystack.includes('農') ||
    haystack.includes('生命')
  ) {
    push('environment', 'social_issue');
  }
  if (
    haystack.includes('心理') ||
    haystack.includes('社会') ||
    haystack.includes('福祉')
  ) {
    push('social_issue', 'self_reflection');
  }
  return bias;
}

// ===================================
// 3. 入試方式バイアス
// ===================================

function detectExamThemeBias(examType: string): {
  types: EssayThemeType[];
  tone: ToneHints;
} {
  const e = examType.trim();
  if (e.includes('総合型')) {
    return {
      types: ['self_reflection', 'social_issue'],
      tone: { experiencePhrase: 'あなた自身の経験も踏まえて、' },
    };
  }
  if (e.includes('学校推薦') || e.includes('推薦')) {
    return {
      types: ['social_issue', 'education'],
      tone: { experiencePhrase: '高校生活での学びを踏まえて、' },
    };
  }
  if (e.includes('一般') || e.includes('共通テスト')) {
    return {
      types: ['policy', 'social_issue'],
      tone: NEUTRAL_TONE,
    };
  }
  if (e.includes('海外')) {
    return {
      types: ['globalization', 'culture'],
      tone: { experiencePhrase: '国際的な視点を踏まえて、' },
    };
  }
  return { types: [], tone: NEUTRAL_TONE };
}

// ===================================
// 4. 選考内容バイアス（selectionSteps 利用）
// ===================================

// selectionSteps の selection_type / format / evaluation_points / ai_strategy_hint から、
// 選考の傾向（プレゼン / 探究 / 面接）に応じて themeType を補正する。
// admission_policy が無い／空でも selectionSteps からのバイアスは独立で機能する。
function detectSelectionThemeBias(input: EssayThemeInput): EssayThemeType[] {
  const entries = findUniversityEntriesByUserChoices({
    university: input.university,
    faculty: input.faculty,
    department: input.department,
  });
  if (entries.length === 0) return [];

  const bias: EssayThemeType[] = [];
  const push = (...types: EssayThemeType[]) => {
    for (const t of types) if (!bias.includes(t)) bias.push(t);
  };

  for (const entry of entries) {
    for (const step of getSelectionStepsByEntryId(entry.entry_id)) {
      const blob = `${step.selection_type} ${step.format} ${step.evaluation_points} ${step.ai_strategy_hint}`;
      // プレゼンあり → 課題解決型（社会課題テーマ）
      if (blob.includes('プレゼン') || blob.includes('発表')) {
        push('social_issue');
      }
      // 探究 / 課題研究 → 主体的学び型（自己接続）
      if (blob.includes('探究') || blob.includes('課題研究')) {
        push('self_reflection');
      }
      // 面接重視 → 自己接続型
      if (step.selection_type === '面接' || blob.includes('個人面接')) {
        push('self_reflection');
      }
    }
  }
  return bias;
}

// ===================================
// バイアス合成
// ===================================

// 優先順位: faculty > exam > selection > default。
// 重複は排除して順序保持。最後に DEFAULT_THEME_TYPE_ORDER で補充するため、
// 戻り値は常に全 EssayThemeType を含む長さになる。
function mergeBiases(
  facultyBias: readonly EssayThemeType[],
  examBias: readonly EssayThemeType[],
  selectionBias: readonly EssayThemeType[],
): EssayThemeType[] {
  const seen = new Set<EssayThemeType>();
  const out: EssayThemeType[] = [];
  const pushAll = (list: readonly EssayThemeType[]) => {
    for (const t of list) {
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  };
  pushAll(facultyBias);
  pushAll(examBias);
  pushAll(selectionBias);
  pushAll(DEFAULT_THEME_TYPE_ORDER);
  return out;
}

// ===================================
// テーマテンプレート
// ===================================

// admission_policy を素材にしたテンプレート群。themeType ごとに 1 つ。
// experiencePhrase が空文字でも自然に読めるよう、sentence-medial に配置する。
const POLICY_TEMPLATES: Record<
  EssayThemeType,
  (policyExcerpt: string, tone: ToneHints) => string
> = {
  social_issue: (p, t) =>
    `アドミッションポリシーに示されている「${p}。」という観点から、現代社会で関心のある問題を1つ取り上げ、${t.experiencePhrase}自分なりの考えを論じなさい。`,
  technology: (p, t) =>
    `「${p}。」を踏まえて、AI・情報技術の発展が社会にもたらす変化を1つ取り上げ、${t.experiencePhrase}あなたの考えを述べなさい。`,
  globalization: (p, t) =>
    `「${p}。」を踏まえて、グローバル化が日本社会にもたらす課題を1つ挙げ、${t.experiencePhrase}あなたの考えを述べなさい。`,
  ethics: (p, t) =>
    `「${p}。」に照らし、現代において議論されている倫理的な問題を1つ取り上げ、${t.experiencePhrase}自分の立場と理由を述べなさい。`,
  self_reflection: (p, t) =>
    `アドミッションポリシー「${p}。」を踏まえ、${t.experiencePhrase}あなた自身の高校時代の経験を1つ挙げ、それが大学での学びとどうつながるかを論じなさい。`,
  policy: (p, t) =>
    `「${p}。」という方針に照らして、現在の日本社会で議論されている政策課題を1つ取り上げ、${t.experiencePhrase}賛否とその理由を述べなさい。`,
  culture: (p, t) =>
    `「${p}。」を踏まえて、現代社会における文化・価値観の多様性について、${t.experiencePhrase}あなたが大切にしたい視点を1つ挙げ論じなさい。`,
  education: (p, t) =>
    `アドミッションポリシー「${p}。」を踏まえ、現代の教育に求められる変化を1つ挙げ、${t.experiencePhrase}あなたの考えを述べなさい。`,
  environment: (p, t) =>
    `「${p}。」に照らして、環境・持続可能性に関する課題を1つ取り上げ、${t.experiencePhrase}あなたの考えを述べなさい。`,
};

// admission_policy が見つからないときに使う汎用テンプレート群。
const GENERIC_TEMPLATES: Record<EssayThemeType, (tone: ToneHints) => string> = {
  social_issue: (t) =>
    `高校までの学びを踏まえて、大学で取り組みたい社会課題を1つ挙げ、${t.experiencePhrase}その理由と取り組み方を論じなさい。`,
  technology: (t) =>
    `AI時代において、大学教育はどのように変化すべきか。${t.experiencePhrase}あなたの考えを述べなさい。`,
  globalization: (t) =>
    `グローバル化が進む現代において、あなたが日本社会で大切にしたい価値観を1つ挙げ、${t.experiencePhrase}その理由を論じなさい。`,
  ethics: (t) =>
    `現代社会で議論されている倫理的な問題を1つ取り上げ、${t.experiencePhrase}あなたの立場と理由を述べなさい。`,
  self_reflection: (t) =>
    `これまでの自分の経験のうち、進路選択に最も影響を与えた出来事を1つ挙げ、${t.experiencePhrase}大学での学びとのつながりを論じなさい。`,
  policy: (t) =>
    `現在の日本社会で議論されている政策課題を1つ取り上げ、${t.experiencePhrase}賛否とその理由を述べなさい。`,
  culture: (t) =>
    `現代社会における文化・価値観の多様性について、${t.experiencePhrase}あなたが大切にしたい視点を1つ挙げ論じなさい。`,
  education: (t) =>
    `これからの教育に求められる変化を1つ挙げ、${t.experiencePhrase}あなたの考えを述べなさい。`,
  environment: (t) =>
    `環境・持続可能性に関する課題を1つ取り上げ、${t.experiencePhrase}あなたの考えを述べなさい。`,
};

// ===================================
// reason 文言ビルダー
// ===================================

function buildTargetLabel(input: EssayThemeInput): string {
  const segs: string[] = [];
  if (input.university.trim()) segs.push(input.university.trim());
  if ((input.faculty ?? '').trim()) segs.push((input.faculty ?? '').trim());
  if ((input.department ?? '').trim()) segs.push((input.department ?? '').trim());
  return segs.join(' ');
}

function buildAdmissionPolicyReason(label: string): string {
  if (label === '') {
    return '選択された志望校のアドミッションポリシーをもとに表示しています。';
  }
  return `${label} のアドミッションポリシーをもとに表示しています。`;
}

function buildFallbackReason(label: string): string {
  if (label === '') {
    return '志望校が未入力のため、汎用テーマを表示しています。';
  }
  return `${label} のアドミッションポリシーが見つからないため、汎用テーマを表示しています。`;
}

// ===================================
// 6. テーマ候補組み立て
// ===================================

function buildThemeCandidates(
  policies: string[],
  bias: readonly EssayThemeType[],
  tone: ToneHints,
  label: string,
): EssayThemeCandidate[] {
  // バイアス上位 N 件を選ぶ（mergeBiases 経由で必ず非空）。
  const typesPicked = bias.slice(0, MAX_TYPES_PER_POLICY);

  // fallback パス: admission_policy が無いので GENERIC_TEMPLATES を使う。
  if (policies.length === 0) {
    const reason = buildFallbackReason(label);
    const candidates: EssayThemeCandidate[] = [];
    const seen = new Set<string>();
    for (const type of typesPicked) {
      const theme = GENERIC_TEMPLATES[type](tone);
      if (seen.has(theme)) continue;
      seen.add(theme);
      candidates.push({ theme, sourceType: 'fallback', reason, themeType: type });
    }
    return candidates;
  }

  // admission_policy パス: 各 policy × バイアス上位タイプを掛け合わせる。
  const reason = buildAdmissionPolicyReason(label);
  const candidates: EssayThemeCandidate[] = [];
  const seenThemes = new Set<string>();
  for (const policy of policies) {
    // policy 全文ではなく 1 文目（最も核となる方針）を引用素材にする。
    const excerpt = splitPolicySentences(policy)[0] ?? policy.trim();
    for (const type of typesPicked) {
      const theme = POLICY_TEMPLATES[type](excerpt, tone);
      if (seenThemes.has(theme)) continue;
      seenThemes.add(theme);
      candidates.push({
        theme,
        sourceType: 'admission_policy',
        reason,
        themeType: type,
      });
      if (candidates.length >= MAX_TOTAL_CANDIDATES) return candidates;
    }
  }
  return candidates;
}

// ===================================
// Public API
// ===================================

// 与えられた条件に対応するテーマ候補を返す。必ず 1 件以上返る。
export function getEssayThemeCandidates(
  input: EssayThemeInput,
): EssayThemeCandidate[] {
  const policies = collectAdmissionPolicies(input);
  const facultyBias = detectFacultyThemeBias(
    input.faculty ?? '',
    input.department ?? '',
  );
  const examResult = detectExamThemeBias(input.examType ?? '');
  const selectionBias = detectSelectionThemeBias(input);
  const bias = mergeBiases(facultyBias, examResult.types, selectionBias);
  const label = buildTargetLabel(input);
  return buildThemeCandidates(policies, bias, examResult.tone, label);
}

// ===================================
// AI 追加生成 route 用アダプタ
// ===================================

// 全 themeType（category/tag 妥当性検証や偏り判定に使う）。
// DEFAULT_THEME_TYPE_ORDER と同じ集合だが、用途が「全列挙」なので別名で公開する。
export const ALL_ESSAY_THEME_TYPES: readonly EssayThemeType[] =
  DEFAULT_THEME_TYPE_ORDER;

// /api/essay-themes が prompt を組むための文脈。
// data/ 境界は lib/universities.ts に閉じたまま（route から data/ を直 import しない）、
// admission_policy / バイアス順 / 表示ラベル / reason・sourceType を route に渡す。
export type EssayThemeAiContext = {
  hasPolicy: boolean;
  // 意味のある admission_policy 全文（重複排除済み・最大数件）。
  policies: string[];
  // faculty > exam > selection > default で合成した全 themeType 順。偏りを避ける優先順。
  biasOrder: EssayThemeType[];
  // examType 由来の語気ヒント（決定論的）。
  experiencePhrase: string;
  // 「○○大学 ○○学部」表示ラベル。
  label: string;
  // 生成テーマに付与する出典説明（決定論版と同一文言）。
  reason: string;
  // UI バッジ色分岐に使う sourceType（決定論版と同一規約）。
  sourceType: EssayThemeSourceType;
};

export function getEssayThemeAiContext(
  input: EssayThemeInput,
): EssayThemeAiContext {
  const policies = collectAdmissionPolicies(input);
  const facultyBias = detectFacultyThemeBias(
    input.faculty ?? '',
    input.department ?? '',
  );
  const examResult = detectExamThemeBias(input.examType ?? '');
  const selectionBias = detectSelectionThemeBias(input);
  const biasOrder = mergeBiases(facultyBias, examResult.types, selectionBias);
  const label = buildTargetLabel(input);
  const hasPolicy = policies.length > 0;
  return {
    hasPolicy,
    policies,
    biasOrder,
    experiencePhrase: examResult.tone.experiencePhrase,
    label,
    reason: hasPolicy
      ? buildAdmissionPolicyReason(label)
      : buildFallbackReason(label),
    sourceType: hasPolicy ? 'admission_policy' : 'fallback',
  };
}
