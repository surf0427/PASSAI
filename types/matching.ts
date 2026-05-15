// ── 生徒：基本情報 ──────────────────────────────────────────────

export type StudentChoice = {
  university: string;
  faculty: string;
};

export type MatchingBasicInfo = {
  name: string;
  highSchool: string;
  grade: string;
  academicType: '文系' | '理系';
  choices: StudentChoice[];
};

// ── 生徒：活動整理 ──────────────────────────────────────────────

export type ActivityInput = {
  activityType: string;
  title: string;
  subTitle: string;
  period: string;
  memorable: string;
  success: string;
  failure: string;
};

// ── 生徒：スコアプロフィール ────────────────────────────────────

export type AoScoreProfile = {
  activity: number;   // 活動レベル（0〜5）
  inquiry: number;    // 探究テーマの深さ（0〜5）
  initiative: number; // 主体性（0〜5）
  reason: number;     // 志望理由の一貫性（0〜5）
};

export type RecommendationScoreProfile = {
  gpa: number;           // 評定平均（0〜5）
  qualification: number; // 資格（0〜5）
  academic: number;      // 学力（0〜5）
  reason: number;        // 志望理由（0〜5）
};

// ── 生徒：自己分析結果 ──────────────────────────────────────────

export type StudentAnalysis = {
  strengths: string[];
  weaknesses: string[];
  aoScoreProfile: AoScoreProfile | null;
  recommendationScoreProfile: RecommendationScoreProfile | null;
};

// ── 大学：スコアプロフィール ────────────────────────────────────

export type UniversityAoProfile = {
  activity: number;
  inquiry: number;
  initiative: number;
  reason: number;
};

export type UniversityRecommendationProfile = {
  gpa: number;
  qualification: number;
  academic: number;
  reason: number;
};

// ── 大学データ ──────────────────────────────────────────────────

export type University = {
  id: string;
  name: string;
  faculty: string;
  admissionType: '総合型' | '学校推薦型';
  academicType: '文系' | '理系';
  // 受験条件
  requiredGpa: number | null; // 評定基準（例: 3.8, 4.0）。なければ null
  hasInterview: boolean;      // 面接あり
  hasEssay: boolean;          // 小論文・記述試験あり
  hasPresentation: boolean;   // プレゼンあり
  // 評価軸
  aoProfile: UniversityAoProfile | null;
  recommendationProfile: UniversityRecommendationProfile | null;
  // 特徴
  description: string;
  tags: string[];
  similarSchools: string[];
};

// ── スコア内訳 ──────────────────────────────────────────────────

export type ScoreBreakdownItem = {
  label: string;       // 項目名（例：「主体性」）
  studentScore: number;
  required: number;
  weight: number;      // 重要度の重み
  contribution: number; // 全体スコアへの寄与点（0〜100の範囲内）
};

export type ScoreBreakdown = {
  items: ScoreBreakdownItem[];
  total: number; // 0〜100
};

// ── 出願条件 eligibility（AO適性 score とは別レーン） ─────────────
// 「DB の評定条件 ↔ ユーザーの subjectGrades / overallGpa」を照合した結果。
// MatchingResult.score（AO/推薦の適性）とは意味が違うため、混ぜずに別オブジェクトで持つ。
// 「断定しない」UX 要件により、UI 表示は柔らかい文言で扱う前提。

export type EligibilityStatus =
  | 'eligible'                // 条件を満たす
  | 'likely_eligible'         // 数値は満たすが補足条件あり（gpa_subject_notes 等）
  | 'needs_confirmation'      // 数値以外の制約（履修要件あり 等）→ 公式要項で要確認
  | 'not_eligible'            // 数値が下回る（UI 文言は「条件に注意」等で柔らかく）
  | 'insufficient_user_data'  // 生徒側未入力
  | 'insufficient_db_data';   // DB 値が「不明」「」など

export type EligibilityCheckItem = {
  label:
    | '評定平均'
    | '英語評定'
    | '国語評定'
    | '数学評定'
    | '理科評定'
    | '社会評定';
  userValue: number | null;
  requiredValue: number | null;
  rawRequired: string;   // DB 原文（"3.8" / "なし" / "不明" / "履修要件あり" 等）
  status: EligibilityStatus;
  note?: string;         // gpa_subject_notes 等の補足
};

export type EligibilityResult = {
  overallStatus: EligibilityStatus;
  items: EligibilityCheckItem[];
  freeTextNotes: string[];
  confidence: 'high' | 'medium' | 'low';
};

// ── マッチング結果 ──────────────────────────────────────────────

export type MatchingResult = {
  university: University;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  reason: string;
  strengthPoints: string[];
  weaknesses: string[];
  actionItems: string[];
  suggestionType: '自分の志望校' | 'ストレートマッチ' | '潜在マッチ';
  matchSummary: string;
};

// ── AI 強化アドバイス ───────────────────────────────────────────
// 文章生成層 (/app/api/matching/route.ts) が大学ごとに返す narrative。
// スコアリング層の MatchingResult と組み合わせて表示する。
//
// STEP1.1（AI 出力責務削減）以降、AI が生成するのは reason のみ。
// strengthPoints / weaknesses / actionItems / nextStep は deterministic 側
// （MatchingResult.* / lib/matching/generateReason.ts）へ委譲した。
// 旧キャッシュ（localStorage:matchingResult）には 4 フィールドが残っている可能性が
// あるため、型は optional として残す（読み出し互換のため・破壊的変更を避ける）。
// UI は `aiAdvice?.strengthPoints ?? result.strengthPoints` のように
// MatchingResult.* にフォールバックする経路を持つ。

export type AiMatchAdvice = {
  universityId: string;
  reason: string;
  /**
   * @deprecated STEP1.1 以降、AI からは生成しない。
   * 表示は `MatchingResult.strengthPoints`（generateReason.ts）にフォールバックする。
   * 旧 localStorage キャッシュ読み出し互換のため optional として残置。
   */
  strengthPoints?: string[];
  /**
   * @deprecated STEP1.1 以降、AI からは生成しない。
   * 表示は `MatchingResult.weaknesses`（generateReason.ts）にフォールバックする。
   */
  weaknesses?: string[];
  /**
   * @deprecated STEP1.1 以降、AI からは生成しない。
   * 表示は `MatchingResult.actionItems`（generateReason.ts）にフォールバックする。
   */
  actionItems?: string[];
  /**
   * @deprecated UI で未参照の dead output。STEP1.1 で AI 生成からも除去。
   */
  nextStep?: string;
};
