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

export type AiMatchAdvice = {
  universityId: string;
  reason: string;
  strengthPoints: string[];
  weaknesses: string[];
  actionItems: string[];
  nextStep?: string;
};
