export type SchoolPreference = {
  university: string;
  faculty: string;
  department?: string; // 学科名。任意項目（既存データでは未保存の可能性あり）
};

export type BasicInfo = {
  name: string;
  grade: string;
  track: '文系' | '理系' | '未定' | ''; // '' は未選択状態。バリデーションで弾く
  preferences: SchoolPreference[];
  overallGpa?: string; // 通知表「全体の学習成績の状況」。任意。未入力は ''。
  examTypes: string[]; // 受験予定の方式（複数選択可）。未入力は []。
};
