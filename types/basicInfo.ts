export type SchoolPreference = {
  university: string;
  faculty: string;
};

export type ExamType =
  | 'AO'
  | 'RECOMMENDATION'
  | 'BOTH'
  | 'GENERAL_WITH_RECOMMENDATION';

export type BasicFormData = {
  name: string;
  highSchool: string;
  grade: string;
  stream: '文系' | '理系' | '';
  examType: ExamType | '';
  preferences: SchoolPreference[];
};

// 受験方式コードを日本語ラベルに変換する定数。
// 複数ページで使うためここに一元管理している。
export const EXAM_TYPE_LABELS: Record<ExamType, string> = {
  AO:                          '総合型選抜',
  RECOMMENDATION:              '学校推薦型選抜',
  BOTH:                        '両方検討中',
  GENERAL_WITH_RECOMMENDATION: '一般受験メイン（推薦も併用）',
};
