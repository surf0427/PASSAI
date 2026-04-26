// 活動期間
export type ActivityPeriod = {
  from: string;
  to: string;
};

// 全活動に共通するフィールド（資格・読書・趣味は除く）
export type BaseActivity = {
  period: ActivityPeriod;
  description: string;       // 活動内容（必須）
  achievement: string;       // 成果（必須）
  role: string;              // 役割/立場（任意）
  challenge: string;         // 課題（任意）
  action: string;            // 行動/工夫（任意）
  reflection: string;        // 学び（任意）
  futureConnection: string;  // 将来とのつながり（任意）
};

// 部活動
export type ClubActivity = BaseActivity & {
  type: 'club';
  clubName: string;          // 部活名（必須）
  sport: string;             // 種目（必須）
  competitionLevel: string;  // 大会レベル（任意）
  teamSize: string;          // チーム規模（任意）
};

// ボランティア
export type VolunteerActivity = BaseActivity & {
  type: 'volunteer';
  activityContent: string;   // 活動の種類（必須）
  target: string;            // 対象（必須）
  purpose: string;           // 目的（必須）
  frequency: string;         // 活動頻度（任意）
};

// 留学
export type StudyAbroadActivity = BaseActivity & {
  type: 'studyAbroad';
  destination: string;       // 留学先（必須）
  programContent: string;    // プログラム内容（必須）
  language: string;          // 使用言語（必須）
};

// 探究
export type ResearchActivity = BaseActivity & {
  type: 'research';
  theme: string;             // テーマ（必須）
  trigger: string;           // きっかけ（必須）
  hypothesis: string;        // 仮説（任意）
  methodology: string;       // 調査方法（必須）
  output: string;            // 成果物（必須）
};

// アルバイト
export type PartTimeJobActivity = BaseActivity & {
  type: 'partTimeJob';
  industry: string;          // 業種（必須）
  jobContent: string;        // 業務内容（必須）
  workFrequency: string;     // 勤務頻度（任意）
};

// 資格（特殊：共通フィールドを持たない）
export type CertificationActivity = {
  type: 'certification';
  certificationName: string; // 資格名（必須）
  level: string;             // レベル/スコア（必須）
  acquiredDate: string;      // 取得時期（任意）
  purpose: string;           // 取得目的（必須）
  studyMethod: string;       // 勉強方法（任意）
  difficulty: string;        // 苦労した点（任意）
  reflection: string;        // 学び（任意）
  futureConnection: string;  // 将来とのつながり（任意）
};

// コンテスト
export type ContestActivity = BaseActivity & {
  type: 'contest';
  contestName: string;       // コンテスト名（必須）
  field: string;             // 分野（必須）
  result: string;            // 結果（必須）
};

// 読書（特殊：共通フィールドを持たない）
export type ReadingActivity = {
  type: 'reading';
  genre: string;             // 本のジャンル（必須）
  favoriteBook: string;      // 印象に残った本（必須）
  reason: string;            // なぜ選んだか（必須）
  reflection: string;        // 学び（任意）
  mindChange: string;        // 思考の変化（必須）
};

// 趣味（特殊：共通フィールドを持たない）
export type HobbyActivity = {
  type: 'hobby';
  hobbyContent: string;      // 趣味内容（必須）
  frequency: string;         // 頻度（任意）
  reason: string;            // なぜ続けているか（必須）
  innovation: string;        // 工夫（任意）
  acquiredSkills: string;    // 得たスキル（任意）
};

// すべての活動を表すユニオン型
export type Activity =
  | ClubActivity
  | VolunteerActivity
  | StudyAbroadActivity
  | ResearchActivity
  | PartTimeJobActivity
  | CertificationActivity
  | ContestActivity
  | ReadingActivity
  | HobbyActivity;

// 全活動データをまとめる型
export type ActivityData = {
  clubActivities: ClubActivity[];
  volunteerActivities: VolunteerActivity[];
  studyAbroadActivities: StudyAbroadActivity[];
  researchActivities: ResearchActivity[];
  partTimeJobActivities: PartTimeJobActivity[];
  certificationActivities: CertificationActivity[];
  contestActivities: ContestActivity[];
  readingActivities: ReadingActivity[];
  hobbyActivities: HobbyActivity[];
};
