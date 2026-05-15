export type SchoolPreference = {
  university: string;
  faculty: string;
  department?: string; // 学科名。任意項目（既存データでは未保存の可能性あり）
};

// 科目別評定・欠席日数。すべて optional。
// 推薦・AO の科目条件マッチング精度を上げるための任意入力。
// 未入力時はオブジェクト自体を持たない（undefined のまま）ことを基本とする。
// AI input hash の不変性を保つため、normalize で空オブジェクトを差し込まないこと。
export type SubjectGrades = {
  english?: string;
  japanese?: string;
  math?: string;
  science?: string;
  social?: string;
  absenceDays?: string;
};

export type BasicInfo = {
  name: string;
  grade: string;
  track: '文系' | '理系' | '未定' | ''; // '' は未選択状態。バリデーションで弾く
  preferences: SchoolPreference[];
  overallGpa?: string; // 通知表「全体の学習成績の状況」。任意。未入力は ''。
  examTypes: string[]; // 受験予定の方式（複数選択可）。未入力は []。
  subjectGrades?: SubjectGrades; // 科目別評定・欠席日数。任意。未入力時は undefined。
};
